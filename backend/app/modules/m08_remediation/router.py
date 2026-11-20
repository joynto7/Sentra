import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m06_findings.service import finding_row
from app.modules.m08_remediation import generation, service
from app.modules.m08_remediation.schemas import JobOut, RemediationList, RemediationPage

router = APIRouter(prefix="/remediations", tags=["M8 Remediation"])

# Every member may read the organization's proposals; asking for one is the work of the
# application's developer or a security analyst (UC-8.2 primary actors).
can_request = require(Action.REQUEST_REMEDIATIONS)


@router.get("")
def list_remediations(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> RemediationList:
    """Screen 45: the findings that wait for a fix and their proposals."""
    return service.overview(db, membership.organization_id)


@router.get("/{finding_code}")
def get_remediation(
    finding_code: str,
    version: int | None = Query(default=None, ge=1),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> RemediationPage:
    """Screen 46: one version of a finding's proposal (the newest by default) with its fixes."""
    return service.page(db, membership.organization_id, finding_code, version)


@router.post("/{finding_code}/generate", status_code=status.HTTP_202_ACCEPTED)
def generate(
    finding_code: str,
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> JobOut:
    """UC-8.2: "Request remediation". A worker writes the draft; follow the job with
    GET .../jobs/{id}. A finding that already has a proposal gets a revision (1b)."""
    finding = finding_row(db, membership.organization_id, finding_code)
    job = generation.request(db, finding, requested_by=membership.user_id)
    return service.get_job(db, finding.id, job.id)


@router.get("/{finding_code}/jobs/{job_id}")
def get_job(
    finding_code: str,
    job_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> JobOut:
    """The state of one generation, which the page follows until the draft is there."""
    finding = finding_row(db, membership.organization_id, finding_code)
    return service.get_job(db, finding.id, job_id)
