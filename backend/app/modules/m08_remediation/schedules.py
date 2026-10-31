"""Module 8's turn on Sentra's own clock (app/workers/scheduler.py): the Shield Policy versions
whose maintenance window has come (UC-8.4, 1a), and the people of a target whose gateway went
silent (UC-10.9, 4a1).

The clock finds this file by itself (app/workers/extensions.py), the way it finds Module 10's.
"""

from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.m08_remediation import health, policies


def due(db: Session, at: datetime | None = None) -> bool:
    """Every minute: a version whose window has come is offered to its gateway, and the
    developers and administrators of a target whose gateway went silent hear about it, once for
    each silence. Returns whether there was anything to do."""
    started = policies.due(db, at)
    reported = health.tell_about_silence(db, at)
    return bool(started) or reported > 0
