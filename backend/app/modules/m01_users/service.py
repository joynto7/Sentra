"""Business logic for accounts, login and sessions (FR-1.1, UC-1.1 – UC-1.3)."""

from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.email import send_email
from app.core.errors import AppError, FieldValidationError
from app.modules.m01_users import emails
from app.modules.m01_users.models import (
    OneTimeToken,
    TokenPurpose,
    User,
    UserSession,
    UserStatus,
)
from app.modules.m01_users.password_policy import failed_rules
from app.modules.m01_users.schemas import RegisterRequest
from app.modules.m01_users.security import (
    hash_password,
    hash_token,
    needs_rehash,
    new_token,
    verify_password,
)

VERIFY_EMAIL_VALID_FOR = timedelta(hours=24)
RESET_PASSWORD_VALID_FOR = timedelta(minutes=30)

INVALID_CREDENTIALS = "The e-mail address or password is incorrect."
TERMS_REQUIRED = (
    "You need to accept the terms to create an account. "
    "Sentra may only test systems you are allowed to test."
)


def _now() -> datetime:
    return datetime.now(UTC)


def _normalize(email: str) -> str:
    return email.strip().lower()


def _check_password(password: str, email: str, field: str) -> None:
    failed = failed_rules(password, email)
    if failed:
        raise FieldValidationError(
            field, "The password must meet: " + "; ".join(rule.label for rule in failed) + "."
        )


def _issue_token(db: Session, user: User, purpose: TokenPurpose, valid_for: timedelta) -> str:
    # A new link replaces every older unused link of the same kind.
    db.execute(
        update(OneTimeToken)
        .where(
            OneTimeToken.user_id == user.id,
            OneTimeToken.purpose == purpose,
            OneTimeToken.used_at.is_(None),
        )
        .values(used_at=_now())
    )
    raw, token_hash = new_token()
    db.add(
        OneTimeToken(
            user_id=user.id, purpose=purpose, token_hash=token_hash, expires_at=_now() + valid_for
        )
    )
    return raw


def _use_token(db: Session, raw: str, purpose: TokenPurpose) -> User:
    token = db.scalar(
        select(OneTimeToken).where(
            OneTimeToken.token_hash == hash_token(raw), OneTimeToken.purpose == purpose
        )
    )
    if token is None or token.used_at is not None or token.expires_at <= _now():
        raise AppError("This link has expired or has already been used.", code="link_invalid")
    token.used_at = _now()
    return db.get_one(User, token.user_id)


def _send(background: BackgroundTasks, to: str, message: tuple[str, str]) -> None:
    subject, body = message
    background.add_task(send_email, to, subject, body)


# ---------------------------------------------------------------- registration


def register(db: Session, data: RegisterRequest, background: BackgroundTasks) -> None:
    """UC-1.1. The response never reveals whether the address was already registered."""
    email = _normalize(data.email)
    if not data.accept_terms:
        raise FieldValidationError("accept_terms", TERMS_REQUIRED)
    _check_password(data.password, email, "password")

    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        if existing.status == UserStatus.UNVERIFIED:
            raw = _issue_token(db, existing, TokenPurpose.VERIFY_EMAIL, VERIFY_EMAIL_VALID_FOR)
            db.commit()
            _send(background, email, emails.verification(existing.name, raw))
        else:
            _send(background, email, emails.already_registered(existing.name))
        return

    user = User(
        email=email,
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        status=UserStatus.UNVERIFIED,
        terms_accepted_at=_now(),
    )
    db.add(user)
    db.flush()
    raw = _issue_token(db, user, TokenPurpose.VERIFY_EMAIL, VERIFY_EMAIL_VALID_FOR)
    db.commit()
    _send(background, email, emails.verification(user.name, raw))


def verify_email(db: Session, raw: str) -> User:
    user = _use_token(db, raw, TokenPurpose.VERIFY_EMAIL)
    if user.status == UserStatus.UNVERIFIED:
        user.status = UserStatus.ACTIVE
        user.email_verified_at = _now()
    db.commit()
    return user


