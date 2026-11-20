import uuid

from fastapi import APIRouter, Depends, Header, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m05_campaigns import runs, service
from app.modules.m05_campaigns.models import ENDED, AttemptStatus
from app.modules.m05_campaigns.schemas import (
    AttemptOut,
    AttemptPage,
    CampaignDetail,
    CampaignIn,
    CampaignListItem,
    EstimateIn,
    EstimateOut,
    RunDetail,
    RunListItem,
    StopIn,
)

router = APIRouter(prefix="/campaigns", tags=["M5 Campaign Management"])
can_manage = require(Action.MANAGE_CAMPAIGNS)  # Security Analysts (FR-1.6)
can_pause = require(Action.PAUSE_CAMPAIGN_RUNS)  # Security Analysts (UC-5.7)
can_stop = require(Action.STOP_CAMPAIGN_RUNS)  # also AI Application Developers (UC-5.7, 1b)


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


# ---------------------------------------------------------------- campaign runs (FR-5.4, FR-5.6)


def _detail(db: Session, membership: Membership, code: str, number: int) -> RunDetail:
    campaign, run = runs.run_row(db, membership.organization_id, code, number)
    return RunDetail.model_validate(runs.run_detail(db, campaign, run))


@router.post("/{code}/runs", status_code=status.HTTP_202_ACCEPTED)
def launch(
    code: str, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> RunDetail:
    """UC-5.3 Launch Campaign: returns at once with the new run, which the workers execute."""
    run = runs.launch(db, membership, code)
    return _detail(db, membership, code, run.number)


@router.get("/{code}/runs")
def list_runs(
    code: str, membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> list[RunListItem]:
    """Every member of the organization may follow its runs (UC-5.6)."""
    rows = runs.list_runs(db, membership.organization_id, code)
    return [RunListItem.model_validate(row) for row in rows]


@router.get("/{code}/runs/{number}")
def get_run(
    code: str,
    number: int,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> RunDetail:
    """UC-5.6 steps 2 and 5: the live campaign monitor (Screen 36)."""
    return _detail(db, membership, code, number)


@router.get("/{code}/runs/{number}/attempts")
def list_attempts(
    code: str,
    number: int,
    attempt_status: AttemptStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AttemptPage:
    _, run = runs.run_row(db, membership.organization_id, code, number)
    rows, total = runs.list_attempts(db, run, attempt_status or "", page, page_size)
    return AttemptPage(
        items=[AttemptOut.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{code}/runs/{number}/events")
def run_events(
    code: str,
    number: int,
    after: str = Query(default="", max_length=40),
    last_event_id: str | None = Header(default=None, max_length=40),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """UC-5.6 step 3 and 3a: the run's live events as Server-Sent Events (text/event-stream).
    A browser that reconnects sends the Last-Event-ID header and gets the events it missed."""
    _, run = runs.run_row(db, membership.organization_id, code, number)
    ended = run.status in ENDED and run.finalized_at is not None
    return StreamingResponse(
        runs.events(run.id, last_event_id or after or None, ended),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{code}/runs/{number}/pause")
def pause_run(
    code: str,
    number: int,
    membership: Membership = Depends(can_pause),
    db: Session = Depends(get_db),
) -> RunDetail:
    """UC-5.7 steps 1-3."""
    runs.pause(db, membership, code, number)
    return _detail(db, membership, code, number)


@router.post("/{code}/runs/{number}/resume")
def resume_run(
    code: str,
    number: int,
    membership: Membership = Depends(can_pause),
    db: Session = Depends(get_db),
) -> RunDetail:
    """UC-5.7 step 4 and 4a."""
    runs.resume(db, membership, code, number)
    return _detail(db, membership, code, number)


@router.post("/{code}/runs/{number}/stop")
def stop_run(
    code: str,
    number: int,
    data: StopIn | None = None,
    membership: Membership = Depends(can_stop),
    db: Session = Depends(get_db),
) -> RunDetail:
    """UC-5.7, 1a and 1b: no further attempt is sent (FR-5.6)."""
    runs.stop(db, membership, code, number, data.reason if data else "")
    return _detail(db, membership, code, number)
