import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, UUIDPrimaryKey


def _now() -> datetime:
    return datetime.now(UTC)


class Notification(UUIDPrimaryKey, Base):
    """One in-app notification for one person (FR-9.3, UC-9.3). Several events of the same kind
    in a short time share one notification with a count (UC-9.3, 1a)."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_id_read_at", "user_id", "read_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # None for alerts about the account itself, which show in every organization of the user.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    event: Mapped[str] = mapped_column(String(40))
    text: Mapped[str] = mapped_column(
        String(300)
    )  # the sentence, e.g. "F-1168 was assigned to you"
    subject: Mapped[str] = mapped_column(String(120))  # the part shown in bold, e.g. "F-1168"
    link: Mapped[str | None] = mapped_column(String(300))  # the related item, inside Sentra
    count: Mapped[int] = mapped_column(default=1)
    group_key: Mapped[str | None] = mapped_column(String(120))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    # The latest event of the group: the time shown, and the order of the list.
    last_event_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class NotificationPreference(UUIDPrimaryKey, Base):
    """A user's choice for one event (UC-1.11 step 2). Without a row, both channels are on."""

    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "event"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event: Mapped[str] = mapped_column(String(40))
    in_app: Mapped[bool]
    email: Mapped[bool]


class ApiKeyScope(StrEnum):
    """What an integration may do with a key (UC-9.6 step 2, the five of Screen 56). None of them
    touches members, roles or other keys: a leaked key can never take over the organization
    (UC-9.6, quality requirement 2)."""

    RUN_SECURITY_GATE = "run_security_gate"
    READ_GATE_RESULTS = "read_gate_results"
    READ_FINDINGS = "read_findings"
    READ_REPORTS = "read_reports"
    LAUNCH_CAMPAIGNS = "launch_campaigns"


class ApiKey(UUIDPrimaryKey, OrganizationScoped, Base):
    """A key an integration authenticates with (FR-9.5, UC-9.6). Sentra keeps the first characters
    of the key, so a person can tell one key from another, and the SHA-256 of the whole key, never
    the key itself (NFR-3.1): it is shown once, when it is created."""

    __tablename__ = "api_keys"
    __table_args__ = (UniqueConstraint("prefix"),)

    name: Mapped[str] = mapped_column(String(80))
    purpose: Mapped[str] = mapped_column(String(300))
    prefix: Mapped[str] = mapped_column(String(16))  # snt_3f9a2b1c, shown on the page
    key_hash: Mapped[str] = mapped_column(String(64))
    scopes: Mapped[list] = mapped_column(JSONB, default=list)
    # The targets the key is limited to; empty means every target of the organization (step 2).
    target_ids: Mapped[list] = mapped_column(JSONB, default=list)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 1a1: a revoked key is refused at once and stays listed with the date it was revoked.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # So that unused keys can be found and revoked (UC-9.6, quality requirement 3)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 3a1: the administrators are told once that the key is about to expire
    expiry_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
