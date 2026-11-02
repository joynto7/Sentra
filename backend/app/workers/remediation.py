"""The jobs of Module 8. Writing a remediation proposal calls the LLM, so it runs on the workers
(architecture 2.5.4: the Analysis Worker generates remediation proposals), and the second half of
a retest — the requests of normal use and the comparison — reaches a target, so it runs there
too (FR-8.4)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m08_remediation import generation, retest
from app.workers.jobs import job


@job("remediation.generate")
def generate(db: Session, job_id: str) -> None:
    generation.run(db, uuid.UUID(job_id))


@job("remediation.finish_retest")
def finish_retest(db: Session, retest_id: str, waits: str = "0") -> None:
    """UC-8.6 steps 4-6, once the retest run has ended: the benign requests of the target and the
    before-and-after comparison. `waits` counts how often it has waited for a detection verdict
    that is still pending."""
    retest.finish(db, uuid.UUID(retest_id), int(waits))
