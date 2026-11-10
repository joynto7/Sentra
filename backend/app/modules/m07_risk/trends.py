"""The trends of the risk dashboard (FR-7.4, UC-7.3 step 5): how the risk developed over the
chosen period for the chosen targets — the risk scores as they were calculated, and the findings
that came and went.

Nothing is interpolated or invented. A score line is a step line through the calculations that
really happened (FR-7.2 keeps every one of them), and the bars count findings by the dates the
findings themselves carry. A closed finding belongs to the period in which it was closed, as its
history records it (FR-6.5, M6; `closing()` of Module 6); the dashboard's counts of closed findings
and the list a number opens use the same date.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.m06_findings.models import CLOSED, Finding
from app.modules.m06_findings.service import closing
from app.modules.m07_risk.models import RiskScore

BUCKETS = 6  # Screen 42: six two-week columns over the default 90 days
SERIES = 3  # the three highest-scoring targets get a line, as the screen shows


def buckets(days: int, until: datetime) -> list[tuple[datetime, datetime]]:
    """The period cut into equal parts, the oldest first. 90 days give the six two-week columns of
    Screen 42; a shorter period gives six shorter ones, so the chart keeps its shape."""
    length = timedelta(days=days) / BUCKETS
    start = until - timedelta(days=days)
    return [(start + length * step, start + length * (step + 1)) for step in range(BUCKETS)]


def _closed_dates(
    db: Session,
    organization_id: uuid.UUID,
    target_ids: list[uuid.UUID],
    *,
    since: datetime,
    category: str | None,
) -> list[datetime]:
    """When the findings that are closed now were closed, for those closed in the period."""
    entered, closed_at = closing(organization_id)
    query = (
        select(closed_at)
        .select_from(Finding)
        .outerjoin(entered, entered.c.finding_id == Finding.id)
        .where(
            Finding.organization_id == organization_id,
            Finding.target_id.in_(target_ids),
            Finding.status.in_(CLOSED),
            closed_at >= since,
        )
    )
    if category:
        query = query.where(Finding.category == category)
    return list(db.scalars(query))


def _counted(
    db: Session,
    organization_id: uuid.UUID,
    target_ids: list[uuid.UUID],
    column,
    *,
    since: datetime,
    category: str | None,
) -> list[datetime]:
    """The dates the findings of the period were first seen."""
    query = select(column).where(
        Finding.organization_id == organization_id,
        Finding.target_id.in_(target_ids),
        column >= since,
    )
    if category:
        query = query.where(Finding.category == category)
    return list(db.scalars(query))


def _bars(
    db: Session,
    organization_id: uuid.UUID,
    target_ids: list[uuid.UUID],
    *,
    days: int,
    until: datetime,
    category: str | None,
) -> list[dict]:
    """New and closed findings per part of the period (Screen 42's bar chart). "Closed" is what
    the screen calls fixed, false positive or merged together."""
    parts = buckets(days, until)
    since = parts[0][0]
    new = _counted(
        db,
        organization_id,
        target_ids,
        Finding.first_seen_at,
        since=since,
        category=category,
    )
    gone = _closed_dates(db, organization_id, target_ids, since=since, category=category)
    bars = []
    for start, end in parts:
        bars.append(
            {
                "starts_at": start,
                "ends_at": end,
                "new": sum(1 for at in new if start <= at < end),
                "closed": sum(1 for at in gone if start <= at < end),
            }
        )
    return bars


def _points(
    db: Session,
    organization_id: uuid.UUID,
    target_id: uuid.UUID,
    *,
    since: datetime,
) -> list[dict]:
    """The target's calculations in the period, oldest first, with the last one before it as the
    level the line starts from: a target that was tested before the period still has a line."""
    rows = list(
        db.scalars(
            select(RiskScore)
            .where(
                RiskScore.organization_id == organization_id,
                RiskScore.target_id == target_id,
                RiskScore.calculated_at >= since,
            )
            .order_by(RiskScore.calculated_at)
        )
    )
    before = db.scalar(
        select(RiskScore)
        .where(
            RiskScore.organization_id == organization_id,
            RiskScore.target_id == target_id,
            RiskScore.calculated_at < since,
        )
        .order_by(RiskScore.calculated_at.desc())
        .limit(1)
    )
    found = [
        {
            "at": row.calculated_at,
            "score": row.score,
            "band": row.band,
            "trigger": row.trigger,
            "before_period": False,
        }
        for row in rows
    ]
    if before is not None:
        found.insert(
            0,
            {
                "at": before.calculated_at,
                "score": before.score,
                "band": before.band,
                "trigger": before.trigger,
                "before_period": True,
            },
        )
    return found


def of(
    db: Session,
    organization_id: uuid.UUID,
    targets: list[dict],
    *,
    days: int,
    until: datetime,
    category: str | None = None,
) -> dict:
    """UC-7.3 step 5 for the dashboard's selection. `targets` are its rows, already ordered by
    score, so the lines are the ones the screen shows; a single chosen target gets its own line."""
    ids = [target["id"] for target in targets]
    if not ids:
        return {"buckets": [], "scores": [], "net_change": 0, "category": category}
    since = buckets(days, until)[0][0]
    bars = _bars(db, organization_id, ids, days=days, until=until, category=category)
    scores = [
        {
            "target": {"id": target["id"], "name": target["name"]},
            "score": target["score"],
            "band": target["band"],
            "points": _points(db, organization_id, target["id"], since=since),
        }
        for target in targets[:SERIES]
    ]
    return {
        "buckets": bars,
        "scores": [series for series in scores if series["points"]],
        # What the tile of Screen 42 compares: the findings that came minus the ones that went.
        # Negative means fewer open findings than at the start of the period.
        "net_change": sum(bar["new"] for bar in bars) - sum(bar["closed"] for bar in bars),
        "category": category,
    }
