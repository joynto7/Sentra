"""Module 11's place in a campaign run (app/workers/orchestrator/hooks.py).

A campaign run of type "benchmark" is one repetition of a benchmark run (FR-11.3), so when it ends
the next repetition can begin. Everything else about the run — its attempts, its detection, its
findings — is the same as for any campaign run.
"""

from sqlalchemy.orm import Session

ORDER = 30  # after the detection, the findings and the risk score


def on_run_end(db: Session, run) -> None:
    """UC-11.4 step 7: the repetition this run belonged to is finished, and its benchmark run
    takes the next one. A run that belongs to no benchmark is none of Module 11's business."""
    from app.modules.m05_campaigns.models import RunType
    from app.modules.m11_lab import benchmark

    if run.run_type != RunType.BENCHMARK:
        return
    benchmark.on_campaign_run_end(db, run)
