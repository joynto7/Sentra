"""Module 10's own tables, both halves of the module. The audit log of FR-10.2 lives in
`app/core/audit.py`, because every module writes to it.

Operations (FR-10.6, Screen 63): what is wrong with a component of Sentra, and the thresholds
that decide it. Governance (FR-10.5, UC-10.7 and UC-10.8): how long an organization keeps its
data, and what each daily clean-up deleted.

The periods live here and not on the `organizations` row, as the data-sharing setting does,
because they are read once a day and on one page, they carry who changed them and when, and the
foundation's organization row stays what Module 1 defines.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, UUIDPrimaryKey


class SystemAlert(UUIDPrimaryKey, Base):
    """One thing that is wrong with a component of Sentra (FR-10.6, UC-10.9 step 4). The same
    cause is one row: while it is open, `repeats` counts how often the Monitoring component saw it
    again, so administrators are not flooded (quality requirement 4). A component that recovers
    closes its own alert, and the row stays as the history of step 6.

    It holds operational data only, never anything of an organization (NFR-3.3).
    """

    __tablename__ = "system_alerts"
    __table_args__ = (
        # One open alert per component and cause.
        Index(
            "uq_system_alerts_open",
            "component",
            "kind",
            unique=True,
            postgresql_where=text("closed_at IS NULL"),
        ),
        Index("ix_system_alerts_opened_at", "opened_at"),
    )

    component: Mapped[str] = mapped_column(String(30))  # "api", "queue", "shield", …
    kind: Mapped[str] = mapped_column(String(40))  # what is wrong: "queue_too_long", "unreachable"
    summary: Mapped[str] = mapped_column(String(200))  # "Queue length above 1,000"
    effect: Mapped[str] = mapped_column(String(300))  # what it means: "Campaign runs start late"
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)  # the figures when it was raised
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    repeats: Mapped[int] = mapped_column(default=1)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_automatically: Mapped[bool] = mapped_column(default=False)


class HealthThresholds(UUIDPrimaryKey, Base):
    """The alert thresholds a Platform Administrator set (UC-10.9 step 3). One row at most: with
    none, the platform's defaults from the settings are in force, as with the usage limits of
    FR-10.4."""

    __tablename__ = "health_thresholds"

    queue_length: Mapped[int]
    error_rate_percent: Mapped[float] = mapped_column(Numeric(5, 2))
    worker_load_percent: Mapped[int]
    storage_percent: Mapped[int]
    gateway_silence_minutes: Mapped[int]
    note: Mapped[str | None] = mapped_column(Text)  # why they were changed, if anyone said
    set_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RetentionSettings(UUIDPrimaryKey, OrganizationScoped, Base):
    """The three periods of UC-10.7, in days. An organization without a row uses the platform's
    defaults, so UC-10.8's precondition holds from its first day."""

    __tablename__ = "retention_settings"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_retention_settings_organization"),
    )

    evidence_days: Mapped[int]
    campaign_days: Mapped[int]
    report_days: Mapped[int]
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RetentionRun(UUIDPrimaryKey, OrganizationScoped, Base):
    """One daily clean-up of one organization (UC-10.8): what it deleted, what it postponed and
    what it could not delete. Step 6 shows the newest one on Screen 60."""

    __tablename__ = "retention_runs"

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The periods it ran with, so a past clean-up can be explained after they have changed
    evidence_days: Mapped[int]
    campaign_days: Mapped[int]
    report_days: Mapped[int]
    evidence_deleted: Mapped[int] = mapped_column(default=0)
    evidence_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    attempts_deleted: Mapped[int] = mapped_column(default=0)
    reports_deleted: Mapped[int] = mapped_column(default=0)
    # 2a, and the RESTRICT of evidence.attempt_id: data that waits for the next clean-up
    postponed: Mapped[int] = mapped_column(default=0)
    # 3a: objects the storage would not delete. The keys are tried again next time, and after
    # three clean-ups in a row the Platform Administrators are told (3a1).
    failures: Mapped[int] = mapped_column(default=0)
    failed_keys: Mapped[list] = mapped_column(JSONB, default=list)
