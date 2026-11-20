"""Spacing the requests to a target to its rate, across all workers (FR-5.7).

Each target has one row with the time its next request may leave. A worker locks the row, takes
that time for itself, moves it on by one interval (60 / requests per minute seconds), and waits
until its time comes. Because the row is locked, two workers never take the same time, however
many of them run (FR-5.4).
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.modules.m02_targets.models import TargetPacing


def reserve(db: Session, target_id: uuid.UUID, per_minute: int) -> float:
    """Takes the next free time of a target; returns how many seconds to wait for it. Commits, so
    that the other workers see the new time at once."""
    now = datetime.now(UTC)
    db.execute(
        insert(TargetPacing)
        .values(target_id=target_id, next_request_at=now)
        .on_conflict_do_nothing(index_elements=["target_id"])
    )
    row = db.scalar(
        select(TargetPacing).where(TargetPacing.target_id == target_id).with_for_update()
    )
    slot = max(now, row.next_request_at)
    row.next_request_at = slot + timedelta(seconds=60 / per_minute)
    db.commit()
    return (slot - now).total_seconds()
