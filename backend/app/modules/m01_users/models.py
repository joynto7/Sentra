import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
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
    failed_login_count: Mapped[int] = mapped_column(server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The organization opened last, so the next login opens it again (UC-1.2, 6a).
    last_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"


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
