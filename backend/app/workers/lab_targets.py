"""The jobs of Module 11 (FR-11.2): resetting a lab target runs on a worker, because it talks to
the lab target and takes a while, and the Security Lab page shows "Resetting" meanwhile."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m11_lab import benchmark, deployment
from app.workers.jobs import job


@job(deployment.RESET_JOB)
def reset_lab_target(db: Session, deployment_id: str) -> None:
    """UC-11.2 steps 2-6 with 5a: the lab target restores itself and plants new canary tokens,
    Sentra reads them and tests the connection, or leaves the target not ready."""
    deployment.run_reset(db, uuid.UUID(deployment_id))


@job(deployment.DEPLOY_JOB)
def deploy_lab_target(db: Session, deployment_id: str) -> None:
    """UC-11.1 step 2: the worker reads what the lab target reports about itself — its planted
    canary tokens and its known vulnerabilities — and marks it ready (FR-11.1, FR-11.2)."""
    deployment.finish_deploy(db, uuid.UUID(deployment_id))


@job(benchmark.ADVANCE_JOB)
def advance_benchmark(db: Session, benchmark_run_id: str) -> None:
    """UC-11.4 steps 3-7: the next repetition of a benchmark run — its lab target is reset and its
    campaign run is launched. Only a worker reaches a target, so this is where it happens."""
    benchmark.advance(db, uuid.UUID(benchmark_run_id))
