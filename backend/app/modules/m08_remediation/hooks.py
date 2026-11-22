"""Module 8's place in every run (NFR-5.3; app/workers/orchestrator/hooks.py).

Only one thing of Module 8 happens inside a run, and only in a run of its own kind: when a retest
run ends, its benign requests are sent and the comparison of UC-8.6 steps 4-6 is worked out. A
campaign run reaches this module in no other way, so nothing of the engine knows about
remediations.
"""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import CampaignRun, RunType
from app.modules.m08_remediation import retest

ORDER = 30  # after the Detection Engine (10) and the severity and risk score of Module 7 (20)


def on_run_end(db: Session, run: CampaignRun) -> None:
    """UC-8.6 step 4: the repeated attempts have been sent, so the retest can be finished."""
    if run.run_type != RunType.RETEST:
        return
    retest.on_run_end(db, run)
