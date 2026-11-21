"""The adaptive testing agent's place in every campaign run (NFR-5.3; orchestrator/hooks.py)."""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import Attempt
from app.workers.agent import agent
from app.workers.connector.connector import Reply

ORDER = 40  # last: it reads the verdict of the detection (10) and adds work for the engine


def on_attempt(db: Session, attempt: Attempt, reply: Reply) -> dict | None:
    """UC-5.5 for an attempt that got a reply. What it returns is shown with the attempt on the
    live monitor under "agent" (UC-5.6 step 3)."""
    return agent.refine(db, attempt, reply)
