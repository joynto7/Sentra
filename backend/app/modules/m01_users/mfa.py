"""Two-step verification (FR-1.2): a code from an authenticator app after the password.

- UC-1.4 Enable Multi-Factor Authentication: a new secret as a QR code, its first code, then ten
  recovery codes. Started from the profile after the password (steps 1-2), or by a login when an
  organization requires it (1a).
- UC-1.2 Log In, steps 3-5: the code, or a recovery code instead (4a). Wrong codes count as failed
  logins (4b).
- UC-1.7 Configure Organization Security, steps 3 and 7: an organization requires it of every
  member.

The secret is stored encrypted and the recovery codes only as hashes (UC-1.4 quality requirements
3 and 6). The codes of the app are computed in totp.py.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime

from fastapi import BackgroundTasks
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt, encrypt
from app.core.errors import ConflictError, FieldValidationError
from app.core.models import Organization
from app.modules.m01_users import emails, organizations, totp
from app.modules.m01_users.models import AccountEventKind, Membership, RecoveryCode, User
from app.modules.m01_users.security import hash_password, verify_password
from app.modules.m01_users.service import (
    WRONG_PASSWORD,
    _now,
    _send,
    cancel_login,
    check_not_locked,
    count_failed_attempt,
    finish_login,
    is_locked,
    pending_login,
    record,
)
from app.modules.m09_reporting.notifications import notify

RECOVERY_CODE_COUNT = 10
# 8 characters without 0/O and 1/I/L, which are easy to mix up on paper: about 40 bits each.
RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

WRONG_SETUP_CODE = "That code didn't match. Wait for a new code and try again."
WRONG_CODE = "That code is incorrect or has expired. Enter the newest code from your app."
WRONG_RECOVERY_CODE = "That recovery code is incorrect or has already been used."
ALREADY_ON = "Two-step verification is already on."


@dataclass
class Setup:
    """What UC-1.4 step 3 shows: the QR code, and the same secret as a key to type in."""

    secret: str
    uri: str
    qr_code: str


@dataclass
class Status:
    """The "Two-step verification" card of the Security page (Screen 09)."""

    enabled_at: datetime | None
    recovery_codes_left: int
    recovery_codes_total: int
    required_by: list[str]


def _context(user: User) -> str:
    # The encrypted secret can only be decrypted for this user's row (see app.core.crypto).
    return f"mfa-secret:{user.id}"


def status(db: Session, user: User) -> Status:
    used = list(db.scalars(select(RecoveryCode.used_at).where(RecoveryCode.user_id == user.id)))
    return Status(
        enabled_at=user.mfa_enabled_at,
        recovery_codes_left=used.count(None),
        recovery_codes_total=len(used),
        required_by=organizations.mfa_required_by(db, user),
    )


# ---------------------------------------------------------------- setting it up (UC-1.4)


def start_setup(db: Session, user: User, password: str) -> Setup:
    """Steps 1-3 from the profile: the password again (2, 2a), then a new secret."""
    if not verify_password(user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    return _new_secret(db, user)


def start_setup_at_login(db: Session, raw_login: str | None) -> Setup:
    """1a: a login started the setup, so the password was entered a moment ago."""
    return _new_secret(db, pending_login(db, raw_login))


def _new_secret(db: Session, user: User) -> Setup:
    """Step 3. The secret is shown only now. It waits, encrypted, until its first code is
    entered (step 5); starting again replaces it."""
    if user.mfa_enabled:
        raise ConflictError(ALREADY_ON, code="mfa_already_on")
    secret = totp.new_secret()
    user.mfa_pending_secret = encrypt(secret, _context(user))
    db.commit()
    uri = totp.setup_uri(secret, user.email)
    return Setup(secret=secret, uri=uri, qr_code=totp.qr_code(uri))


def enable_mfa(
    db: Session,
    user: User,
    code: str,
    ip_address: str | None,
    user_agent: str | None,
    background: BackgroundTasks,
) -> list[str]:
    """Steps 4-7 (5a): the first code proves that the app holds the secret, and two-step
    verification is on. Returns the recovery codes, which are shown only once (step 6)."""
    if user.mfa_enabled:
        raise ConflictError(ALREADY_ON, code="mfa_already_on")
    if user.mfa_pending_secret is None:
        raise ConflictError("Start the setup again.", code="mfa_setup_missing")
    step = totp.matching_step(decrypt(user.mfa_pending_secret, _context(user)), code)
    if step is None:
        raise FieldValidationError("code", WRONG_SETUP_CODE)
    user.mfa_secret, user.mfa_pending_secret = user.mfa_pending_secret, None
    user.mfa_enabled_at = _now()
    user.mfa_last_step = step  # so this code can't be used for a login as well
    codes = _new_recovery_codes(db, user)
    record(db, user, AccountEventKind.MFA_ENABLED, ip_address, user_agent)
    db.commit()
    # Step 7: confirmed by e-mail, and in the application (FR-9.3).
    _send(background, user.email, emails.mfa_enabled(user.name))
    _tell(db, user, "Two-step verification was turned on for your account", "Two-step verification")
    return codes


def enable_at_login(
    db: Session,
    raw_login: str | None,
    code: str,
    ip_address: str | None,
    user_agent: str | None,
    background: BackgroundTasks,
) -> tuple[list[str], str]:
    """1a, steps 4-7, then UC-1.2 step 5: the session starts. Returns the recovery codes and the
    raw session token."""
    user = pending_login(db, raw_login)
    codes = enable_mfa(db, user, code, ip_address, user_agent, background)
    return codes, finish_login(db, raw_login, user, user_agent, ip_address)


# ---------------------------------------------------------------- recovery codes


def _new_recovery_codes(db: Session, user: User) -> list[str]:
    """Ten new codes in place of all earlier ones. Only their hashes are stored (quality
    requirement 6), so the codes are returned to be shown this once. The caller commits."""
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = [
        "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(8))
        for _ in range(RECOVERY_CODE_COUNT)
    ]
    db.add_all(RecoveryCode(user_id=user.id, code_hash=hash_password(code)) for code in codes)
    return [f"{code[:4]}-{code[4:]}" for code in codes]


def renew_recovery_codes(
    db: Session,
    user: User,
    password: str,
    ip_address: str | None,
    user_agent: str | None,
    background: BackgroundTasks,
) -> list[str]:
    """ "Generate new codes" on the Security page: the old codes stop working. It needs the
    password again (NFR-3.5)."""
    if not verify_password(user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    if not user.mfa_enabled:
        raise ConflictError("Turn on two-step verification first.", code="mfa_off")
    codes = _new_recovery_codes(db, user)
    record(db, user, AccountEventKind.RECOVERY_CODES_RENEWED, ip_address, user_agent)
    db.commit()
    _send(background, user.email, emails.recovery_codes_renewed(user.name))
    _tell(
        db,
        user,
        "New recovery codes were generated for your account. The old ones no longer work",
        "recovery codes",
    )
    return codes


def _use_recovery_code(db: Session, user: User, entered: str) -> bool:
    """4a: an unused code matches; it is used up now. Spaces, dashes and lower case don't
    matter. The caller commits."""
    entered = "".join(ch for ch in entered.upper() if ch.isalnum())
    if len(entered) != 8:
        return False
    unused = db.scalars(
        select(RecoveryCode).where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
    )
    for code in unused:
        if verify_password(code.code_hash, entered):
            code.used_at = _now()
            return True
    return False


# ---------------------------------------------------------------- the second step of a login


def verify_second_factor(user: User, code: str) -> bool:
    """UC-1.2 step 4: a code from the app. The code of a time step that was used already is
    refused, so each code works only once. The caller commits."""
    secret = decrypt(user.mfa_secret or "", _context(user))
    step = totp.matching_step(secret, code, used_up_to=user.mfa_last_step)
    if step is None:
        return False
    user.mfa_last_step = step
    return True


def log_in_with_code(
    db: Session,
    raw_login: str | None,
    code: str | None,
    recovery_code: str | None,
    ip_address: str | None,
    user_agent: str | None,
    background: BackgroundTasks,
) -> tuple[User, str]:
    """UC-1.2 steps 4-5 (4a, 4b). A wrong code counts as a failed login; at the fifth in a row the
    account is locked for a while and this login ends. Returns the user and the raw session
    token."""
    user = pending_login(db, raw_login)
    check_not_locked(db, user.email)
    if not user.mfa_enabled:
        raise ConflictError("Set up two-step verification first.", code="mfa_setup_required")

    if recovery_code is not None:
        right = _use_recovery_code(db, user, recovery_code)
        field, message = "recovery_code", WRONG_RECOVERY_CODE
    else:
        right = verify_second_factor(user, code or "")
        field, message = "code", WRONG_CODE
    if not right:
        count_failed_attempt(
            db, user.email, user, AccountEventKind.MFA_FAILED, ip_address, user_agent
        )
        db.commit()
        if is_locked(db, user.email):
            cancel_login(db, raw_login)
            check_not_locked(db, user.email)
        raise FieldValidationError(field, message)

    if recovery_code is not None:
        record(db, user, AccountEventKind.RECOVERY_CODE_USED, ip_address, user_agent)
    session = finish_login(db, raw_login, user, user_agent, ip_address)
    if recovery_code is not None:
        left = status(db, user).recovery_codes_left
        _send(background, user.email, emails.recovery_code_used(user.name, left))
        _tell(db, user, f"A recovery code was used to log in. {_codes_left(left)}", "recovery code")
    return user, session


def _codes_left(left: int) -> str:
    return "1 recovery code is left" if left == 1 else f"{left} recovery codes are left"


# ---------------------------------------------------------------- the organization (UC-1.7)


def members_without_mfa(db: Session, organization_id: uuid.UUID) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.organization_id == organization_id, User.mfa_enabled_at.is_(None))
            .order_by(User.name)
        )
    )


def require_mfa(
    db: Session, organization: Organization, required: bool, background: BackgroundTasks
) -> None:
    """Steps 3, 6 and 7 (3a). It applies from each member's next login (UC-1.2, 3b); the members
    who haven't turned it on are told now. Turning it off tells nobody."""
    if organization.mfa_required == required:
        return
    organization.mfa_required = required
    db.commit()
    if not required:
        return
    missing = members_without_mfa(db, organization.id)
    for member in missing:
        _send(background, member.email, emails.mfa_required(member.name, organization.name))
    notify(
        db,
        event="account_security",
        user_ids=[member.id for member in missing],
        organization_id=None,  # about the account, so shown in every organization
        text=f"{organization.name} now requires two-step verification. Set it up now, or "
        "you'll be asked to at your next login",
        subject="two-step verification",
        link="/account/security",
        email=False,
    )


def _tell(db: Session, user: User, text: str, subject: str) -> None:
    """An account alert in the application (FR-9.3); the e-mail is sent by the caller."""
    notify(
        db,
        event="account_security",
        user_ids=[user.id],
        organization_id=None,
        text=text,
        subject=subject,
        link="/account/security",
        email=False,
    )
