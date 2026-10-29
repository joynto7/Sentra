from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m06_findings import service
from app.modules.m06_findings.models import Outcome
from app.modules.m06_findings.schemas import AttemptDetectionOut, RunDetectionPage

router = APIRouter(prefix="/campaigns", tags=["M6 Detection, Findings & Evidence"])


@router.get("/{code}/runs/{number}/detection")
def run_detection(
    code: str,
    number: int,
    outcome: Outcome | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> RunDetectionPage:
    """The verdict of each evaluated attempt of a run (UC-6.1 step 5), for the live campaign
    monitor (Screen 36). Every member of the organization may read it."""
    page_data = service.run_detection(
        db, membership.organization_id, code, number, outcome or "", page, page_size
    )
    return RunDetectionPage.model_validate(page_data)


@router.get("/{code}/runs/{number}/attempts/{attempt_no}/detection")
def attempt_detection(
    code: str,
    number: int,
    attempt_no: int,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AttemptDetectionOut:
    """FR-6.1: the result of each detection method of the attempt, stored separately, and the
    combined verdict (Screen 40, "Detection results")."""
    data = service.attempt_detection(db, membership.organization_id, code, number, attempt_no)
    return AttemptDetectionOut.model_validate(data, from_attributes=True)
