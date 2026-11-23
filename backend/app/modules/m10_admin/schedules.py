"""Module 10's turn on Sentra's own clock (app/workers/scheduler.py).

This file is the module's one place for timed work, so both halves of Module 10 use it. The
Monitoring component looks at every component on each tick (FR-10.6, UC-10.9 step 4), and the
retention clean-up of FR-10.5 runs once a day (UC-10.8 step 1).

For the clean-up the clock only places the job in the Task Queue; a Background Worker does the
deleting, so a clean-up that removes a year of attempts never delays a campaign run (UC-10.8,
quality requirement 1).
"""

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.m10_admin import health
from app.workers import jobs
from app.workers.retention import JOB

log = logging.getLogger("uvicorn.error")


def due(db: Session, at: datetime | None = None) -> bool:
    """Every tick: the alerts of UC-10.9 steps 4 and 6. Returns whether anything changed, which
    is what the scheduler counts."""
    opened, closed = health.check(db)
    if opened or closed:
        log.info("System health: %s alerts opened, %s closed", len(opened), closed)
    return bool(opened or closed)


def daily(db: Session, at: datetime | None = None) -> bool:
    """Once a day: every organization's expired data. Returns whether the job was placed, which
    is what the scheduler counts; a queue that can't be reached is said once and tried again on
    the next round, because nothing is lost by deleting a day later."""
    placed = jobs.start(db, JOB)
    if not placed:
        log.error("The daily retention clean-up couldn't be queued; the next round tries again")
    return placed
