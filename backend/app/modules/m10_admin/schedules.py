"""Module 10's turn on Sentra's own clock (app/workers/scheduler.py).

This file is the module's one place for timed work, so both halves of Module 10 use it: the
Monitoring component looks at every component on each tick (FR-10.6, UC-10.9 step 4), and the
retention clean-up of FR-10.5 joins it with a `daily()` when it is built.
"""

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.m10_admin import health

log = logging.getLogger("uvicorn.error")


def due(db: Session, at: datetime | None = None) -> bool:
    """Every tick: the alerts of UC-10.9 steps 4 and 6. Returns whether anything changed, which
    is what the scheduler counts."""
    opened, closed = health.check(db)
    if opened or closed:
        log.info("System health: %s alerts opened, %s closed", len(opened), closed)
    return bool(opened or closed)
