"""The autopilot's turn on Sentra's clock (app/workers/scheduler.py): every minute, each assessment
that is not finished does its next step, so it goes on while nobody has its page open."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.autopilot import service


def due(db: Session, at: datetime | None = None) -> bool:
    return service.due(db) > 0
