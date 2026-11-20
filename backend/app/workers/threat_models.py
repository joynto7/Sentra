"""The jobs of Module 3. Generating a threat model calls the LLM, so it runs on the workers
(architecture 2.5.4: the Analysis Worker generates threat models)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m03_threat_models import generation
from app.workers.jobs import job


@job("threat_models.generate")
def generate(db: Session, job_id: str) -> None:
    generation.run(db, uuid.UUID(job_id))


@job("threat_models.after_profile_review")
def after_profile_review(db: Session, target_id: str, user_id: str) -> None:
    """Module 2 starts this job by name when a profile review is saved (UC-3.1 trigger)."""
    generation.after_profile_review(db, uuid.UUID(target_id), uuid.UUID(user_id))
