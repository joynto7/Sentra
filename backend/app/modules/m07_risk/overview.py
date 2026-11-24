"""What the Risk Dashboard's overview draws over time (FR-7.4, UC-7.3 step 5): how many findings
were open, awaiting triage and awaiting remediation at each step of the period, how many were fixed
and verified so far, how long confirming and fixing took, and, per target, the findings that came
and went in each part of the period.

Nothing is predicted or invented. A finding's status at a moment is the last status its history
(`FindingEvent.became`) records at or before it; the history of a finding that a retest fixed has
no closing entry, so the date `trends.closing` gives stands in, and the newest step always ends at
the finding's status today. The newest step is therefore exactly what the dashboard counts now.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.m06_findings.models import CLOSED, OPEN, Finding, FindingEvent, FindingStatus
from app.modules.m06_findings.service import closing

STEPS = 12  # equal parts of the period: the heatmap's columns and the sparklines' steps
DAY = timedelta(days=1)


def boundaries(days: int, until: datetime) -> list[datetime]:
    """The moments between the parts of the period, oldest first: STEPS + 1 of them, the first
    the start of the period and the last now."""
    length = timedelta(days=days) / STEPS
    start = until - timedelta(days=days)
    return [start + length * step for step in range(STEPS)] + [until]


def _timeline(
    finding: Finding,
    events: list[tuple[datetime, str]],
    closed_at: datetime | None,
) -> list[tuple[datetime, str]]:
    """The finding's statuses with the moment each began, oldest first, ending at today's."""
    line: list[tuple[datetime, str]] = []
    for at, status in events:
        if line and status == line[-1][1]:
            continue
        line.append((max(at, line[-1][0]) if line else min(at, finding.first_seen_at), status))
    if not line:
        line.append((finding.first_seen_at, finding.status))
    if line[-1][1] != finding.status:
        last = line[-1][0]
        reached = closed_at if finding.status in CLOSED and closed_at else finding.last_seen_at
        line.append((max(reached, last), finding.status))
    return line


def _status_at(line: list[tuple[datetime, str]], moment: datetime) -> str | None:
    found = None
    for at, status in line:
        if at > moment:
            break
        found = status
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
    ids = [target["id"] for target in targets]
    marks = boundaries(days, until)
    since = marks[0]
    empty_step = {status.value: 0 for status in OPEN}
    steps = [{"at": at, **empty_step, "open": 0, "fixed": 0} for at in marks]
    heat = {target["id"]: [{"new": 0, "closed": 0} for _ in range(STEPS)] for target in targets}
    confirm_days: list[float] = []
    fix_days: list[float] = []
    if ids:
        entered, closed_date = closing(organization_id)
        query = (
            select(Finding, closed_date)
            .select_from(Finding)
            .outerjoin(entered, entered.c.finding_id == Finding.id)
            .where(Finding.organization_id == organization_id, Finding.target_id.in_(ids))
        )
        if category:
            query = query.where(Finding.category == category)
        found = list(db.execute(query))
        history: dict[uuid.UUID, list[tuple[datetime, str]]] = {}
        wanted = [row[0].id for row in found]
        for finding_id, at, became in db.execute(
            select(FindingEvent.finding_id, FindingEvent.created_at, FindingEvent.became)
            .where(
                FindingEvent.organization_id == organization_id,
                FindingEvent.finding_id.in_(wanted),
                FindingEvent.became.is_not(None),
            )
            .order_by(FindingEvent.created_at, FindingEvent.event_no)
        ):
            history.setdefault(finding_id, []).append((at, became))

        def part_of(moment: datetime) -> int | None:
            if moment < since or moment > until:
                return None
            return min(int((moment - since) / ((until - since) / STEPS)), STEPS - 1)

        for finding, closed_at in found:
            line = _timeline(finding, history.get(finding.id, []), closed_at)
            for step, moment in zip(steps, marks, strict=True):
                status = _status_at(line, moment)
                if status in step:
                    step[status] += 1
            column = part_of(finding.first_seen_at)
            if column is not None:
                heat[finding.target_id][column]["new"] += 1
            if finding.status in CLOSED and closed_at is not None:
                column = part_of(closed_at)
                if column is not None:
                    heat[finding.target_id][column]["closed"] += 1
                if finding.status == FindingStatus.FIXED_AND_VERIFIED and closed_at >= since:
                    for step, moment in zip(steps, marks, strict=True):
                        if closed_at <= moment:
                            step["fixed"] += 1
                    fix_days.append((closed_at - finding.first_seen_at) / DAY)
            if finding.confirmed_at is not None and finding.confirmed_at >= since:
                confirm_days.append((finding.confirmed_at - finding.first_seen_at) / DAY)
    for step in steps:
        step["open"] = sum(step[status.value] for status in OPEN)
    average = lambda values: round(sum(values) / len(values), 1) if values else None  # noqa: E731
    return {
        "steps": steps,
        "columns": [{"starts_at": a, "ends_at": b} for a, b in zip(marks, marks[1:], strict=False)],
        "rows": [
            {"target": {"id": target["id"], "name": target["name"]}, "cells": heat[target["id"]]}
            for target in targets
        ],
        "days_to_confirm": average(confirm_days),
        "confirmed": len(confirm_days),
        "days_to_fix": average(fix_days),
        "fixed": len(fix_days),
    }
