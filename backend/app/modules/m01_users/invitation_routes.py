import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.models import Organization
from app.modules.m01_users import invitations, service
from app.modules.m01_users.cookies import set_second_step_cookie, set_session_cookie
from app.modules.m01_users.deps import current_session, current_user
from app.modules.m01_users.models import (
    ROLE_LABELS,
    Invitation,
    Membership,
    Role,
    User,
    UserSession,
)
from app.modules.m01_users.organization_routes import organization_out
from app.modules.m01_users.permissions import ROLE_DESCRIPTIONS, Action, require
from app.modules.m01_users.schemas import (
    InvitationDetailsOut,
    InvitationOut,
    InvitationRegisterIn,
    InvitationTokenIn,
    InviteIn,
    JoinedOut,
    MyInvitationOut,
    OrganizationOut,
    PasswordIn,
    UserOut,
)

# For Organization Administrators (UC-1.8, UC-1.10)
admin_router = APIRouter(prefix="/organizations/current", tags=["M1 Organizations"])
can_manage = require(Action.MANAGE_MEMBERS)

# For the invited person; the link's token is sent in the body, never in the address (UC-1.9)
public_router = APIRouter(prefix="/invitations", tags=["M1 Invitations"])


def invitation_out(db: Session, invitation: Invitation) -> InvitationOut:
    inviter = db.get(User, invitation.invited_by_id) if invitation.invited_by_id else None
    return InvitationOut(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        role_label=ROLE_LABELS[Role(invitation.role)],
        invited_by=inviter.name if inviter else None,
        status="expired" if invitations.is_expired(invitation) else invitation.status,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
    )


@admin_router.post("/invitations", status_code=status.HTTP_201_CREATED)
def invite_member(
    data: InviteIn,
    background: BackgroundTasks,
    membership: Membership = Depends(can_manage),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> InvitationOut:
    """UC-1.8 Invite Team Member: a link by e-mail, valid for 7 days."""
    invitation = invitations.invite(db, membership, user, data.email, data.role, background)
    return invitation_out(db, invitation)


@admin_router.get("/invitations")
def list_invitations(
    membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> list[InvitationOut]:
    return [invitation_out(db, i) for i in invitations.pending(db, membership.organization_id)]


@admin_router.post("/invitations/{invitation_id}/resend")
def resend_invitation(
    invitation_id: uuid.UUID,
    background: BackgroundTasks,
    membership: Membership = Depends(can_manage),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> InvitationOut:
    invitation = invitations.resend(db, membership, user, invitation_id, background)
    return invitation_out(db, invitation)


@admin_router.post("/invitations/{invitation_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> None:
    invitations.revoke(db, membership, invitation_id)


@admin_router.post("/members/{membership_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    membership_id: uuid.UUID,
    data: PasswordIn,
    background: BackgroundTasks,
    membership: Membership = Depends(can_manage),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> None:
    """UC-1.10 Remove Team Member, confirmed with the administrator's password."""
    invitations.remove_member(db, membership, user, membership_id, data.password, background)


@public_router.get("/mine")
def my_invitations(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[MyInvitationOut]:
    """UC-1.9: what a person without a workspace yet may be waiting for, so that they are not led to
    create an organization by mistake. Only the person's own address; never the link."""
    return [
        MyInvitationOut(
            organization=organization,
            role=invitation.role,
            role_label=ROLE_LABELS[Role(invitation.role)],
            invited_by=inviter,
            expires_at=invitation.expires_at,
        )
        for invitation, organization, inviter in invitations.pending_for(db, user)
    ]


@public_router.post("/details")
def invitation_details(
    data: InvitationTokenIn, request: Request, db: Session = Depends(get_db)
) -> InvitationDetailsOut:
    """UC-1.9 step 2: the organization and the role, before the person decides."""
    invitation = invitations.find(db, data.token)
    organization = db.get_one(Organization, invitation.organization_id)
    inviter = db.get(User, invitation.invited_by_id) if invitation.invited_by_id else None
    raw = request.cookies.get(get_settings().session_cookie_name)
    logged_in = service.session_user(db, raw) if raw else None
    role = Role(invitation.role)
    return InvitationDetailsOut(
        organization=organization.name,
        email=invitation.email,
        role=role,
        role_label=ROLE_LABELS[role],
        role_description=ROLE_DESCRIPTIONS[role],
        invited_by=inviter.name if inviter else None,
        has_account=service.account_exists(db, invitation.email),
        logged_in_as=logged_in[1].email if logged_in else None,
    )


@public_router.post("/accept")
def accept_invitation(
    data: InvitationTokenIn,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> OrganizationOut:
    """UC-1.9 for a person who is logged in with the invited address."""
    membership = invitations.accept(db, data.token, user, session, background)
    organization = db.get_one(Organization, membership.organization_id)
    return organization_out(membership, organization, organization.id)


@public_router.post("/register")
def register_and_accept(
    data: InvitationRegisterIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> JoinedOut:
    """UC-1.9 for a person without an account: create it, join and log in, in one step. If the
    organization requires two-step verification, the login's second step sets it up first."""
    membership, step, raw = invitations.register_and_accept(
        db,
        data.token,
        data.name,
        data.password,
        data.accept_terms,
        request.headers.get("user-agent"),
        request.client.host if request.client else None,
        background,
    )
    if step == service.LoginStep.DONE:
        set_session_cookie(response, raw)
    else:
        set_second_step_cookie(response, raw)
    user = db.get_one(User, membership.user_id)
    organization = db.get_one(Organization, membership.organization_id)
    return JoinedOut(
        **UserOut.model_validate(user).model_dump(),
        organization=organization_out(membership, organization, organization.id),
        step=step,
    )


@public_router.post("/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(
    data: InvitationTokenIn, background: BackgroundTasks, db: Session = Depends(get_db)
) -> None:
    """UC-1.9, 4a."""
    invitations.decline(db, data.token, background)
