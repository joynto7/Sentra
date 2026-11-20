import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class UserStatus(StrEnum):
    UNVERIFIED = "unverified"  # registered, e-mail address not confirmed yet
    ACTIVE = "active"
    DISABLED = "disabled"


class User(UUIDPrimaryKey, Timestamps, Base):
    """A person with a Sentra account. Organization membership comes with FR-1.4."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), server_default=UserStatus.UNVERIFIED.value)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The organization opened last, so the next login opens it again (UC-1.2, 6a).
    last_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )
    # Profile (FR-1.7)
    phone: Mapped[str | None] = mapped_column(String(32))
    # A new address waiting for its confirmation link (UC-1.11, 2a); the address in use stays
    # `email` until then.
    pending_email: Mapped[str | None] = mapped_column(String(320))
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=func.now()
    )
    # Two-step verification (FR-1.2). The secret of the authenticator app is stored encrypted
    # (UC-1.4 quality requirement 3); a new one waits in mfa_pending_secret until its first code
    # is entered (UC-1.4 step 5).
    mfa_secret: Mapped[str | None] = mapped_column(Text)
    mfa_pending_secret: Mapped[str | None] = mapped_column(Text)
    mfa_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The time step of the last accepted code, so the same code can't be used twice.
    mfa_last_step: Mapped[int | None] = mapped_column(BigInteger)
    # The Platform Administrator operates Sentra itself and is not an organization role
    # (report 2.4, UC-10.1). Only a server command grants it (m10_admin/platform_admin.py).
    platform_admin: Mapped[bool] = mapped_column(default=False, server_default=text("false"))

    @property
    def mfa_enabled(self) -> bool:
        return self.mfa_enabled_at is not None


class LoginThrottle(Base):
    """Failed logins per typed e-mail address (UC-1.2 quality requirement). It is kept for every
    address, whether an account exists or not, so that a lock never tells which addresses have
    accounts (FR-1.1). Only a hash of the address is stored."""

    __tablename__ = "login_throttles"

    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    failures: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"
    CHANGE_EMAIL = "change_email"  # confirms the new address of UC-1.11, 2a
    MFA_LOGIN = "mfa_login"  # a login whose password was right, waiting for the second step


class OneTimeToken(UUIDPrimaryKey, Base):
    """A link sent by e-mail. Only a hash is stored; each link works once and expires."""

    __tablename__ = "one_time_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(30))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserSession(UUIDPrimaryKey, Base):
    """A logged-in browser. The cookie holds the token; the database holds only its hash."""

    __tablename__ = "sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # The organization this browser is working in (FR-1.4).
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # When the user last entered their password again in this session, for settings that need a
    # fresh confirmation, such as the organization's security (UC-1.7 step 2, NFR-3.5).
    password_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccountEventKind(StrEnum):
    """Security events of an account, shown under "Recent activity" (UC-1.11 step 6)."""

    LOGGED_IN = "logged_in"
    LOGIN_FAILED = "login_failed"  # the right address with a wrong password
    PASSWORD_CHANGED = "password_changed"
    PASSWORD_RESET = "password_reset"
    EMAIL_CHANGE_REQUESTED = "email_change_requested"
    EMAIL_CHANGED = "email_changed"
    SESSION_ENDED = "session_ended"  # the user logged out one of their other sessions
    OTHER_SESSIONS_ENDED = "other_sessions_ended"
    MFA_ENABLED = "mfa_enabled"
    MFA_FAILED = "mfa_failed"  # a wrong code in the second step of a login
    RECOVERY_CODE_USED = "recovery_code_used"
    RECOVERY_CODES_RENEWED = "recovery_codes_renewed"


class AccountEvent(UUIDPrimaryKey, Base):
    """One security event of a user's account, with where it came from."""

    __tablename__ = "account_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    # The moment of the event itself: the database's now() is the same for a whole transaction.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=func.now()
    )


class RecoveryCode(UUIDPrimaryKey, Base):
    """A code for logging in without the authenticator app (UC-1.2, 4a). It is hashed like a
    password and works once (UC-1.4 quality requirement 6)."""

    __tablename__ = "recovery_codes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(255))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Role(StrEnum):
    """The roles of a member in an organization (actors of the report, section 2.4)."""

    SECURITY_ANALYST = "security_analyst"
    TARGET_OWNER = "target_owner"  # AI Application Developer
    SECURITY_MANAGER = "security_manager"
    ORG_ADMIN = "org_admin"


ROLE_LABELS = {
    Role.SECURITY_ANALYST: "Security Analyst",
    Role.TARGET_OWNER: "AI Application Developer",
    Role.SECURITY_MANAGER: "Security Manager",
    Role.ORG_ADMIN: "Organization Administrator",
}


class Membership(UUIDPrimaryKey, Timestamps, Base):
    """A user's place in one organization, with a role. A user may have several (FR-1.4)."""

    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "organization_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(30))


class InvitationStatus(StrEnum):
    PENDING = "pending"  # shown as "expired" once expires_at has passed (UC-1.8, 5b)
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"


class Invitation(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """An invitation to join an organization with a role (FR-1.5). The link works once, only for
    this e-mail address, and expires; only a hash of its token is stored."""

    __tablename__ = "invitations"

    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(30))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(20), server_default=InvitationStatus.PENDING.value)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
