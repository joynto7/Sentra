"""What the autopilot keeps: one row per assessment it runs, with the stage it is in and a short log
of what it did, so that its page can show the whole story and a tick of the scheduler can carry on
after a restart (NFR-2.2): the state is in the database, never in a worker."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class AutopilotStatus:
    RUNNING = "running"  # it is doing, or waiting for, a job of Sentra's own
    WAITING = "waiting"  # it waits for a person (see `waiting_for`)
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


ACTIVE = (AutopilotStatus.RUNNING, AutopilotStatus.WAITING)


class Stage:
    CHECK = "check"  # the target is verified and its profile reviewed
    THREAT_MODEL = "threat_model"  # an approved threat model exists (M3)
    CAMPAIGN = "campaign"  # the campaign is created (M5)
    RUN = "run"  # the run is launched and ends (M5)
    REMEDIATION = "remediation"  # proposals are drafted for the findings (M8)
    DONE = "done"


STAGES = (Stage.CHECK, Stage.THREAT_MODEL, Stage.CAMPAIGN, Stage.RUN, Stage.REMEDIATION, Stage.DONE)


class WaitingFor:
    """What a person has to do before the autopilot can go on."""

    REVIEW_PROFILE = "review_profile"
    APPROVE_THREAT_MODEL = "approve_threat_model"
    APPROVE_SCOPE = "approve_scope"


def _now() -> datetime:
    return datetime.now(UTC)


class AutopilotRun(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    __tablename__ = "autopilot_runs"
    __table_args__ = (
        UniqueConstraint("organization_id", "number"),
        Index("ix_autopilot_runs_status", "status"),
    )

    number: Mapped[int]  # shown as AP-007; counted per organization
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="RESTRICT"), index=True
    )
    started_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(10), default=AutopilotStatus.RUNNING)
    stage: Mapped[str] = mapped_column(String(15), default=Stage.CHECK)
    waiting_for: Mapped[str | None] = mapped_column(String(30))
    message: Mapped[str] = mapped_column(Text, default="")
    # What was decided when it started: the suites, the repetitions, the budget and the rate
    plan: Mapped[dict] = mapped_column(JSONB, default=dict)
    # What a stage needs to remember: the job it waits for, the findings it asked proposals for
    state: Mapped[dict] = mapped_column(JSONB, default=dict)
    # The story: [{"stage", "at", "text"}], oldest first
    steps: Mapped[list] = mapped_column(JSONB, default=list)
    summary: Mapped[dict | None] = mapped_column(JSONB)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="SET NULL")
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL")
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def code(self) -> str:
        return f"AP-{self.number:03d}"
