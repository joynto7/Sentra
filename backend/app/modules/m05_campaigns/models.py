import uuid
from datetime import time
from enum import StrEnum

from sqlalchemy import ForeignKey, String, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class ApprovalStatus(StrEnum):
    """Scope approval (FR-5.2, optional): until an organization requires it, none is needed."""

    NOT_REQUIRED = "not_required"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    REJECTED = "rejected"


class Campaign(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """A planned security assessment of one target: what is tested, how much and how fast
    (FR-5.1). Creating it sends nothing to the target; runs come with FR-5.4."""

    __tablename__ = "campaigns"
    __table_args__ = (UniqueConstraint("organization_id", "number"),)

    number: Mapped[int]  # shown as C-238; counted per organization
    name: Mapped[str] = mapped_column(String(120))
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="RESTRICT"), index=True
    )
    # Suite codes: a run fixes and records the version of each suite and test it uses (FR-4.5).
    suites: Mapped[list[str]] = mapped_column(JSONB)
    adaptive_agent: Mapped[bool] = mapped_column(default=False)  # FR-5.5
    attempt_budget: Mapped[int]
    request_rate: Mapped[int]  # per minute; never above the target's safe rate (FR-5.7)
    repetitions: Mapped[int]  # how often a successful attempt is repeated (FR-6.4)
    # An optional daily window, as clock times in the campaign's time zone (e.g. 02:00-05:00).
    window_start: Mapped[time | None] = mapped_column(Time)
    window_end: Mapped[time | None] = mapped_column(Time)
    time_zone: Mapped[str] = mapped_column(String(64))  # IANA name, e.g. Asia/Dhaka
    approval_status: Mapped[str] = mapped_column(
        String(20), default=ApprovalStatus.NOT_REQUIRED, server_default=ApprovalStatus.NOT_REQUIRED
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    @property
    def code(self) -> str:
        return f"C-{self.number:03d}"
