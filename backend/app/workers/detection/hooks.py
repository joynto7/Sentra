"""The Detection Engine's place in every campaign run (NFR-5.3; orchestrator/hooks.py)."""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import Attempt
from app.workers.connector.connector import Reply
from app.workers.detection import engine, verdict

ORDER = 10  # first: the findings (FR-6.2) and the risk score (FR-7.2) build on its verdicts


def on_attempt(db: Session, attempt: Attempt, reply: Reply) -> dict:
    """UC-6.1 for an attempt that got a reply. What it returns is shown with the attempt on the
    live campaign monitor, under "detection" (UC-5.6 step 3)."""
    decided, results = engine.evaluate(db, attempt, reply)
    return verdict.live_data(decided, results)
