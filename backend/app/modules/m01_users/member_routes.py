import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users import members
from app.modules.m01_users.deps import current_user
from app.modules.m01_users.models import ROLE_LABELS, Membership, Role, User
from app.modules.m01_users.permissions import (
    PERMISSIONS,
    ROLE_DESCRIPTIONS,
    Action,
    actions_for,
    require,
)
from app.modules.m01_users.schemas import MemberOut, PermissionOut, RoleChangeIn, RoleOut

router = APIRouter(prefix="/organizations", tags=["M1 Organizations"])


def member_out(membership: Membership, user: User, me: User) -> MemberOut:
    return MemberOut(
        membership_id=membership.id,
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=membership.role,
        role_label=ROLE_LABELS[Role(membership.role)],
        last_login_at=user.last_login_at,
        joined_at=membership.created_at,
        is_you=user.id == me.id,
    )


@router.get("/roles", dependencies=[Depends(current_user)])
def list_roles() -> list[RoleOut]:
    """The four roles and what each may do (FR-1.6). The change-role dialog compares two roles
    to show what a member gains and loses (UC-10.1 step 3)."""
    return [
        RoleOut(
            role=role,
            label=ROLE_LABELS[role],
            description=ROLE_DESCRIPTIONS[role],
            permissions=[
                PermissionOut(action=action, label=PERMISSIONS[action].label)
                for action in actions_for(role)
            ],
        )
        for role in Role
    ]


@router.get("/current/members")
def list_members(
    membership: Membership = Depends(require(Action.MANAGE_MEMBERS)),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[MemberOut]:
    """The members of the current organization, for its administrators (Screen 12)."""
    return [member_out(m, u, user) for m, u in members.list_members(db, membership.organization_id)]


@router.patch("/current/members/{membership_id}")
def change_member_role(
    membership_id: uuid.UUID,
    data: RoleChangeIn,
    background: BackgroundTasks,
    membership: Membership = Depends(require(Action.MANAGE_MEMBERS)),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> MemberOut:
    """UC-10.1 Change Member Role, confirmed with the administrator's password."""
    changed, member = members.change_role(
        db, membership, user, membership_id, data.role, data.password, background
    )
    return member_out(changed, member, user)
