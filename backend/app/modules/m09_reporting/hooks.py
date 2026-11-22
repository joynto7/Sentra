"""Module 9's place in every campaign run (NFR-5.3; app/workers/orchestrator/hooks.py): the
verdict of a security gate whose run has just ended (FR-9.4, UC-9.5 steps 4-6) and the schedules
that produce a report after every run of a target (FR-9.2, UC-9.2 step 2).

It runs last, after the findings of M6 and the severities and scores of M7, so the gate judges the
findings of the run as they finally stand and the report describes the run that has just ended."""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import CampaignRun
from app.modules.m09_reporting import gates, schedules

ORDER = 30  # after the Detection Engine (10) and the risk of Module 7 (20)


def on_run_end(db: Session, run: CampaignRun) -> None:
    waiting = gates.for_run(db, run.id)
    if waiting is not None:
        decided = gates.decide(db, waiting, run)
        # notify() commits, which the extension points allow, so the verdict is written before
        # anybody is told a release was blocked (UC-9.5, 5a1).
        gates.tell_them(db, decided)
    schedules.after_run(db, run)
