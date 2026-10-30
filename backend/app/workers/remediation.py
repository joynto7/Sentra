"""The jobs of Module 8. Writing a remediation proposal calls the LLM, so it runs on the workers
(architecture 2.5.4: the Analysis Worker generates remediation proposals)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m08_remediation import generation
from app.workers.jobs import job


@job("remediation.generate")
def generate(db: Session, job_id: str) -> None:
    generation.run(db, uuid.UUID(job_id))
