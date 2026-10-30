import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
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


class ReportType(StrEnum):
    """UC-9.1 step 1: for whom the report is written."""

    EXECUTIVE = "executive"  # risk summary, trends and recommendations in plain language
    TECHNICAL = "technical"  # every finding with its evidence, reproducibility and remediation


class ReportScope(StrEnum):
    """Step 2: what it covers."""

    ORGANIZATION = "organization"  # every target, with the dashboard's filters (1a1)
    TARGET = "target"
    CAMPAIGN_RUN = "campaign_run"


class ReportFormat(StrEnum):
    PDF = "pdf"  # for reading
    JSON = "json"  # for other tools


class ReportStatus(StrEnum):
    GENERATING = "generating"  # the worker is collecting and writing it (step 4)
    READY = "ready"
    EMPTY = "empty"  # 5a1: the scope held no result for the period, so no file was written
    FAILED = "failed"


class ScheduleFrequency(StrEnum):
    """UC-9.2 step 2: when the next report is produced."""

    AFTER_EACH_RUN = "after_each_run"  # after every campaign run of the target
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ScheduleStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"  # 4a: the user paused it; no report is produced until it is active again


class Report(UUIDPrimaryKey, OrganizationScoped, Base):
    """One generated report (FR-9.1, UC-9.1). The row is its own job: it is created while the
    worker writes it, and ends ready, empty or failed. The file itself lives in the object storage
    with its checksum, like the evidence of FR-6.3."""

    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("organization_id", "number"),)

    number: Mapped[int]  # shown as RP-418, counted per organization
    type: Mapped[str] = mapped_column(String(10))
    scope: Mapped[str] = mapped_column(String(15))
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("targets.id", ondelete="SET NULL")
    )
    campaign_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL")
    )
    # The period of an executive report, and the category filter it was made with (UC-7.3 step 4)
    period_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    period_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    category: Mapped[str | None] = mapped_column(String(5))
    format: Mapped[str] = mapped_column(String(5))
    status: Mapped[str] = mapped_column(String(12), default=ReportStatus.GENERATING)
    title: Mapped[str] = mapped_column(String(200))
    # What the list shows without opening the file: the counts the report is about
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    message: Mapped[str | None] = mapped_column(Text)  # why it is empty or failed
    object_key: Mapped[str | None] = mapped_column(String(200))
    checksum: Mapped[str | None] = mapped_column(String(64))  # SHA-256 of the file
    size_bytes: Mapped[int | None]
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("report_schedules.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def code(self) -> str:
        return f"RP-{self.number:03d}"


class ReportSchedule(UUIDPrimaryKey, OrganizationScoped, Base):
    """A standing order for reports (FR-9.2, UC-9.2): what to produce, how often, and which
    members get the link."""

    __tablename__ = "report_schedules"

    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(10))
    scope: Mapped[str] = mapped_column(String(15))
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE")
    )
    category: Mapped[str | None] = mapped_column(String(5))
    period_days: Mapped[int | None]  # the period an executive report covers
    format: Mapped[str] = mapped_column(String(5))
    frequency: Mapped[str] = mapped_column(String(20))
    # The members who get the link; only those who may read reports stay in it (3a1, 6a1)
    recipient_ids: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(10), default=ScheduleStatus.ACTIVE)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
