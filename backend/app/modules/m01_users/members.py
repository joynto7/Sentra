"""The members of an organization and their roles (FR-1.6, UC-10.1 Change Member Role)."""

import uuid

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.email import send_email
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.models import Organization
from app.modules.m01_users import emails
from app.modules.m01_users.models import ROLE_LABELS, Membership, Role, User
from app.modules.m01_users.security import verify_password

WRONG_PASSWORD = "That password is incorrect."


def list_members(db: Session, organization_id: uuid.UUID) -> list[tuple[Membership, User]]:
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == organization_id)
        .order_by(User.name)
    )
    return [(m, u) for m, u in rows]


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
    if membership.role == Role.ORG_ADMIN and _admin_count(db, admin.organization_id) == 1:
        raise ConflictError(
            f"{user.name} is the only Organization Administrator. "
            "Give another member this role first.",
            code="last_admin",
        )

    membership.role = role
    db.commit()
    organization = db.get_one(Organization, admin.organization_id)
    background.add_task(
        send_email,
        user.email,
        *emails.role_changed(user.name, organization.name, ROLE_LABELS[role]),
    )
    return membership, user


def _admin_count(db: Session, organization_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.organization_id == organization_id, Membership.role == Role.ORG_ADMIN)
    )
