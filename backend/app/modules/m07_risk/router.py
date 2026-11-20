import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m07_risk import service
from app.modules.m07_risk.schemas import (
    DashboardOut,
    FindingSeverityOut,
    MethodOut,
    TargetRiskOut,
)

router = APIRouter(tags=["M7 Risk Analysis & Visualization"])


@router.get("/risk/dashboard")
def dashboard(
    target_id: uuid.UUID | None = None,
    days: int = Query(default=service.DEFAULT_PERIOD_DAYS, ge=1, le=3650),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> DashboardOut:
    """UC-7.3: the risk score of each target, its open findings by severity and all findings by
    status, for the selected target and period (Screen 42). Every member may read it."""
    data = service.dashboard(db, membership.organization_id, target_id=target_id, days=days)
    return DashboardOut.model_validate(data)


@router.get("/risk/method")
def method() -> MethodOut:
    """How a severity and a risk score are calculated ("How is the risk score calculated?",
    Screen 42): the same rules the code uses (FR-7.1, FR-7.2; NFR-4.2)."""
    return MethodOut.model_validate(service.how_it_works())


@router.get("/targets/{target_id}/risk")
def target_risk(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> TargetRiskOut:
    """UC-7.2: the target's current risk score with the findings it counts and its history
    (Screen 20's risk card, UC-2.7)."""
    return TargetRiskOut.model_validate(
        service.target_risk(db, membership.organization_id, target_id)
    )


@router.get("/findings/{code}/severity")
def finding_severity(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> FindingSeverityOut:
    """FR-7.1: the severity of one finding and the factors behind it (Screen 39, NFR-4.2)."""
    return FindingSeverityOut.model_validate(
        service.finding_severity(db, membership.organization_id, code)
    )
