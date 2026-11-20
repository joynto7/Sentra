"""User administration (FR-10.1, UC-10.2 Suspend User Account).

Suspension blocks a member's access at once without deleting the member or their history, and can
be reversed, unlike the removal of a member (UC-1.10). An Organization Administrator suspends a
member in their own organization; a Platform Administrator suspends a whole account in every
organization it belongs to, for security or support reasons (1a). Both need the administrator's
password (NFR-3.5), end the member's sessions at once, inform the people concerned and are
recorded in the audit log (FR-10.2).

Changing a member's role (UC-10.1) is in m01_users/members.py.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.email import send_email
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.models import Organization
from app.core.tenancy import scoped_select
from app.modules.m01_users import emails
from app.modules.m01_users.members import WRONG_PASSWORD, is_last_admin
from app.modules.m01_users.models import (
    AccountEvent,
    AccountEventKind,
    Membership,
    MembershipStatus,
    Role,
    User,
    UserSession,
    UserStatus,
)
from app.modules.m01_users.security import verify_password
from app.modules.m09_reporting.notifications import notify

REASON_REQUIRED = "Enter the reason. It is recorded in the audit log."
REASON_TOO_LONG = "Use at most 300 characters."
# A login from an address this account hasn't used in the 30 days before it is flagged on the
# Accounts page (Screen 64), as a hint that the account may be used by someone else.
NEW_ADDRESS_WINDOW = timedelta(days=30)


def _now() -> datetime:
    return datetime.now(UTC)


def _reason(reason: str) -> str:
    reason = " ".join(reason.split())
    if not reason:
        raise FieldValidationError("reason", REASON_REQUIRED)
    if len(reason) > 300:
        raise FieldValidationError("reason", REASON_TOO_LONG)
    return reason


def _check_password(admin: User, password: str) -> None:
    if not verify_password(admin.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)


def _administrators(db: Session, organization_id: uuid.UUID, except_ids: set) -> list[uuid.UUID]:
    return [
        m.user_id
        for m in db.scalars(
            scoped_select(Membership, organization_id).where(
                Membership.role == Role.ORG_ADMIN, Membership.status == MembershipStatus.ACTIVE
            )
        )
        if m.user_id not in except_ids
    ]


# ---------------------------------------------------------------- in one organization


@dataclass
class Impact:
    """What a suspension does (UC-10.2 step 2), shown before the administrator confirms."""

    member: str
    sessions: int
    other_administrators: list[str] = field(default_factory=list)


def _member(db: Session, admin: Membership, membership_id: uuid.UUID) -> tuple[Membership, User]:
    membership = db.scalar(
        scoped_select(Membership, admin.organization_id).where(Membership.id == membership_id)
    )
    if membership is None:  # also a member of another organization (NFR-3.3)
        raise NotFoundError("Member not found.")
    return membership, db.get_one(User, membership.user_id)


def impact(db: Session, admin: Membership, membership_id: uuid.UUID) -> Impact:
    membership, user = _member(db, admin, membership_id)
    sessions = db.scalar(
        select(func.count())
        .select_from(UserSession)
        .where(UserSession.user_id == user.id, UserSession.organization_id == admin.organization_id)
    )
    others = _administrators(db, admin.organization_id, {admin.user_id, user.id})
    names = db.scalars(select(User.name).where(User.id.in_(others)).order_by(User.name)).all()
    return Impact(member=user.name, sessions=sessions, other_administrators=list(names))


def suspend_member(
    db: Session,
    admin: Membership,
    admin_user: User,
    membership_id: uuid.UUID,
    reason: str,
    password: str,
    background: BackgroundTasks,
) -> Membership:
    """UC-10.2 steps 1-6: the member's access ends at once; the role and history stay."""
    membership, user = _member(db, admin, membership_id)
    reason = _reason(reason)
    _check_password(admin_user, password)
    if user.id == admin_user.id:
        raise ConflictError("You can't suspend yourself.", code="suspend_self")
    if not membership.active:
        raise ConflictError(f"{user.name} is already suspended.", code="already_suspended")
    if is_last_admin(db, membership):
        raise ConflictError(
            f"{user.name} is the only Organization Administrator. "
            "Give another member this role first.",
            code="last_admin",
        )

    membership.status = MembershipStatus.SUSPENDED
    membership.suspended_at, membership.suspended_by_id = _now(), admin_user.id
    membership.suspension_reason, membership.suspended_by_platform = reason, False
    _end_sessions(db, user, admin.organization_id)
    organization = db.get_one(Organization, admin.organization_id)
    audit.record(
        db,
        organization_id=organization.id,
        actor=admin_user,
        action="member.suspended",
        summary=f"Suspended {user.name}: {reason}",
        item=audit.Item("member", user.id, user.name),
        details={"reason": reason},
    )
    db.commit()
    background.add_task(
        send_email, user.email, *emails.membership_suspended(user.name, organization.name, reason)
    )
    # Step 5: the other administrators are informed (FR-9.3).
    notify(
        db,
        event="account_security",
        user_ids=_administrators(db, organization.id, {admin_user.id}),
        organization_id=organization.id,
        text=f"{admin_user.name} suspended {user.name} in {organization.name}: {reason}",
        subject=user.name,
        link="/admin/members",
    )
    return membership


