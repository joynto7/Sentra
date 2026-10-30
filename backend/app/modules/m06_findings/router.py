import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m04_tests.schema import Category, Severity
from app.modules.m06_findings import service
from app.modules.m06_findings.models import FindingStatus, Outcome
from app.modules.m06_findings.schemas import (
    AttemptDetectionOut,
    EvidenceItem,
    EvidenceOut,
    FindingFiltersOut,
    FindingOut,
    FindingPage,
    RunDetectionPage,
)

router = APIRouter(tags=["M6 Detection, Findings & Evidence"])


@router.get("/campaigns/{code}/runs/{number}/detection")
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


@router.get("/campaigns/{code}/runs/{number}/attempts/{attempt_no}/detection")
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


# ---------------------------------------------------------------- findings (FR-6.2, FR-6.3)


@router.get("/findings")
def list_findings(
    view: Literal["open", "requires_confirmation", "closed"] | None = None,
    severity: Severity | None = None,
    category: Category | None = None,
    status: FindingStatus | None = None,
    target_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
    search: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> FindingPage:
    """UC-6.4: the organization's findings, the most severe first, filtered by quick view
    (Screen 38's tabs), severity, category, status, target, campaign run or a search."""
    filters = service.FindingFilters(
        view=view or "",
        severity=severity or "",
        category=category or "",
        status=status or "",
        target_id=target_id,
        run_id=run_id,
        search=search,
    )
    data = service.list_findings(db, membership.organization_id, filters, page, page_size)
    return FindingPage.model_validate(data)


@router.get("/findings/filter-options")
def finding_filter_options(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> FindingFiltersOut:
    """The targets, campaign runs and categories that the organization's findings have."""
    data = service.finding_filter_options(db, membership.organization_id)
    return FindingFiltersOut.model_validate(data)


@router.get("/findings/{code}")
def get_finding(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> FindingOut:
    """UC-6.5: one finding with its details (FR-6.2), runs and detection (Screen 39)."""
    return FindingOut.model_validate(service.finding_detail(db, membership.organization_id, code))


@router.get("/findings/{code}/evidence")
def list_evidence(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[EvidenceItem]:
    """FR-6.3: the finding's evidence records, in the order they were recorded (Screen 40)."""
    rows = service.list_evidence(db, membership.organization_id, code)
    return [EvidenceItem.model_validate(row) for row in rows]


@router.get("/findings/{code}/evidence/{number}")
def get_evidence(
    code: str,
    number: int,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> EvidenceOut:
    """FR-6.3, NFR-2.4: one evidence document, read-only, with the check of its checksum."""
    data = service.evidence_detail(db, membership.organization_id, code, number)
    return EvidenceOut.model_validate(data)
