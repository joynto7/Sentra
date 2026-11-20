"""The detection results of the attempts of campaign runs (FR-6.1; report, ER diagram 4: every
attempt is EVALUATED_BY one detection result for each detection method of its test). The Detection
Engine (app/workers/detection) writes them; the findings (FR-6.2) are recorded from the verdicts."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class Outcome(StrEnum):
    """The result of one detection method, and the combined verdict of an attempt (UC-6.1)."""

    MET = "met"  # the success condition of the test is met: the attempt revealed a weakness
    NOT_MET = "not_met"
    PENDING = "pending"  # the LLM judge hasn't answered yet
    NOT_EVALUATED = "not_evaluated"  # it couldn't be evaluated; the summary says why


class DecidedBy(StrEnum):
    DETERMINISTIC = "deterministic"  # a decisive canary-token, rule or tool-call method
    LLM_JUDGE = "llm_judge"


class DetectionResult(UUIDPrimaryKey, OrganizationScoped, Base):
    """What one detection method of the test found for one attempt, stored apart from the other
    methods (FR-6.1; UC-6.1 step 4)."""

    __tablename__ = "detection_results"
    __table_args__ = (UniqueConstraint("attempt_id", "method"),)

    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"))
    method: Mapped[str] = mapped_column(String(30))  # m04_tests.schema.DetectionMethod
    role: Mapped[str] = mapped_column(String(15))  # as the test defines it: decisive, supporting …
    outcome: Mapped[str] = mapped_column(String(15))
    summary: Mapped[str] = mapped_column(Text)  # what it found, in words (Screen 40)
    # Each check the method evaluated: check, value, sentence, result (met, not_met or unknown)
    # and detail
    checks: Mapped[list] = mapped_column(JSONB, default=list)
    duration_ms: Mapped[int | None]  # of a deterministic method: at most 100 ms (NFR-1.4)
    # The LLM judge (NFR-9.4, NFR-9.5): its confidence and its reasoning (masked), and the model and
    # the version and SHA-256 of the instructions that gave the verdict
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    reasoning: Mapped[str | None] = mapped_column(Text)
    judge_model: Mapped[str | None] = mapped_column(String(200))
    judge_deployment: Mapped[str | None] = mapped_column(String(10))  # local or external
    instructions_version: Mapped[str | None] = mapped_column(String(20))
    instructions_sha256: Mapped[str | None] = mapped_column(String(64))
    tries: Mapped[int] = mapped_column(SmallInteger, default=0)  # of the judge (UC-6.1, 3a)
    error: Mapped[str | None] = mapped_column(Text)  # the judge's last problem
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DetectionVerdict(Timestamps, OrganizationScoped, Base):
    """The combined verdict of one attempt (UC-6.1 step 5): whether it meets the success condition
    of its test, which kind of method decided, whether an analyst must confirm it because only the
    LLM judge supports it (NFR-9.3), and whether the judge disagreed with the deterministic methods
    that decided (NFR-9.5)."""

    __tablename__ = "detection_verdicts"
    __table_args__ = (Index("ix_detection_verdicts_run_outcome", "campaign_run_id", "outcome"),)

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attempts.id", ondelete="CASCADE"), primary_key=True
    )
    campaign_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="CASCADE")
    )
    outcome: Mapped[str] = mapped_column(String(15))
    decided_by: Mapped[str | None] = mapped_column(String(15))
    requires_confirmation: Mapped[bool] = mapped_column(default=False)
    disagreement: Mapped[bool] = mapped_column(default=False)
    summary: Mapped[str] = mapped_column(Text)