def reactivate_member(
    db: Session,
    admin: Membership,
    admin_user: User,
    membership_id: uuid.UUID,
    password: str,
    background: BackgroundTasks,
) -> Membership:
    """UC-10.2, 1b: the access returns with the previous role."""
    membership, user = _member(db, admin, membership_id)
    _check_password(admin_user, password)
    if membership.active:
        raise ConflictError(f"{user.name} isn't suspended.", code="not_suspended")
    if user.status == UserStatus.DISABLED:
        raise ConflictError(
            f"{user.name}'s whole account is suspended by a Sentra Platform Administrator, who "
            "must reactivate it.",
            code="account_suspended",
        )
    _restore(membership)
    organization = db.get_one(Organization, admin.organization_id)
    audit.record(
        db,
        organization_id=organization.id,
        actor=admin_user,
        action="member.reactivated",
        summary=f"Reactivated {user.name}",
        item=audit.Item("member", user.id, user.name),
    )
    db.commit()
    background.add_task(
        send_email, user.email, *emails.membership_reactivated(user.name, organization.name)
    )
    return membership


def _restore(membership: Membership) -> None:
    membership.status = MembershipStatus.ACTIVE
    membership.suspended_at = membership.suspended_by_id = membership.suspension_reason = None
    membership.suspended_by_platform = False


def _end_sessions(db: Session, user: User, organization_id: uuid.UUID | None) -> int:
    """Step 4: the member's sessions in the organization end at once (all of them for 1a)."""
    query = delete(UserSession).where(UserSession.user_id == user.id)
    if organization_id is not None:
        query = query.where(UserSession.organization_id == organization_id)
    return db.execute(query).rowcount or 0


# ---------------------------------------------------------------- the platform (UC-10.2, 1a)


@dataclass
class AccountRow:
    user: User
    organizations: list[tuple[str, str]]  # (name, membership status)
    last_login_new_address: bool


def _new_address(events: list[AccountEvent]) -> bool:
    """Whether the newest login came from an address that the account didn't use for a login in
    the 30 days before it. Without an earlier login there is nothing to compare with."""
    if not events or events[0].ip_address is None:
        return False
    last = events[0]
    earlier = [
        e.ip_address
        for e in events[1:]
        if e.created_at >= last.created_at - NEW_ADDRESS_WINDOW and e.ip_address
    ]
    return bool(earlier) and last.ip_address not in earlier


