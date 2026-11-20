"""Reading the detection results of a campaign run's attempts (FR-6.1; UC-5.6, UC-6.1). Every
member of the organization may read them, like the run itself; another organization gets "not
found"."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m04_tests.schema import DETECTION_LABELS, DetectionMethod
from app.modules.m05_campaigns import runs
from app.modules.m05_campaigns.models import Attempt
from app.modules.m06_findings.models import DetectionResult, DetectionVerdict, Outcome

# The order of the methods everywhere: canary token, rule matching, tool calls, LLM judge
ORDER = {method.value: number for number, method in enumerate(DetectionMethod)}


def attempt_detection(
    db: Session, organization_id: uuid.UUID, code: str, number: int, attempt_no: int
) -> dict:
    """Each detection method's result for one attempt, and the combined verdict (UC-6.1 step 4)."""
    _, run = runs.run_row(db, organization_id, code, number)
    attempt = db.scalar(
        scoped_select(Attempt, organization_id).where(
            Attempt.campaign_run_id == run.id, Attempt.attempt_no == attempt_no
        )
    )
    if attempt is None:
        raise NotFoundError("Attempt not found.")
    verdict = db.scalar(
        scoped_select(DetectionVerdict, organization_id).where(
            DetectionVerdict.attempt_id == attempt.id
        )
    )
    results = db.scalars(
        scoped_select(DetectionResult, organization_id).where(
            DetectionResult.attempt_id == attempt.id
        )
    ).all()
    return {
        "attempt_no": attempt.attempt_no,
        "test_code": attempt.test_code,
        "verdict": verdict,
        "results": [
            {
                **{c.key: getattr(r, c.key) for c in DetectionResult.__table__.columns},
                "method_label": DETECTION_LABELS[DetectionMethod(r.method)],
            }
            for r in sorted(results, key=lambda r: ORDER.get(r.method, len(ORDER)))
        ],
    }


def run_detection(
    db: Session,
    organization_id: uuid.UUID,
    code: str,
    number: int,
    outcome: str,
    page: int,
    page_size: int,
) -> dict:
    """The verdicts of a run's attempts in the order they were planned, one page at a time
    (NFR-6.2), and how many of the run's attempts have each verdict."""
    _, run = runs.run_row(db, organization_id, code, number)
    query = (
        select(DetectionVerdict, Attempt.attempt_no, Attempt.test_code)
        .join(Attempt, Attempt.id == DetectionVerdict.attempt_id)
        .where(
            DetectionVerdict.organization_id == organization_id,
            DetectionVerdict.campaign_run_id == run.id,
        )
    )
    if outcome:
        query = query.where(DetectionVerdict.outcome == outcome)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(
        query.order_by(Attempt.attempt_no).offset((page - 1) * page_size).limit(page_size)
    ).all()
    methods: dict[uuid.UUID, dict[str, str]] = {}
    ids = [verdict.attempt_id for verdict, _, _ in rows]
    if ids:
        found = db.scalars(select(DetectionResult).where(DetectionResult.attempt_id.in_(ids)))
        for result in sorted(found, key=lambda r: ORDER.get(r.method, len(ORDER))):
            methods.setdefault(result.attempt_id, {})[result.method] = result.outcome
    counts = dict(
        db.execute(
            select(DetectionVerdict.outcome, func.count())
            .where(
                DetectionVerdict.organization_id == organization_id,
                DetectionVerdict.campaign_run_id == run.id,
            )
            .group_by(DetectionVerdict.outcome)
        ).all()
    )
    return {
        "items": [
            {
                "attempt_no": attempt_no,
                "test_code": test_code,
                "outcome": verdict.outcome,
                "decided_by": verdict.decided_by,
                "requires_confirmation": verdict.requires_confirmation,
                "disagreement": verdict.disagreement,
                "methods": methods.get(verdict.attempt_id, {}),
            }
            for verdict, attempt_no, test_code in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "counts": {o.value: counts.get(o.value, 0) for o in Outcome},
    }
