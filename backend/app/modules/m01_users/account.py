"""Profile management (FR-1.7, UC-1.11): personal details, a new e-mail address, the password,
sessions and recent activity. Notification preferences come with FR-9.3."""

import re
import uuid
from datetime import timedelta

from fastapi import BackgroundTasks
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, FieldValidationError, NotFoundError
from app.modules.m01_users import emails
from app.modules.m01_users.models import (
    AccountEvent,
    AccountEventKind,
    OneTimeToken,
    TokenPurpose,
    User,
    UserSession,
)
from app.modules.m01_users.security import hash_password, verify_password
from app.modules.m01_users.service import (
    _issue_token,
    _normalize,
    _now,
    _send,
    _use_token,
    check_password,
    record,
)

CHANGE_EMAIL_VALID_FOR = timedelta(hours=24)
RECENT_EVENTS = 20


# ---------------------------------------------------------------- personal details


def update_profile(db: Session, user: User, name: str, phone: str | None) -> User:
    """UC-1.11 steps 2-3: the name and the optional phone number."""
    errors = []
    name = name.strip()
    if not name:
        errors.append({"field": "name", "message": "Enter your name."})
    elif len(name) > 200:
        errors.append({"field": "name", "message": "Use at most 200 characters."})
    phone = (phone or "").strip() or None
    if phone is not None:
        digits = re.sub(r"\D", "", phone)
        if not re.fullmatch(r"\+?[0-9 ()./-]+", phone) or not 6 <= len(digits) <= 15:
            errors.append(
                {"field": "phone", "message": "Enter a phone number such as +880 1712 345678."}
            )
    if errors:
        raise AppError(
            "Some fields are invalid.", code="validation_error", status_code=422, details=errors
        )
    user.name, user.phone = name, phone
    db.commit()
    return user


# ---------------------------------------------------------------- e-mail address (2a)


def request_email_change(
    db: Session,
    user: User,
    new_email: str,
    password: str,
    background: BackgroundTasks,
    ip_address: str | None,
) -> None:
    """UC-1.11, 2a: a link goes to the new address; the address changes only once it is
    confirmed. Changing it needs the password (NFR-3.5)."""
    if not verify_password(user.password_hash, password):
        raise FieldValidationError("password", "The password is incorrect.")
    new_email = _normalize(new_email)
    if new_email == user.email:
        raise FieldValidationError("email", "This is already your e-mail address.")
    # Whether another account uses the address is only checked when the link is opened, so this
    # form can't be used to find out which addresses have accounts.
    user.pending_email = new_email
    raw = _issue_token(db, user, TokenPurpose.CHANGE_EMAIL, CHANGE_EMAIL_VALID_FOR)
    record(db, user, AccountEventKind.EMAIL_CHANGE_REQUESTED, ip_address)
    db.commit()
    _send(background, new_email, emails.email_change(user.name, new_email, raw))


def cancel_email_change(db: Session, user: User) -> None:
    user.pending_email = None
    db.execute(
        delete(OneTimeToken).where(
            OneTimeToken.user_id == user.id,
            OneTimeToken.purpose == TokenPurpose.CHANGE_EMAIL,
            OneTimeToken.used_at.is_(None),
        )
    )
    db.commit()


def confirm_email_change(db: Session, raw: str, background: BackgroundTasks) -> User:
    """The link of the new address was opened: the address changes, and the old address is told."""
    user = _use_token(db, raw, TokenPurpose.CHANGE_EMAIL)
    new_email = user.pending_email
    if new_email is None:
        raise AppError("This link has expired or has already been used.", code="link_invalid")
    if db.scalar(select(User.id).where(User.email == new_email, User.id != user.id)):
        raise ConflictError(
            "This address is already used by another Sentra account.", code="email_taken"
        )
    old_email = user.email
    user.email, user.pending_email, user.email_verified_at = new_email, None, _now()
    record(db, user, AccountEventKind.EMAIL_CHANGED)
    db.commit()
    _send(background, old_email, emails.email_changed(user.name, new_email))
    return user


# ---------------------------------------------------------------- password (steps 4-5)


def change_password(
    db: Session,
    user: User,
    session: UserSession,
    current: str,
    new: str,
    background: BackgroundTasks,
    ip_address: str | None,
) -> None:
    """UC-1.11 steps 4-5 (4a, 5a): a salted hash is stored, every other session ends, and an
    e-mail confirms the change."""
    if not verify_password(user.password_hash, current):
        raise FieldValidationError("current_password", "The current password is incorrect.")
    check_password(new, user.email, "new_password")
    user.password_hash = hash_password(new)
    user.password_changed_at = _now()
    db.execute(
        delete(UserSession).where(UserSession.user_id == user.id, UserSession.id != session.id)
    )
    record(db, user, AccountEventKind.PASSWORD_CHANGED, ip_address)
    db.commit()
    _send(background, user.email, emails.password_changed_in_profile(user.name))


# ---------------------------------------------------------------- sessions (steps 6-7)


def active_sessions(db: Session, user: User) -> list[UserSession]:
    """The user's sessions that are still valid (not idle too long), newest activity first."""
    idle_limit = timedelta(minutes=get_settings().session_idle_minutes)
    return list(
        db.scalars(
            select(UserSession)
            .where(UserSession.user_id == user.id, UserSession.last_seen_at > _now() - idle_limit)
            .order_by(UserSession.last_seen_at.desc())
        )
    )


def end_session(
    db: Session, user: User, current: UserSession, session_id: uuid.UUID, ip: str | None
) -> None:
    """UC-1.11 step 7: the session ends at once; its next request is refused (NFR-3.5)."""
    target = db.scalar(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user.id)
    )
    if target is None:
        raise NotFoundError("Session not found.")
    if target.id == current.id:
        raise ConflictError("To end this session, log out.", code="current_session")
    db.delete(target)
    record(db, user, AccountEventKind.SESSION_ENDED, ip)
    db.commit()


def end_other_sessions(db: Session, user: User, current: UserSession, ip: str | None) -> int:
    result = db.execute(
        delete(UserSession).where(UserSession.user_id == user.id, UserSession.id != current.id)
    )
    if result.rowcount:
        record(db, user, AccountEventKind.OTHER_SESSIONS_ENDED, ip)
    db.commit()
    return result.rowcount


def recent_activity(db: Session, user: User) -> list[AccountEvent]:
    return list(
        db.scalars(
            select(AccountEvent)
            .where(AccountEvent.user_id == user.id)
            .order_by(AccountEvent.created_at.desc(), AccountEvent.id)
            .limit(RECENT_EVENTS)
        )
    )
