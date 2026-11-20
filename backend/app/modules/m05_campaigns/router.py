import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m05_campaigns import service
from app.modules.m05_campaigns.schemas import (
    CampaignDetail,
    CampaignIn,
    CampaignListItem,
    EstimateIn,
    EstimateOut,
)

router = APIRouter(prefix="/campaigns", tags=["M5 Campaign Management"])
can_manage = require(Action.MANAGE_CAMPAIGNS)  # Security Analysts (FR-1.6)


@router.get("")
def list_campaigns(
    suite: str = "",
    target_id: uuid.UUID | None = None,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[CampaignListItem]:
    """The campaigns page (Screen 33); every member may read it."""
    rows = service.list_campaigns(db, membership.organization_id, suite, target_id)
    return [CampaignListItem.model_validate(row) for row in rows]


@router.post("/estimate")
def estimate(
    data: EstimateIn,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> EstimateOut:
    """For the builder's summary card: the tests that will run and the attempts they need."""
    result = service.estimate(
        db, membership.organization_id, data.target_id, data.suites, data.attempt_budget
    )
    return EstimateOut.model_validate(result)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_campaign(
    data: CampaignIn, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> CampaignDetail:
    """UC-5.1 Create Campaign. Nothing is sent to the target."""
    campaign = service.create(db, membership, service.CampaignInput(**data.model_dump()))
    return CampaignDetail.model_validate(
        service.get_campaign(db, membership.organization_id, campaign.code)
    )


@router.get("/{code}")
def get_campaign(
    code: str, membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> CampaignDetail:
    return CampaignDetail.model_validate(service.get_campaign(db, membership.organization_id, code))
