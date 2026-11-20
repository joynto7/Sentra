"""Module 11's tables. The lab target itself is an ordinary `Target` (UC-11.1 step 4), so this
holds only what the Security Lab knows on top of it (FR-11.2)."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class LabState(StrEnum):
    """Readiness, as Screen 65 shows it in words."""

    DEPLOYING = "deploying"  # UC-11.1 step 2: the worker is reading what it reports
    READY = "ready"
    RESETTING = "resetting"  # UC-11.2 step 1: no campaign run may use it
    NOT_READY = "not_ready"  # a reset failed twice (UC-11.2, 5a1), or it can't be reached


class LabDeployment(UUIDPrimaryKey, OrganizationScoped, Base):
    """One lab target of the catalogue, deployed in one organization (UC-11.1, NFR-3.3): which
    one it is, whether it is ready, and what it reported about itself.

    The resets are kept in the target's own history through the audit log (FR-2.6), so there is no
    second history here; this row holds what the page needs at a glance.
    """

    __tablename__ = "lab_deployments"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), unique=True
    )
    lab_key: Mapped[str] = mapped_column(String(40))  # catalogue.CATALOGUE
    state: Mapped[str] = mapped_column(String(20), default=LabState.READY)
    # What the lab target itself says it is vulnerable to (FR-11.1), read from /lab/state
    known_vulnerabilities: Mapped[list] = mapped_column(JSONB, default=list)
    deployed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resets: Mapped[int] = mapped_column(default=0)
    last_error: Mapped[str | None] = mapped_column(Text)  # why it is not ready, in words


class BenchmarkStatus(StrEnum):
    """Where a benchmark run stands (UC-11.3 step 6, UC-11.4)."""

    DRAFT = "draft"  # configured, not started
    RUNNING = "running"
    PAUSED = "paused"  # a reset failed (3a1) or a model changed (4b1); the analyst resumes it
    COMPLETED = "completed"
    STOPPED = "stopped"  # stopped by the analyst; what finished is kept


class RepetitionStatus(StrEnum):
    PLANNED = "planned"
    RESETTING = "resetting"  # its lab target is going back to its original state (UC-11.2)
    RUNNING = "running"
    COMPLETED = "completed"
    INCOMPLETE = "incomplete"  # its campaign run was stopped, so the evaluation leaves it out (4a1)


class BenchmarkRun(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """An experiment that compares testing strategies on the same lab targets under the same
    conditions (FR-11.3, UC-11.3). One campaign run per lab target, strategy and repetition, in a
    random interleaved order that is fixed when the run starts.

    The budget and the repetitions belong to the run and not to a strategy, so the configuration
    cannot express an unfair experiment (UC-11.3, quality requirement 3).
    """

    __tablename__ = "benchmark_runs"
    __table_args__ = (UniqueConstraint("organization_id", "number"),)

    number: Mapped[int]  # BR-14 is the fourteenth of the organization
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default=BenchmarkStatus.DRAFT, index=True)
    status_message: Mapped[str] = mapped_column(Text, default="")
    # Each strategy: {"key", "name", "suites": [...], "adaptive_agent": bool}
    strategies: Mapped[list] = mapped_column(JSONB, default=list)
    attempt_budget: Mapped[int]  # per lab target, strategy and repetition
    repetitions: Mapped[int]
    # UC-11.3 step 4: the LLM judge evaluates every attempt, so the judge itself can be assessed
    judge_every_attempt: Mapped[bool] = mapped_column(default=False)
    # UC-11.3, 1a1: this run repeats an earlier one after remediations were deployed
    baseline_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("benchmark_runs.id", ondelete="SET NULL")
    )
    # What it is expected to cost (UC-11.3 step 5), kept as it was when the run was saved
    estimate: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Fixed when the run starts (FR-4.5): the suites, the tests, the lab targets and the model of
    # each of Sentra's AI tasks. A model that changes afterwards pauses the run (UC-11.4, 4b1).
    versions: Mapped[dict] = mapped_column(JSONB, default=dict)
    order_seed: Mapped[int | None]  # the shuffle, so the order can be explained afterwards
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    repetition_rows: Mapped[list["BenchmarkRepetition"]] = relationship(
        back_populates="benchmark",
        cascade="all, delete-orphan",
        order_by="BenchmarkRepetition.order_no",
    )

    @property
    def code(self) -> str:
        return f"BR-{self.number:03d}"


class BenchmarkRepetition(UUIDPrimaryKey, Base):
    """One campaign run of a benchmark: this lab target, this strategy, this repetition, at this
    place in the random order (UC-11.4 step 1)."""

    __tablename__ = "benchmark_repetitions"
    __table_args__ = (
        UniqueConstraint(
            "benchmark_run_id",
            "target_id",
            "strategy_key",
            "repetition",
            name="uq_benchmark_repetitions_one",
        ),
        Index("ix_benchmark_repetitions_order", "benchmark_run_id", "order_no"),
    )

    benchmark_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("benchmark_runs.id", ondelete="CASCADE")
    )
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("targets.id", ondelete="CASCADE"))
    strategy_key: Mapped[str] = mapped_column(String(20))
    repetition: Mapped[int]  # 1 … benchmark.repetitions
    order_no: Mapped[int]  # its place in the random interleaved order
    status: Mapped[str] = mapped_column(String(20), default=RepetitionStatus.PLANNED)
    reason: Mapped[str | None] = mapped_column(Text)  # why it is incomplete
    campaign_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL"), unique=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # What it cost, copied from its campaign run when it ends (FR-11.4 needs it per repetition)
    attempts_sent: Mapped[int] = mapped_column(default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0))

    benchmark: Mapped[BenchmarkRun] = relationship(back_populates="repetition_rows")
