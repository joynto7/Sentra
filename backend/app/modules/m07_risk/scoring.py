"""The risk score of a target (FR-7.2; UC-7.2 Calculate Target Risk Score).

One score from 0 to 100 summarizes the current risk of a target, and every calculation is kept
with its time and its trigger, so that the score can be explained and its trend shown (UC-2.7,
UC-7.3):

1. the open findings that count are those with deterministic evidence and those an analyst has
   confirmed (step 1); a finding that still requires confirmation is shown beside the score but
   not counted (1a1, NFR-9.3);
2. the highest severity among them sets the band: Critical 75-100, High 50-74, Medium 25-49 or
   Low 1-24 (step 2). Because the band comes from the highest severity, many low findings can
   never outweigh one critical finding (quality requirement 2);
3. the position in the band comes from the counted findings at that severity and their
   reproducibility: 1 - 0.5 ^ (sum of their reproducibility), so the first finding reaches the
   middle of the band and each further one moves it half of the way that is left, without ever
   leaving the band (step 3);
4. the score is stored with the time, the trigger and the findings it is based on (step 4), and
   the dashboards and the target's history show it (step 5).

Without a counted finding, or with only Informational ones, the score is 0 (1b1). The score of a
finding whose reproducibility isn't measured yet counts in full, so that a score is never lower
than the findings justify.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.tenancy import scoped_select
from app.modules.m04_tests.schema import Severity
from app.modules.m05_campaigns.models import ENDED, CampaignRun
from app.modules.m06_findings.models import OPEN, Finding, FindingStatus
from app.modules.m07_risk.models import Band, RiskScore, ScoreTrigger

BANDS = {  # UC-7.2 step 2: the severity that sets the band, and the band's bounds
    Severity.CRITICAL: (Band.CRITICAL, 75, 100),
    Severity.HIGH: (Band.HIGH, 50, 74),
    Severity.MEDIUM: (Band.MEDIUM, 25, 49),
    Severity.LOW: (Band.LOW, 1, 24),
}
# Informational findings don't set a band (1b): the score stays 0
RANKED = (Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW)
FULL = Decimal(1)  # the reproducibility of a finding that hasn't been measured yet


def bands() -> list[dict]:
    """The bands themselves, for "How is the risk score calculated?" (Screen 42, NFR-4.2)."""
    return [
        {"band": band.value, "severity": severity.value, "from": low, "to": high}
        for severity, (band, low, high) in BANDS.items()
    ]


def calculate(
    db: Session,
    *,
    organization_id: uuid.UUID,
    target_id: uuid.UUID,
    trigger: ScoreTrigger,
    campaign_run_id: uuid.UUID | None = None,
) -> RiskScore:
    """UC-7.2 for one target. The caller commits."""
    findings = list(
        db.scalars(
            scoped_select(Finding, organization_id)
            .where(Finding.target_id == target_id, Finding.status.in_(OPEN))
            .order_by(Finding.number)
        )
    )
    awaiting = [f for f in findings if f.status == FindingStatus.REQUIRES_CONFIRMATION]
    counted = [f for f in findings if f.status != FindingStatus.REQUIRES_CONFIRMATION]
    by_severity = {s.value: sum(1 for f in counted if f.severity == s) for s in Severity}
    score, band, factors = _score(counted, by_severity)
    row = RiskScore(
        organization_id=organization_id,
        target_id=target_id,
        score=score,
        band=band.value,
        counted=len(counted),
        counted_by_severity=by_severity,
        awaiting_confirmation=len(awaiting),
        counted_codes=[f.code for f in counted],
        factors=factors,
        trigger=trigger.value,
        campaign_run_id=campaign_run_id,
        last_run_at=last_run_at(db, organization_id, target_id),
        calculated_at=datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row


def _score(counted: list[Finding], by_severity: dict[str, int]) -> tuple[int, Band, dict]:
    """Steps 2-3: the band from the highest severity, the position in it from the findings at that
    severity and their reproducibility."""
    top = next((s for s in RANKED if by_severity[s.value]), None)
    if top is None:  # 1b1: nothing counts, or only Informational findings
        return (
            0,
            Band.NONE,
            {
                "top_severity": None,
                "counted_at_top": 0,
                "reproducibility_sum": "0",
                "position": "0",
                "band_from": 0,
                "band_to": 0,
            },
        )
    band, low, high = BANDS[top]
    at_top = [f for f in counted if f.severity == top]
    total = sum((f.reproducibility or FULL) for f in at_top)
    position = 1 - Decimal("0.5") ** total
    return (
        low + int(position * (high - low) + Decimal("0.5")),
        band,
        {
            "top_severity": top.value,
            "counted_at_top": len(at_top),
            "reproducibility_sum": str(total.quantize(Decimal("0.001"))),
            "position": str(position.quantize(Decimal("0.001"))),
            "band_from": low,
            "band_to": high,
        },
    )


def last_run_at(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID):
    """QR 1b: when the target was last tested, so that a score of 0 is not mistaken for proof that
    the target is secure. A run that was stopped early tested it too, so every ended run counts."""
    return db.scalar(
        select(func.max(CampaignRun.ended_at)).where(
            CampaignRun.organization_id == organization_id,
            CampaignRun.target_id == target_id,
            CampaignRun.status.in_(ENDED),
        )
    )


def current(db: Session, organization_id: uuid.UUID) -> dict[uuid.UUID, RiskScore]:
    """The newest score of each of the organization's targets (Screens 16, 20, 42). A target
    without one has not been tested yet and is shown as not scored (UC-7.2 precondition)."""
    return _newest(db, organization_id)


def before(db: Session, organization_id: uuid.UUID, moment: datetime) -> dict[uuid.UUID, RiskScore]:
    """The score each target had at `moment`: its newest calculation before it. Screen 42 compares
    the current score with it, and the findings it counted are the ones open at that moment,
    because every change to a finding calculates the score again (UC-7.2's triggers). A target
    without one had not been tested yet."""
    return _newest(db, organization_id, moment)


def _newest(
    db: Session, organization_id: uuid.UUID, moment: datetime | None = None
) -> dict[uuid.UUID, RiskScore]:
    last = (
        select(RiskScore.target_id, func.max(RiskScore.calculated_at).label("at"))
        .where(RiskScore.organization_id == organization_id)
        .group_by(RiskScore.target_id)
    )
    if moment is not None:
        last = last.where(RiskScore.calculated_at < moment)
    last = last.subquery()
    newest = (
        scoped_select(RiskScore, organization_id)
        .join(
            last,
            (RiskScore.target_id == last.c.target_id) & (RiskScore.calculated_at == last.c.at),
        )
        .order_by(RiskScore.id)  # two calculations in one transaction share their time
    )
    return {row.target_id: row for row in db.scalars(newest)}


def history(
    db: Session, organization_id: uuid.UUID, target_id: uuid.UUID, limit: int = 30
) -> list[RiskScore]:
    """The target's scores, the newest first (UC-2.7, and the trend of UC-7.3)."""
    rows = db.scalars(
        scoped_select(RiskScore, organization_id)
        .where(RiskScore.target_id == target_id)
        .order_by(RiskScore.calculated_at.desc(), RiskScore.id.desc())
        .limit(limit)
    )
    return list(rows)
