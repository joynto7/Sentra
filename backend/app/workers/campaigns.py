"""The jobs of campaign runs (FR-5.4): a Background Worker works on a run in slices, and a worker
that starts picks up the runs that a lost worker left (NFR-2.2)."""

import logging
import uuid

from celery.signals import worker_ready
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.m05_campaigns import lifecycle
from app.workers.jobs import job
from app.workers.orchestrator import engine

log = logging.getLogger("uvicorn.error")


@job(lifecycle.JOB)
def advance_run(db: Session, run_id: str, token: str) -> None:
    engine.advance(db, uuid.UUID(run_id), uuid.UUID(token) if token else None)


@worker_ready.connect
def recover_runs(**_) -> None:
    from app.modules import load_models

    load_models()
    with SessionLocal() as db:
        picked = lifecycle.recover(db)
    if picked:
        log.info("Picked up %s campaign runs after a restart", picked)
