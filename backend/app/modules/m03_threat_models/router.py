import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ConflictError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m02_targets.service import ARCHIVED, get_target
from app.modules.m03_threat_models import generation, recommendations, service, versions
from app.modules.m03_threat_models.models import JobTrigger
from app.modules.m03_threat_models.schemas import (
    CompareOut,
    GapIn,
    JobOut,
    Recommendations,
    SelectionIn,
    ThreatModelList,
    ThreatModelPage,
    VersionIn,
)

router = APIRouter(prefix="/threat-models", tags=["M3 Threat Modeling"])

# Every member may read the organization's threat models; generating, reviewing and approving
# them is the Security Analyst's work (UC-3.1 to UC-3.4).
can_manage = require(Action.MANAGE_THREAT_MODELS)


def _changeable(db: Session, membership: Membership, target_id: uuid.UUID) -> Target:
    target = get_target(db, membership.organization_id, target_id)
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError(ARCHIVED, code="target_archived")
    return target


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


@router.post("/{target_id}/versions", status_code=status.HTTP_201_CREATED)
def save_version(
    target_id: uuid.UUID,
    data: VersionIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> ThreatModelPage:
    """UC-3.2 steps 3-4: the changes become the next version. 409 `newer_version` when someone
    saved a version after `base_version` (5b)."""
    target = _changeable(db, membership, target_id)
    model = versions.save(db, target, db.get_one(User, membership.user_id), data)
    return service.page(db, target, model.version)


@router.post("/{target_id}/versions/{version}/approve")
def approve(
    target_id: uuid.UUID,
    version: int,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> ThreatModelPage:
    """UC-3.2 steps 5-6: only the newest version can be approved, and only by a person."""
    target = _changeable(db, membership, target_id)
    versions.approve(db, target, db.get_one(User, membership.user_id), version)
    return service.page(db, target, version)


@router.post("/{target_id}/versions/{version}/restore", status_code=status.HTTP_201_CREATED)
def restore(
    target_id: uuid.UUID,
    version: int,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> ThreatModelPage:
    """UC-3.4, 3a: an earlier version becomes the next draft."""
    target = _changeable(db, membership, target_id)
    model = versions.restore(db, target, db.get_one(User, membership.user_id), version)
    return service.page(db, target, model.version)


@router.get("/{target_id}/compare")
def compare(
    target_id: uuid.UUID,
    base: int = Query(ge=1),
    compare: int = Query(ge=1),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> CompareOut:
    """Screen 28: added, removed and changed threats between two versions (UC-3.4)."""
    target = get_target(db, membership.organization_id, target_id)
    return service.compare(db, target, base, compare)


@router.get("/{target_id}/recommendations")
def get_recommendations(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> Recommendations:
    """Screen 27: the suites for the newest approved version, by risk (UC-3.3)."""
    target = get_target(db, membership.organization_id, target_id)
    return service.recommendations_out(db, target)


@router.put("/{target_id}/selection")
def save_selection(
    target_id: uuid.UUID,
    data: SelectionIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> Recommendations:
    """UC-3.3 steps 5-6: the default suites for the target's new campaigns."""
    target = _changeable(db, membership, target_id)
    user = db.get_one(User, membership.user_id)
    recommendations.save_selection(db, target, user, data.version, data.suites)
    return service.recommendations_out(db, target)


@router.post("/{target_id}/gaps")
def accept_gap(
    target_id: uuid.UUID,
    data: GapIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> Recommendations:
    """UC-3.3, 3a1: why a threat without a test is accepted for now."""
    target = _changeable(db, membership, target_id)
    user = db.get_one(User, membership.user_id)
    recommendations.accept_gap(db, target, user, data.version, data.threat, data.reason)
    return service.recommendations_out(db, target)
