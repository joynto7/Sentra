"""Sentra's own clock (FR-5.3): the work that happens at a time, instead of in answer to a
request.

Celery beat (the scheduler service of compose.yaml) places two jobs in the Task Queue:

    scheduler.tick    every minute: the campaigns whose schedule has come (UC-5.3, 1a), and then
                      every other module's work that is due now
    scheduler.daily   once a day: the work a module wants once a day

A Background Worker runs them like any other job, so the clock keeps no state of its own: what is
due is always a question to the database, and a tick that is lost with its worker (NFR-2.2)
changes nothing but the moment at which the next one acts.

A module takes part by adding a module schedules.py to its package (app/workers/extensions.py):

    def due(db, at=None):    # every tick, e.g. a scheduled report (FR-9.2; UC-9.2 step 2)
    def daily(db, at=None):  # once a day, e.g. the warning about an API key that is expiring

The schedules of campaigns are not one of those. They belong to M5 (m05_campaigns/scheduling.py),
and the tick launches them itself.
"""

import logging
from datetime import UTC, datetime
from types import ModuleType

from sqlalchemy.orm import Session

from app.modules.m05_campaigns import scheduling
from app.modules.m05_campaigns.models import ScheduleResult
from app.workers import extensions
from app.workers.jobs import job

log = logging.getLogger("uvicorn.error")
TICK = "scheduler.tick"
DAILY = "scheduler.daily"

_modules: list[ModuleType] | None = None


def modules() -> list[ModuleType]:
    global _modules
    if _modules is None:
        _modules = extensions.discover("schedules")
    return _modules


@job(TICK)
def tick(db: Session, at: str = "") -> None:
    """Every minute. `at` is given only by a test, or by hand, to act as if it were that moment."""
    moment = _moment(at)
    launched = campaigns(db, moment)
    did = turn(db, "due", moment)
    if launched or did:
        log.info("The scheduler launched %s campaign runs; %s modules had work", launched, did)


@job(DAILY)
def daily(db: Session, at: str = "") -> None:
    """Once a day, at 01:00 UTC (celery_app.py)."""
    if did := turn(db, "daily", _moment(at)):
        log.info("The scheduler's daily round: %s modules had work", did)


def campaigns(db: Session, moment: datetime) -> int:
    """The campaigns whose schedule has come. Each one is acted on by itself, so a campaign that
    can't run now doesn't keep the others from running, and the run is launched with the
    permissions of whoever saved the schedule (UC-5.3, 1a1)."""
    launched = 0
    for schedule_id in scheduling.due(db, moment):
        try:
            result = scheduling.fire(db, schedule_id, moment)
        except Exception:  # anything unforeseen: the next tick looks at this schedule again
            db.rollback()
            log.exception("Sentra couldn't act on the campaign schedule %s", schedule_id)
            continue
        launched += result == ScheduleResult.LAUNCHED
    return launched


def turn(db: Session, name: str, moment: datetime) -> int:
    """Every other module's turn, and how many of them had something to do. A module that fails
    is logged and rolled back on its own (extensions.call), and the others still get their turn."""
    did = 0
    for module in modules():
        result, error = extensions.call(db, module, name, moment)
        if error:
            log.error("The %s work of %s failed: %s", name, extensions.label(module), error)
        elif result:
            did += 1
    db.commit()
    return did


def _moment(at: str) -> datetime:
    """Job arguments travel through the queue as text, so the moment arrives as an ISO string."""
    if not at:
        return datetime.now(UTC)
    moment = datetime.fromisoformat(at)
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)
