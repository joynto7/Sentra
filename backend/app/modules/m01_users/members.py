"""The members of an organization and their roles (FR-1.6, UC-10.1 Change Member Role)."""

import uuid

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.email import send_email
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.models import Organization
from app.modules.m01_users import emails
from app.modules.m01_users.models import ROLE_LABELS, Membership, MembershipStatus, Role, User
from app.modules.m01_users.security import verify_password
from app.modules.m09_reporting.notifications import notify

WRONG_PASSWORD = "That password is incorrect."


def list_members(db: Session, organization_id: uuid.UUID) -> list[tuple[Membership, User]]:
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == organization_id)
        .order_by(User.name)
    )
    return [(m, u) for m, u in rows]


def suspender_names(db: Session, memberships: list[Membership]) -> dict[uuid.UUID, str]:
    """Who suspended each suspended membership: a name, or the Sentra platform (UC-10.2, 1a)."""
    ids = {m.suspended_by_id for m in memberships if m.suspended_by_id}
    names = (
        dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all()) if ids else {}
    )
    result = {}
    for m in memberships:
        if m.status != MembershipStatus.SUSPENDED:
            continue
        name = names.get(m.suspended_by_id, "an administrator")
        result[m.id] = f"{name} (Sentra platform)" if m.suspended_by_platform else name
    return result


def change_role(
    db: Session,
    admin: Membership,
    admin_user: User,
    membership_id: uuid.UUID,
    role: Role,
    password: str,
    background: BackgroundTasks,
) -> tuple[Membership, User]:
    """UC-10.1: the administrator confirms with their password; the new role applies from the
    member's next request, because every request reads the role from the database."""
    membership = db.scalar(
        select(Membership).where(
            Membership.id == membership_id, Membership.organization_id == admin.organization_id
        )
    )
    if membership is None:  # also for members of other organizations (NFR-3.3)
        raise NotFoundError("Member not found.")
    if not verify_password(admin_user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    user = db.get_one(User, membership.user_id)
    if membership.role == role:
        return membership, user
    if is_last_admin(db, membership):
        raise ConflictError(
            f"{user.name} is the only Organization Administrator. "
            "Give another member this role first.",
            code="last_admin",
        )

    before = ROLE_LABELS[Role(membership.role)]
    membership.role = role
    audit.record(
        db,
        organization_id=admin.organization_id,
        actor=admin_user,
        action="member.role_changed",
        summary=f"Changed the role of {user.name}: {before} → {ROLE_LABELS[role]}",
        item=audit.Item("member", user.id, user.name),
        details={"before": {"role": before}, "after": {"role": ROLE_LABELS[role]}},
    )
    db.commit()
    organization = db.get_one(Organization, admin.organization_id)
    background.add_task(
        send_email,
        user.email,
        *emails.role_changed(user.name, organization.name, ROLE_LABELS[role]),
    )
    # UC-10.1 step 6: told in the application as well (FR-9.3).
    notify(
        db,
        event="account_security",
        user_ids=[user.id],
        organization_id=organization.id,
        text=f"{admin_user.name} changed your role to {ROLE_LABELS[role]}",
        subject=ROLE_LABELS[role],
        email=False,
    )
    return membership, user


def admin_count(db: Session, organization_id: uuid.UUID) -> int:
    """The organization's active administrators: a suspended one can't administer (UC-10.2)."""
    return db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(
            Membership.organization_id == organization_id,
            Membership.role == Role.ORG_ADMIN,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )


def is_last_admin(db: Session, membership: Membership) -> bool:
    """Whether the organization would be left without an active administrator (UC-1.10, 2a;
    UC-10.1, 2a; UC-10.2)."""
    return (
        membership.role == Role.ORG_ADMIN
        and membership.active
        and admin_count(db, membership.organization_id) == 1
    )
