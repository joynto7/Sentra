"""Module 7's place in every campaign run (NFR-5.3; app/workers/orchestrator/hooks.py): the
severity of the findings of the run's target (FR-7.1) and the target's risk score (FR-7.2).

Both run when the run has ended, not after every attempt: the factors of a severity come from the
attempts of a test, so a severity rated after the first attempt would move with every further one
and interrupt people with a value that the same run lowers again. The rated severity reaches the
live campaign monitor as its own event, `finding_severity` (rating.py), before the run's "ended"
event; a severity belongs to a finding, not to one attempt.
"""

from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import CampaignRun
from app.modules.m07_risk import rating, scoring
from app.modules.m07_risk.models import ScoreTrigger

ORDER = 20  # after the Detection Engine (ORDER 10), which records the findings this rates


def on_run_end(db: Session, run: CampaignRun) -> None:
    """UC-7.1 for every open finding of the target, because the run's attempts changed how often
    each weakness was reproduced, and UC-7.2 for the target's risk score (its trigger)."""
    for finding in rating.open_findings(db, run.organization_id, run.target_id):
        seen_here = finding.last_run_id == run.id  # the monitor lists only this run's findings
        rating.rate(db, finding, run=run if seen_here else None)
    scoring.calculate(
        db,
        organization_id=run.organization_id,
        target_id=run.target_id,
        trigger=ScoreTrigger.CAMPAIGN_RUN,
        campaign_run_id=run.id,
    )
    db.commit()
