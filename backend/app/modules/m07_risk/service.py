"""Reading the risk of an organization (FR-7.1, FR-7.2, FR-7.4; UC-7.3 View Risk Dashboard, and
the score of UC-7.2 on the target's pages, UC-2.7). Every member of the organization may read it,
like the findings themselves; another organization gets "not found" (NFR-3.3).

The dashboard of Screen 42 is assembled here: the risk score of each target, the open findings and
their statuses, the trends of the period (trends.py) and the coverage of the OWASP categories
(coverage.py). The matrix of Screen 43 is coverage.py's own entry point, and the attack paths of
Screen 44 are paths.py (FR-7.3).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m02_targets.service import owner_names
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import Severity
from app.modules.m05_campaigns.models import ENDED, CampaignRun
from app.modules.m06_findings.models import CLOSED, OPEN, Finding, FindingStatus
from app.modules.m06_findings.service import SEVERITY_RANK, finding_row
from app.modules.m07_risk import coverage, rating, scoring, trends
from app.modules.m07_risk.models import RiskScore

DEFAULT_PERIOD_DAYS = 90  # the period filter of Screen 42
TOP_FINDINGS = 6  # the "Critical and high findings" table of Screen 42
# The tiles of Screen 42, as the statuses of the finding lifecycle (report, Figure 2.6)
AWAITING_TRIAGE = (FindingStatus.NEW, FindingStatus.REQUIRES_CONFIRMATION)
AWAITING_REMEDIATION = (FindingStatus.CONFIRMED, FindingStatus.REOPENED)
NO_RUN = "no_campaign_run"  # UC-7.2 precondition: the target has no completed campaign run
UNVERIFIED = "ownership_not_verified"  # it cannot be tested at all yet (FR-2.3)


def _empty() -> dict[str, int]:
    return {severity.value: 0 for severity in Severity}


def _zero() -> "Counts":
    """A target that has no finding at all."""
    return Counts(_empty(), {status.value: 0 for status in OPEN + CLOSED})


@dataclass
class Counts:
    """The open and the recently closed findings of one target, by severity and by status."""

    open_by_severity: dict[str, int]
    by_status: dict[str, int]

    @property
    def open_total(self) -> int:
        return sum(self.open_by_severity.values())

    def awaiting_confirmation(self) -> int:
        return self.by_status[FindingStatus.REQUIRES_CONFIRMATION]


def _counts(
    db: Session,
    organization_id: uuid.UUID,
    target_id: uuid.UUID | None,
    cutoff: datetime,
    category: str | None = None,
) -> dict[uuid.UUID, Counts]:
    """The findings of each target: the open ones by severity and by status, and the closed ones
    of the period. Until FR-6.5 records when a status changed, a closed finding belongs to the
    period in which it was last seen. A chosen category narrows every count (UC-7.3 step 4)."""
    query = (
        select(Finding.target_id, Finding.severity, Finding.status, func.count())
        .where(Finding.organization_id == organization_id)
        .group_by(Finding.target_id, Finding.severity, Finding.status)
    )
    if target_id is not None:
        query = query.where(Finding.target_id == target_id)
    if category:
        query = query.where(Finding.category == category)
    result: dict[uuid.UUID, Counts] = {}
    for found_target, severity, status, count in db.execute(query).all():
        counts = result.setdefault(found_target, _zero())
        if status in OPEN:
            counts.open_by_severity[severity] += count
            counts.by_status[status] += count
    closed = (
        select(Finding.target_id, Finding.status, func.count())
        .where(
            Finding.organization_id == organization_id,
            Finding.status.in_(CLOSED),
            Finding.last_seen_at >= cutoff,
        )
        .group_by(Finding.target_id, Finding.status)
    )
    if target_id is not None:
        closed = closed.where(Finding.target_id == target_id)
    if category:
        closed = closed.where(Finding.category == category)
    for found_target, status, count in db.execute(closed).all():
        counts = result.setdefault(found_target, _zero())
        counts.by_status[status] += count
    return result


def _not_scored(target: Target, score: RiskScore | None) -> str:
    """Why a target has no risk score: Screen 16 and Screen 42 say so instead of showing one."""
    if score is not None:
        return ""
    return UNVERIFIED if target.status != TargetStatus.VERIFIED else NO_RUN


def _target_row(target: Target, score: RiskScore | None, counts: Counts, owner: str) -> dict:
    return {
        "id": target.id,
        "name": target.name,
        "type": target.type,
        "environment": target.environment,
        "target_status": target.status,
        "owner": owner,
        "score": score.score if score else None,
        "band": score.band if score else None,
        "calculated_at": score.calculated_at if score else None,
        "last_run_at": score.last_run_at if score else None,
        "open_total": counts.open_total,
        "open_by_severity": counts.open_by_severity,
        "awaiting_confirmation": counts.awaiting_confirmation(),
        "not_scored_reason": _not_scored(target, score),
    }


def last_run_at(
    db: Session, organization_id: uuid.UUID, target_id: uuid.UUID | None
) -> datetime | None:
    """When the organization, or the chosen target, was last tested (UC-7.3 step 2)."""
    query = select(func.max(CampaignRun.ended_at)).where(
        CampaignRun.organization_id == organization_id, CampaignRun.status.in_(ENDED)
    )
    if target_id is not None:
        query = query.where(CampaignRun.target_id == target_id)
    return db.scalar(query)


def dashboard(
    db: Session,
    organization_id: uuid.UUID,
    *,
    target_id: uuid.UUID | None = None,
    days: int = DEFAULT_PERIOD_DAYS,
    category: str | None = None,
) -> dict:
    """UC-7.3 steps 2-5 for the selection of step 4 — target, period and category: the risk score
    of each target with the date of its last campaign run and its open findings by severity, all
    findings by status, the trends of the period and the coverage of the OWASP categories. Without
    a campaign run the page shows its guidance instead (2a1)."""
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    targets = list(
        db.scalars(
            scoped_select(Target, organization_id)
            .where(Target.status != TargetStatus.ARCHIVED)
            .order_by(Target.name)
        )
    )
    if target_id is not None:
        targets = [t for t in targets if t.id == target_id]
        if not targets:
            raise NotFoundError("Target not found.")
    counts = _counts(db, organization_id, target_id, cutoff, category)
    scores = scoring.current(db, organization_id)
    owners = owner_names(db, targets)
    empty = _zero()
    rows = [
        _target_row(
            target,
            scores.get(target.id),
            counts.get(target.id, empty),
            owners.get(target.created_by_id, ""),
        )
        for target in targets
    ]
    rows.sort(key=lambda row: (row["score"] is None, -(row["score"] or 0), row["name"]))
    mine = {t.id for t in targets}
    totals = _empty()
    by_status = _zero().by_status
    for target_counts in (counts.get(t, empty) for t in mine):
        for severity, count in target_counts.open_by_severity.items():
            totals[severity] += count
        for status, count in target_counts.by_status.items():
            by_status[status] += count
    return {
        "period_days": days,
        "category": category,
        # A risk score is a target's whole score and cannot be cut by category (FR-7.2), so the
        # scores and the trend lines stay as they are while every finding count is narrowed.
        "category_filtered": bool(category),
        "last_run_at": last_run_at(db, organization_id, target_id),
        "open_by_severity": totals,
        "open_total": sum(totals.values()),
        "awaiting_triage": sum(by_status[s] for s in AWAITING_TRIAGE),
        "awaiting_remediation": sum(by_status[s] for s in AWAITING_REMEDIATION),
        "fixed_and_verified": by_status[FindingStatus.FIXED_AND_VERIFIED],
        "by_status": by_status,
        "targets": rows,
        "top_findings": _top_findings(db, organization_id, target_id, mine, category),
        "by_category": coverage.by_category(db, organization_id, targets),
        "trends": trends.of(db, organization_id, rows, days=days, until=now, category=category),
    }


def _top_findings(
    db: Session,
    organization_id: uuid.UUID,
    target_id: uuid.UUID | None,
    targets: set[uuid.UUID],
    category: str | None = None,
) -> dict:
    """The critical and high open findings, the most severe first (Screen 42, UC-7.3 step 6 leads
    from here to UC-6.4)."""
    query = scoped_select(Finding, organization_id).where(
        Finding.status.in_(OPEN),
        Finding.severity.in_((Severity.CRITICAL, Severity.HIGH)),
        Finding.target_id.in_(targets),
    )
    if target_id is not None:
        query = query.where(Finding.target_id == target_id)
    if category:
        query = query.where(Finding.category == category)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rank = case(SEVERITY_RANK, value=Finding.severity, else_=len(SEVERITY_RANK))
    found = list(
        db.scalars(
            query.order_by(rank, Finding.last_seen_at.desc(), Finding.number.desc()).limit(
                TOP_FINDINGS
            )
        )
    )
    names = dict(
        db.execute(
            select(Target.id, Target.name).where(Target.id.in_({f.target_id for f in found}))
        ).all()
    )
    return {
        "total": total,
        "items": [
            {
                "code": finding.code,
                "title": finding.title,
                "severity": finding.severity,
                "status": finding.status,
                "target": {"id": finding.target_id, "name": names.get(finding.target_id, "")},
                "reproducibility": _decimal(finding.reproducibility),
                "provisional": finding.severity_provisional,
                "last_seen_at": finding.last_seen_at,
            }
            for finding in found
        ],
    }


def _decimal(value) -> str | None:
    return None if value is None else str(value)


def target_of(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> Target:
    """The organization's target, or "not found" for another organization's (NFR-3.3)."""
    target = db.scalar(scoped_select(Target, organization_id).where(Target.id == target_id))
    if target is None:
        raise NotFoundError("Target not found.")
    return target


def target_risk(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> dict:
    """UC-7.2 for one target (Screen 20's risk card and the history of UC-2.7): the current score
    with the findings it counts, those that await confirmation (1a1) and the date of the last
    campaign run (quality requirement 1b)."""
    target = target_of(db, organization_id, target_id)
    cutoff = datetime.now(UTC) - timedelta(days=DEFAULT_PERIOD_DAYS)
    counts = _counts(db, organization_id, target_id, cutoff).get(target_id, _zero())
    score = scoring.current(db, organization_id).get(target_id)
    return {
        "target": {"id": target.id, "name": target.name, "target_status": target.status},
        "score": score.score if score else None,
        "band": score.band if score else None,
        "calculated_at": score.calculated_at if score else None,
        "trigger": score.trigger if score else None,
        "last_run_at": score.last_run_at if score else last_run_at(db, organization_id, target_id),
        "counted": score.counted if score else 0,
        "counted_by_severity": score.counted_by_severity if score else _empty(),
        "counted_codes": score.counted_codes if score else [],
        "factors": score.factors if score else {},
        "awaiting_confirmation": counts.awaiting_confirmation(),
        "open_total": counts.open_total,
        "open_by_severity": counts.open_by_severity,
        "not_scored_reason": _not_scored(target, score),
        "history": [
            {
                "score": row.score,
                "band": row.band,
                "trigger": row.trigger,
                "calculated_at": row.calculated_at,
                "counted": row.counted,
            }
            for row in scoring.history(db, organization_id, target_id)
        ],
    }


def finding_severity(db: Session, organization_id: uuid.UUID, code: str) -> dict:
    """FR-7.1, NFR-4.2: the severity of one finding with the factors it was calculated from, and
    the severity an analyst set beside the calculated one (UC-7.1, 4a1). Screen 39 shows it."""
    finding = finding_row(db, organization_id, code)
    definition = db.get(TestDefinition, finding.test_definition_id)
    return {
        "code": finding.code,
        "severity": finding.severity,
        "calculated_severity": finding.calculated_severity,
        "adjusted": finding.severity_adjusted,
        "provisional": finding.severity_provisional,
        "rated_at": finding.severity_rated_at,
        "reproducibility": _decimal(finding.reproducibility),
        # Where a finding starts, and where it stays when it can't be rated (FR-4.2)
        "test_severity": definition.severity if definition is not None else None,
        "factors": finding.severity_factors or {},
    }


def how_it_works() -> dict:
    """The rules themselves: the rating matrix of FR-7.1 and the bands of FR-7.2, so that "How is
    the risk score calculated?" (Screen 42) and the report show what the code does."""
    return {"severity": rating.method(), "bands": scoring.bands()}
