"""The autopilot's API (everything under /api/v1/autopilot).

GET  /plan?target_id=      what an assessment of that target would do and cost
POST /                     start one (Security Analysts, who may manage campaigns)
GET  /                     the organization's assessments, newest first
GET  /{id}                 one assessment with its story
POST /{id}/refresh         do the next step now; the page calls this while it is open
POST /{id}/stop            stop it and its run
"""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.autopilot import service
from app.modules.autopilot.models import ACTIVE, AutopilotRun
from app.modules.autopilot.schemas import AutopilotOut, PlanOut, StartIn, StepOut
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, allowed, require
from app.modules.m02_targets.models import Target
from app.modules.m05_campaigns.models import Campaign, CampaignRun

router = APIRouter(prefix="/autopilot", tags=["Autopilot"])
can_start = require(Action.MANAGE_CAMPAIGNS)


def _out(db: Session, membership: Membership, run: AutopilotRun) -> AutopilotOut:
    target = db.get(Target, run.target_id)
    starter = db.get(User, run.started_by_id) if run.started_by_id else None
    campaign = db.get(Campaign, run.campaign_id) if run.campaign_id else None
    campaign_run = db.get(CampaignRun, run.run_id) if run.run_id else None
    return AutopilotOut(
        id=run.id,
        code=run.code,
        target_id=run.target_id,
        target_name=target.name if target else "",
        status=run.status,
        stage=run.stage,
        waiting_for=run.waiting_for,
        message=run.message,
        started_by=starter.name if starter else None,
        created_at=run.created_at,
        finished_at=run.finished_at,
        plan={k: v for k, v in run.plan.items() if k != "suites"},
        steps=[StepOut(**step) for step in run.steps],
        summary=run.summary,
        progress=service.progress(db, run),
        campaign_code=campaign.code if campaign else None,
        run_number=campaign_run.number if campaign_run else None,
        can_stop=run.status in ACTIVE and allowed(membership.role, Action.STOP_CAMPAIGN_RUNS),
    )


@router.get("/plan")
def plan(
    target_id: uuid.UUID = Query(),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> PlanOut:
    target = service._target(db, membership.organization_id, target_id)
    reason = service._blocker(db, target)
    if reason is None and (active := service._active_for(db, target.id)) is not None:
        reason = f"{active.code} is already assessing {target.name}."
    if reason is None and not allowed(membership.role, Action.MANAGE_CAMPAIGNS):
        reason = "Only a Security Analyst can start the autopilot."
    plan = service.plan_for(db, membership.organization_id, target)
    return PlanOut(
        target_id=target.id,
        target_name=target.name,
        can_start=reason is None,
        reason=reason,
        **{k: v for k, v in plan.items() if k != "suites"},
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def start(
    data: StartIn,
    membership: Membership = Depends(can_start),
    db: Session = Depends(get_db),
) -> AutopilotOut:
    return _out(db, membership, service.start(db, membership, data.target_id))


@router.get("")
def listing(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> list[AutopilotOut]:
    return [_out(db, membership, run) for run in service.listing(db, membership.organization_id)]


@router.get("/{run_id}")
def detail(
    run_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AutopilotOut:
    return _out(db, membership, service.row(db, membership.organization_id, run_id))


@router.post("/{run_id}/refresh")
def refresh(
    run_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AutopilotOut:
    run = service.row(db, membership.organization_id, run_id)
    service.advance(db, run.id)
    db.refresh(run)
    return _out(db, membership, run)


@router.post("/{run_id}/stop")
def stop(
    run_id: uuid.UUID,
    membership: Membership = Depends(require(Action.STOP_CAMPAIGN_RUNS)),
    db: Session = Depends(get_db),
) -> AutopilotOut:
    return _out(db, membership, service.stop(db, membership, run_id))
