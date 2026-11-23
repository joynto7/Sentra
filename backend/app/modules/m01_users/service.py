"""Business logic for accounts, login and sessions (FR-1.1, UC-1.1 – UC-1.3)."""

from datetime import UTC, datetime, timedelta
from enum import StrEnum

from fastapi import BackgroundTasks
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.email import send_email
from app.core.errors import AppError, FieldValidationError, NotAuthenticatedError
from app.modules.m01_users import emails, organizations
from app.modules.m01_users.models import (
    AccountEvent,
    AccountEventKind,
    LoginThrottle,
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
from app.modules.m09_reporting.notifications import notify

VERIFY_EMAIL_VALID_FOR = timedelta(hours=24)
RESET_PASSWORD_VALID_FOR = timedelta(minutes=30)
# Time for the second step of a login, including setting up an app when it is required (UC-1.2).
SECOND_STEP_VALID_FOR = timedelta(minutes=15)

INVALID_CREDENTIALS = "The e-mail address or password is incorrect."
LOGIN_EXPIRED = "Your login has expired. Log in again."
WRONG_PASSWORD = "The password is incorrect."
TERMS_REQUIRED = (
    "You need to accept the terms to create an account. "
    "Sentra may only test systems you are allowed to test."
)


def _now() -> datetime:
    return datetime.now(UTC)


def _normalize(email: str) -> str:
    return email.strip().lower()


def check_password(password: str, email: str, field: str) -> None:
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


def record(
    db: Session,
    user: User,
    kind: AccountEventKind,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Adds an event to the user's recent activity (UC-1.11 step 6). The caller commits."""
    db.add(
        AccountEvent(
            user_id=user.id,
            kind=kind,
            ip_address=ip_address,
            user_agent=(user_agent or "")[:300] or None,
        )
    )


# ---------------------------------------------------------------- registration


def register(db: Session, data: RegisterRequest, background: BackgroundTasks) -> None:
    """UC-1.1. The response never reveals whether the address was already registered."""
    email = _normalize(data.email)
    if not data.accept_terms:
        raise FieldValidationError("accept_terms", TERMS_REQUIRED)
    check_password(data.password, email, "password")

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


class LoginStep(StrEnum):
    """What follows a correct password (UC-1.2)."""

    DONE = "done"  # logged in (3a: no two-step verification)
    MFA = "mfa"  # enter a code from the authenticator app (steps 3-4)
    MFA_SETUP = "mfa_setup"  # an organization requires it, so it is set up first (3b)


def is_locked(db: Session, email: str) -> bool:
    throttle = db.get(LoginThrottle, hash_token(_normalize(email)))
    return (
        throttle is not None
        and throttle.locked_until is not None
        and (throttle.locked_until > _now())
    )


def check_not_locked(db: Session, email: str) -> None:
    if is_locked(db, email):
        raise AppError(
            "Too many failed attempts. Wait 15 minutes and try again.",
            code="too_many_attempts",
            status_code=429,
        )


def count_failed_attempt(
    db: Session,
    email: str,
    user: User | None,
    kind: AccountEventKind,
    ip_address: str | None,
    user_agent: str | None,
) -> None:
    """A wrong password or code (UC-1.2 quality requirement): five in a row lock the address for
    15 minutes, which makes guessing too slow to work. Unknown addresses are counted the same
    way, so the lock reveals nothing (FR-1.1). The caller commits."""
    settings = get_settings()
    if user is not None:
        record(db, user, kind, ip_address, user_agent)
    key = hash_token(_normalize(email))
    throttle = db.get(LoginThrottle, key) or LoginThrottle(email_hash=key, failures=0)
    db.add(throttle)
    throttle.failures += 1
    throttle.updated_at = _now()
    if throttle.failures >= settings.login_max_failures:
        throttle.locked_until = _now() + timedelta(minutes=settings.login_lock_minutes)
        throttle.failures = 0
    # Addresses with no failure for a day are forgotten, so the table stays small.
    db.execute(delete(LoginThrottle).where(LoginThrottle.updated_at < _now() - timedelta(days=1)))


def forget_failures(db: Session, email: str) -> None:
    """After a successful login or a password reset. The caller commits."""
    db.execute(delete(LoginThrottle).where(LoginThrottle.email_hash == hash_token(email)))


def login(
    db: Session, email: str, password: str, user_agent: str | None, ip_address: str | None
) -> tuple[User, LoginStep, str]:
    """UC-1.2 steps 1-2. Returns the user, the next step and a raw token: the session token when
    the step is DONE, else the token of the second step (steps 3-4)."""
    email = _normalize(email)
    check_not_locked(db, email)  # for every address, so a lock says nothing about accounts
    user = db.scalar(select(User).where(User.email == email))

    if user is None or not verify_password(user.password_hash, password):
        count_failed_attempt(db, email, user, AccountEventKind.LOGIN_FAILED, ip_address, user_agent)
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

    # Steps 3-4: with two-step verification the session waits for the code. The failed attempts
    # are not reset yet, so entering the password again doesn't give more tries at the code.
    if user.mfa_enabled or organizations.mfa_required_by(db, user):
        step = LoginStep.MFA if user.mfa_enabled else LoginStep.MFA_SETUP
        return user, step, start_second_step(db, user)

    forget_failures(db, user.email)
    raw = start_session(db, user, user_agent, ip_address)
    record(db, user, AccountEventKind.LOGGED_IN, ip_address, user_agent)
    db.commit()
    return user, LoginStep.DONE, raw


def sso_session(
    db: Session,
    user: User,
    organization_id,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[LoginStep, str]:
    """UC-1.5 step 6: the session of a login that the identity provider vouched for, and the
    workspace it opens. Quality requirement 6 — the same security rules as a password login — so
    an organization that requires two-step verification still gets it: the requirement is the
    organization's own, and a provider cannot answer for it. The caller commits."""
    user.last_organization_id = organization_id
    if user.mfa_enabled or organizations.mfa_required_by(db, user):
        step = LoginStep.MFA if user.mfa_enabled else LoginStep.MFA_SETUP
        return step, start_second_step(db, user)
    raw = start_session(db, user, user_agent, ip_address)
    record(db, user, AccountEventKind.LOGGED_IN_SSO, ip_address, user_agent)
    return LoginStep.DONE, raw


def start_second_step(db: Session, user: User) -> str:
    """The raw token of a login's second step (steps 3-4). Starting a new login ends an older
    one that is still waiting."""
    raw = _issue_token(db, user, TokenPurpose.MFA_LOGIN, SECOND_STEP_VALID_FOR)
    db.commit()
    return raw


def _second_step_token(db: Session, raw: str | None) -> OneTimeToken:
    token = None
    if raw:
        token = db.scalar(
            select(OneTimeToken).where(
                OneTimeToken.token_hash == hash_token(raw),
                OneTimeToken.purpose == TokenPurpose.MFA_LOGIN,
            )
        )
    if token is None or token.used_at is not None or token.expires_at <= _now():
        raise NotAuthenticatedError(LOGIN_EXPIRED, code="login_expired")
    return token


def pending_login(db: Session, raw: str | None) -> User:
    """The user of a login whose password was right and whose second step is still open."""
    user = db.get_one(User, _second_step_token(db, raw).user_id)
    if user.status != UserStatus.ACTIVE:
        raise NotAuthenticatedError(LOGIN_EXPIRED, code="login_expired")
    return user


def finish_login(
    db: Session, raw: str | None, user: User, user_agent: str | None, ip_address: str | None
) -> str:
    """UC-1.2 step 5 after the second step: the token is used up and the session starts.
    Returns the raw session token."""
    _second_step_token(db, raw).used_at = _now()
    forget_failures(db, user.email)
    session = start_session(db, user, user_agent, ip_address)
    record(db, user, AccountEventKind.LOGGED_IN, ip_address, user_agent)
    db.commit()
    return session


def cancel_login(db: Session, raw: str | None) -> None:
    """ "Back to login" or "Not you?" during the second step: the token stops working."""
    if not raw:
        return
    db.execute(
        update(OneTimeToken)
        .where(
            OneTimeToken.token_hash == hash_token(raw),
            OneTimeToken.purpose == TokenPurpose.MFA_LOGIN,
            OneTimeToken.used_at.is_(None),
        )
        .values(used_at=_now())
    )
    db.commit()


def start_session(db: Session, user: User, user_agent: str | None, ip_address: str | None) -> str:
    """A new login session; returns the raw token for the cookie. The caller commits."""
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
    return raw


def account_exists(db: Session, email: str) -> bool:
    """Whether an active account uses this address. Only the invitation page asks, and only the
    holder of the invitation link, who received it at that address, sees the answer (UC-1.9)."""
    user = db.scalar(select(User).where(User.email == _normalize(email)))
    return user is not None and user.status != UserStatus.UNVERIFIED


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


def confirm_password(db: Session, user: User, session: UserSession, password: str) -> None:
    """The user enters their password again before changing security settings (UC-1.7 step 2,
    NFR-3.5). For a few minutes afterwards, this session may change them."""
    if not verify_password(user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    session.password_confirmed_at = _now()
    db.commit()


def password_confirmed_until(session: UserSession) -> datetime | None:
    if session.password_confirmed_at is None:
        return None
    minutes = get_settings().password_confirmation_minutes
    return session.password_confirmed_at + timedelta(minutes=minutes)


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
        check_password(new_password, db.get_one(User, token.user_id).email, "new_password")
    user = _use_token(db, raw, TokenPurpose.RESET_PASSWORD)
    user.password_hash = hash_password(new_password)
    user.password_changed_at = _now()
    forget_failures(db, user.email)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    record(db, user, AccountEventKind.PASSWORD_RESET)
    db.commit()
    _send(background, user.email, emails.password_changed(user.name))
    notify(
        db,
        event="account_security",
        user_ids=[user.id],
        organization_id=None,
        text="Your password was reset with an e-mail link, and every session was logged out",
        subject="password",
        link="/account/security",
        email=False,
    )
