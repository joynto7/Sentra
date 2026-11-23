"""The daily retention clean-up (FR-10.5, UC-10.8 step 1). The Scheduler places it on the Task
Queue and a Background Worker takes it, so deleting a year of attempts never delays a campaign
run (quality requirement 1).

What puts it there every day is `m10_admin/schedules.py`: the clock finds a module's `schedules.py`
by itself (`app/workers/extensions.py`), so nothing has to be listed anywhere and no file of
another module changes. It can also be started by hand with one organization's id.
"""

import uuid

from sqlalchemy.orm import Session

from app.modules.m10_admin import retention
from app.workers.jobs import job

JOB = "retention.clean_up"


@job(JOB)
def clean_up(db: Session, organization_id: str = "") -> None:
    """Every organization's expired data, or one organization's when the id is given."""
    if organization_id:
        retention.clean_up(db, uuid.UUID(organization_id))
    else:
        retention.run_all(db)
