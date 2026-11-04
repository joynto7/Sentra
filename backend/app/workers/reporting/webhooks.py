"""Webhook deliveries (FR-9.6, UC-9.7 step 6), on a worker.

A delivery is a request to somebody else's system, which may be slow or down, so it never happens
in the request that caused the event: `webhooks.send()` writes the rows and the worker sends them.
Each attempt is its own job, so a retry waits in the queue instead of holding a worker (6a).
"""

import uuid

from sqlalchemy.orm import Session

from app.modules.m09_reporting import webhooks
from app.workers.jobs import job


@job(webhooks.JOB)
def deliver(db: Session, delivery_id: str, attempt: str = "0") -> None:
    webhooks.deliver(db, uuid.UUID(delivery_id), int(attempt))
