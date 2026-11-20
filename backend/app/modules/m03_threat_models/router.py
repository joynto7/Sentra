import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets.service import get_target
from app.modules.m03_threat_models import generation, service
from app.modules.m03_threat_models.models import JobTrigger
from app.modules.m03_threat_models.schemas import JobOut, ThreatModelList, ThreatModelPage

router = APIRouter(prefix="/threat-models", tags=["M3 Threat Modeling"])

# Every member may read the organization's threat models; generating, reviewing and approving
# them is the Security Analyst's work (UC-3.1 to UC-3.4).
can_manage = require(Action.MANAGE_THREAT_MODELS)


@router.get("")
def list_threat_models(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> ThreatModelList:
    """Screen 25: each target with its newest and its approved version."""
    return service.overview(db, membership.organization_id)


@router.get("/{target_id}")
def get_threat_model(
    target_id: uuid.UUID,
    version: int | None = Query(default=None, ge=1),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> ThreatModelPage:
    """Screen 26: one version (the newest by default), its components and threats."""
    target = get_target(db, membership.organization_id, target_id)
    return service.page(db, target, version)


@router.post("/{target_id}/generate", status_code=status.HTTP_202_ACCEPTED)
def generate(
    target_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> JobOut:
    """UC-3.1: "Generate threat model". A worker makes the next draft version; follow the job
    with GET .../jobs/{id}."""
    target = get_target(db, membership.organization_id, target_id)
    job = generation.request(
        db, target, trigger=JobTrigger.REQUESTED, requested_by=membership.user_id
    )
    return service.get_job(db, target.id, job.id)


@router.get("/{target_id}/jobs/{job_id}")
def get_job(
    target_id: uuid.UUID,
    job_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> JobOut:
    target = get_target(db, membership.organization_id, target_id)
    return service.get_job(db, target.id, job_id)
