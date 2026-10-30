"""The risk scores of the targets (FR-7.2). Report, ER diagram 4: every risk score of a target is
kept, so that its trend can be shown. The severity of a finding (FR-7.1) belongs to the finding
and is stored with it (m06_findings/models.py)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, UUIDPrimaryKey


class ScoreTrigger(StrEnum):
    """What caused the calculation (UC-7.2 step 4 and its trigger)."""

    CAMPAIGN_RUN = "campaign_run"  # a campaign run or retest of the target ended (UC-5.4)
    TRIAGE = "triage"  # a finding was triaged (UC-6.6, FR-6.5)
    REMEDIATION = "remediation"  # a remediation changed a finding (Module 8)


class Band(StrEnum):
    """The band of a score: the highest severity among the findings it counts (UC-7.2 step 2)."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    NONE = "none"  # no counted finding, or only Informational ones (1b1): the score is 0


class RiskScore(UUIDPrimaryKey, OrganizationScoped, Base):
    """One calculation of a target's risk score (FR-7.2, UC-7.2). Every calculation is kept with
    its time and its trigger, so that the target's history and the dashboard's trend show how the
    risk developed (UC-2.7, UC-7.3)."""

    __tablename__ = "risk_scores"
    __table_args__ = (Index("ix_risk_scores_target_calculated", "target_id", "calculated_at"),)

    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("targets.id", ondelete="CASCADE"))
    score: Mapped[int] = mapped_column(SmallInteger)  # 0 to 100
    band: Mapped[str] = mapped_column(String(15))
    counted: Mapped[int]  # the open findings the score is based on (step 1)
    counted_by_severity: Mapped[dict] = mapped_column(JSONB, default=dict)
    # 1a1: findings that still require confirmation are shown beside the score, not counted
    awaiting_confirmation: Mapped[int] = mapped_column(default=0)
    # Which findings it is based on, as their codes (UC-7.2, quality requirement "users can see
    # which findings it is based on")
    counted_codes: Mapped[list] = mapped_column(JSONB, default=list)
    # How the score was reached: the band's bounds, the findings at the top severity, the sum of
    # their reproducibility and the position in the band (NFR-4.2)
    factors: Mapped[dict] = mapped_column(JSONB, default=dict)
    trigger: Mapped[str] = mapped_column(String(20))
    campaign_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL")
    )
    # QR 1b: every score is shown with the date of the last campaign run, so that a score of 0 is
    # not mistaken for proof that the target is secure
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the score is calculated, not by the database: two calculations in one transaction
    # would otherwise share the transaction's time, and the trend needs their order
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
