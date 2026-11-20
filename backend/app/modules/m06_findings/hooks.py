"""Module 6's place in every campaign run (NFR-5.3; app/workers/orchestrator/hooks.py): how
reliably each finding of the run can be reproduced (FR-6.4; UC-6.3).

The findings themselves are recorded by the Detection Engine, which runs before this
(app/workers/detection/hooks.py). Here every evaluated attempt counts towards the measurement of
the finding it supports, and the end of the run closes whatever is still being measured.
"""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.modules.m06_findings import reproducibility
from app.workers.connector.connector import Reply

ORDER = 15  # after the Detection Engine's verdicts (10), before the risk score (20)


def on_attempt(db: Session, attempt: Attempt, reply: Reply) -> dict | None:
    """UC-6.3 steps 1-5 for one evaluated attempt. What it returns is shown with the attempt on
    the live campaign monitor (UC-5.6 step 3)."""
    return reproducibility.after_attempt(db, attempt)


def on_run_end(db: Session, run: CampaignRun) -> None:
    """UC-6.3, 2b1: a measurement the run didn't finish keeps the score of what it measured."""
    reproducibility.close_open(db, run)