def resend_verification(db: Session, email: str, background: BackgroundTasks) -> None:
    user = db.scalar(select(User).where(User.email == _normalize(email)))
    if user is not None and user.status == UserStatus.UNVERIFIED:
        raw = _issue_token(db, user, TokenPurpose.VERIFY_EMAIL, VERIFY_EMAIL_VALID_FOR)
        db.commit()
        _send(background, user.email, emails.verification(user.name, raw))


# ---------------------------------------------------------------- login and sessions


def login(
    db: Session, email: str, password: str, user_agent: str | None, ip_address: str | None
) -> tuple[User, str]:
    """UC-1.2. Returns the user and the raw session token for the cookie."""
    settings = get_settings()
    user = db.scalar(select(User).where(User.email == _normalize(email)))

    if user is not None and user.locked_until is not None and user.locked_until > _now():
        raise AppError(
            "Too many failed attempts. Wait 15 minutes and try again.",
            code="too_many_attempts",
            status_code=429,
        )

    if user is None or not verify_password(user.password_hash, password):
        if user is not None:
            user.failed_login_count += 1
            if user.failed_login_count >= settings.login_max_failures:
                user.locked_until = _now() + timedelta(minutes=settings.login_lock_minutes)
                user.failed_login_count = 0
            db.commit()
        raise AppError(INVALID_CREDENTIALS, code="invalid_credentials", status_code=401)

    # The password is correct, so it is safe to say why the login cannot continue.
    if user.status == UserStatus.UNVERIFIED:
        raise AppError(
            "Confirm your e-mail address first. We can send you a new link.",
            code="email_not_verified",
            status_code=403,
        )
    if user.status == UserStatus.DISABLED:
        raise AppError(
            "This account is disabled. Contact your organization administrator.",
            code="account_disabled",
            status_code=403,
        )

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = _now()
    raw, token_hash = new_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=token_hash,
            user_agent=(user_agent or "")[:300] or None,
            ip_address=ip_address,
            last_seen_at=_now(),
        )
    )
    db.commit()
    return user, raw


def session_user(db: Session, raw: str) -> tuple[UserSession, User] | None:
    """The session and user for a cookie value, or None if it is unknown or idle too long."""
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(raw)))
    if session is None:
        return None
    idle_limit = timedelta(minutes=get_settings().session_idle_minutes)
    if session.last_seen_at + idle_limit <= _now():
        db.delete(session)
        db.commit()
        return None
    user = db.get_one(User, session.user_id)
    if user.status != UserStatus.ACTIVE:
        return None
    if _now() - session.last_seen_at > timedelta(minutes=1):
        session.last_seen_at = _now()
        db.commit()
    return session, user


def logout(db: Session, raw: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(raw)))
    db.commit()


# ---------------------------------------------------------------- password reset


def forgot_password(db: Session, email: str, background: BackgroundTasks) -> None:
    """UC-1.3 steps 1–2. Same response whether or not the account exists."""
    user = db.scalar(select(User).where(User.email == _normalize(email)))
    if user is not None and user.status == UserStatus.ACTIVE:
        raw = _issue_token(db, user, TokenPurpose.RESET_PASSWORD, RESET_PASSWORD_VALID_FOR)
        db.commit()
        _send(background, user.email, emails.password_reset(user.name, raw))


def reset_password(db: Session, raw: str, new_password: str, background: BackgroundTasks) -> None:
    """UC-1.3 steps 3–5: new password, all sessions ended, confirmation e-mail."""
    token = db.scalar(
        select(OneTimeToken).where(
            OneTimeToken.token_hash == hash_token(raw),
            OneTimeToken.purpose == TokenPurpose.RESET_PASSWORD,
        )
    )
    if token is not None:
        _check_password(new_password, db.get_one(User, token.user_id).email, "new_password")
    user = _use_token(db, raw, TokenPurpose.RESET_PASSWORD)
    user.password_hash = hash_password(new_password)
    user.failed_login_count = 0
    user.locked_until = None
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    _send(background, user.email, emails.password_changed(user.name))
