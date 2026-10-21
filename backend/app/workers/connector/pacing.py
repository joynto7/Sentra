"""Spacing the requests to a target to its rate, across all workers (FR-5.7).

Each target has one row with the time its next request may leave. A worker locks the row, takes
that time for itself, moves it on by one interval (60 / requests per minute seconds), and waits
until its time comes. Because the row is locked, two workers never take the same time, however
many of them run (FR-5.4).
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.modules.m02_targets.models import TargetPacing


class TooLongToWait(Exception):
    """The target's next free time is further away than the caller wants to wait. Nothing was
    reserved; a campaign run gives its worker back and comes again then (FR-5.4)."""

    def __init__(self, seconds: float) -> None:
        super().__init__(f"The target's next free time is in {seconds:.1f} seconds.")
        self.seconds = seconds


def reserve(
    db: Session, target_id: uuid.UUID, per_minute: int, max_wait: float | None = None
) -> float:
    """Takes the next free time of a target; returns how many seconds to wait for it. Commits, so
    that the other workers see the new time at once. With `max_wait`, a time further away is not
    taken: TooLongToWait says how far away it is."""
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
    wait = (slot - now).total_seconds()
    if max_wait is not None and wait > max_wait:
        db.commit()
        raise TooLongToWait(wait)
    row.next_request_at = slot + timedelta(seconds=60 / per_minute)
    db.commit()
    return wait


def hold(db: Session, target_id: uuid.UUID, until: datetime) -> None:
    """No request to the target leaves before `until`, from any worker: a target that answered
    "overloaded" gets a break from every campaign run (FR-5.7). Commits."""
    db.execute(
        insert(TargetPacing)
        .values(target_id=target_id, next_request_at=until)
        .on_conflict_do_update(
            index_elements=["target_id"],
            set_={"next_request_at": func.greatest(TargetPacing.next_request_at, until)},
        )
    )
    db.commit()
