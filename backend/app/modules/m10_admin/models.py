"""Module 10's own tables. The audit log of FR-10.2 lives in `app/core/audit.py`, because every
module writes to it; these two belong to the operations part (FR-10.6, Screen 63)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import UUIDPrimaryKey


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
