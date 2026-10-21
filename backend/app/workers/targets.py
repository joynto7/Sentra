"""The jobs of Module 2 that talk to a target, so they run on the workers, the only components
that reach targets (deployment, 2.5.5): connection tests (FR-2.4), ownership checks (FR-2.3) and
the mapping of a target profile (FR-2.5)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m02_targets import connection, profile, verification
from app.workers.jobs import job


@job("targets.connection_test")
def connection_test(db: Session, test_id: str) -> None:
    connection.run(db, uuid.UUID(test_id))


@job("targets.check_ownership")
def check_ownership(db: Session, check_id: str) -> None:
    verification.run(db, uuid.UUID(check_id))


@job("targets.map_profile")
def map_profile(db: Session, target_id: str) -> None:
    profile.run_mapping(db, uuid.UUID(target_id))
