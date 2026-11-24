"""The assistant's turn on Sentra's clock (app/workers/scheduler.py): once a day, the conversations
that nobody has used for `RETENTION_DAYS` days are deleted."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.assistant import store


def daily(db: Session, at: datetime | None = None) -> bool:
    return store.purge(db, at) > 0
