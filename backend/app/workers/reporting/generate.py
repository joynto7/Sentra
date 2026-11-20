"""The worker job that writes a report (FR-9.1, UC-9.1 step 4): collecting the data and rendering
the file belong on a worker, not in the request that asked for it."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m09_reporting import reports
from app.workers.jobs import job


@job("report.generate")
def generate_report(db: Session, report_id: str) -> None:
    reports.generate(db, uuid.UUID(report_id))
