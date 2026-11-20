"""Module 9's place in every campaign run (NFR-5.3; app/workers/orchestrator/hooks.py): the
schedules that produce a report after every run of a target (FR-9.2, UC-9.2 step 2).

It runs last, after the findings of M6 and the severities and scores of M7, so the report the
schedule produces describes the run that has just ended."""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import CampaignRun
from app.modules.m09_reporting import schedules

ORDER = 30  # after the Detection Engine (10) and the risk of Module 7 (20)


def on_run_end(db: Session, run: CampaignRun) -> None:
    schedules.after_run(db, run)