def list_accounts(
    db: Session, search: str, status: str, page: int, page_size: int
) -> tuple[list[AccountRow], int]:
    """Every account, for security and support (Screen 64). Only account data: names of the
    organizations, never their content (NFR-3.3)."""
    query = select(User).where(User.status != UserStatus.UNVERIFIED)
    if search.strip():
        like = f"%{search.strip().lower()}%"
        query = query.where(or_(func.lower(User.name).like(like), User.email.like(like)))
    if status in ("active", "disabled"):
        query = query.where(User.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    users = db.scalars(
        query.order_by(User.last_login_at.desc().nulls_last(), User.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return _rows(db, list(users)), total


def account_row(db: Session, user_id: uuid.UUID) -> AccountRow:
    return _rows(db, [_account(db, user_id)])[0]


def _rows(db: Session, users: list[User]) -> list[AccountRow]:
    ids = [u.id for u in users]
    organizations: dict[uuid.UUID, list[tuple[str, str]]] = defaultdict(list)
    for user_id, name, membership_status in db.execute(
        select(Membership.user_id, Organization.name, Membership.status)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(Membership.user_id.in_(ids))
        .order_by(Organization.name)
    ):
        organizations[user_id].append((name, membership_status))
    logins: dict[uuid.UUID, list[AccountEvent]] = defaultdict(list)
    for event in db.scalars(
        select(AccountEvent)
        .where(
            AccountEvent.user_id.in_(ids),
            AccountEvent.kind == AccountEventKind.LOGGED_IN,
            AccountEvent.created_at >= _now() - timedelta(days=90),
        )
        .order_by(AccountEvent.created_at.desc())
    ):
        logins[event.user_id].append(event)
    return [AccountRow(u, organizations[u.id], _new_address(logins[u.id])) for u in users]


def _account(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None or user.status == UserStatus.UNVERIFIED:
        raise NotFoundError("Account not found.")
    return user


def _memberships(db: Session, user: User) -> list[tuple[Membership, Organization]]:
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    )
    return [(membership, organization) for membership, organization in rows]


def suspend_account(
    db: Session,
    platform_admin: User,
    user_id: uuid.UUID,
    reason: str,
    password: str,
    background: BackgroundTasks,
) -> User:
    """UC-10.2, 1a: the account is suspended in every organization it belongs to, every session
    ends, and the Organization Administrators of those organizations are informed."""
    user = _account(db, user_id)
    reason = _reason(reason)
    _check_password(platform_admin, password)
    if user.id == platform_admin.id:
        raise ConflictError("You can't suspend your own account.", code="suspend_self")
    if user.status == UserStatus.DISABLED:
        raise ConflictError(
            f"{user.name}'s account is already suspended.", code="already_suspended"
        )

    user.status = UserStatus.DISABLED
    user.suspended_at, user.suspension_reason = _now(), reason
    memberships = _memberships(db, user)
    for membership, _ in memberships:
        if membership.active:
            membership.status = MembershipStatus.SUSPENDED
            membership.suspended_at, membership.suspended_by_id = _now(), platform_admin.id
            membership.suspension_reason, membership.suspended_by_platform = reason, True
    _end_sessions(db, user, None)
    names = [organization.name for _, organization in memberships]
    audit.record(
        db,
        organization_id=None,
        actor=platform_admin,
        action="account.suspended",
        summary=f"Suspended the account of {user.name} in {len(names)} organization"
        f"{'' if len(names) == 1 else 's'}: {reason}",
        item=audit.Item("account", user.id, user.name),
        details={"reason": reason, "organizations": names},
    )
    for _, organization in memberships:
        audit.record(
            db,
            organization_id=organization.id,
            actor=platform_admin,
            action="member.suspended",
            summary=f"A Sentra Platform Administrator suspended {user.name}'s account: {reason}",
            item=audit.Item("member", user.id, user.name),
            details={"reason": reason, "by": "Platform Administrator"},
        )
    db.commit()
    background.add_task(send_email, user.email, *emails.account_suspended(user.name, reason))
    for _, organization in memberships:
        notify(
            db,
            event="account_security",
            user_ids=_administrators(db, organization.id, {user.id}),
            organization_id=organization.id,
            text=f"A Sentra Platform Administrator suspended {user.name}'s account for security "
            f"or support reasons: {reason}",
            subject=user.name,
            link="/admin/members",
        )
    return user


def reactivate_account(
    db: Session,
    platform_admin: User,
    user_id: uuid.UUID,
    password: str,
    background: BackgroundTasks,
) -> User:
    """UC-10.2, 1b for a whole account: the memberships the platform suspended return with their
    previous roles; those an organization suspended itself stay suspended."""
    user = _account(db, user_id)
    _check_password(platform_admin, password)
    if user.status != UserStatus.DISABLED:
        raise ConflictError(f"{user.name}'s account isn't suspended.", code="not_suspended")
    user.status = UserStatus.ACTIVE
    user.suspended_at = user.suspension_reason = None
    restored = []
    for membership, organization in _memberships(db, user):
        if membership.suspended_by_platform:
            _restore(membership)
            restored.append(organization)
    audit.record(
        db,
        organization_id=None,
        actor=platform_admin,
        action="account.reactivated",
        summary=f"Reactivated the account of {user.name}",
        item=audit.Item("account", user.id, user.name),
        details={"organizations": [o.name for o in restored]},
    )
    for organization in restored:
        audit.record(
            db,
            organization_id=organization.id,
            actor=platform_admin,
            action="member.reactivated",
            summary=f"A Sentra Platform Administrator reactivated {user.name}'s account",
            item=audit.Item("member", user.id, user.name),
        )
    db.commit()
    background.add_task(send_email, user.email, *emails.account_reactivated(user.name))
    return user
