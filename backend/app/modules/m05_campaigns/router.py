import uuid

from fastapi import APIRouter, Depends, Header, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m05_campaigns import approval, runs, scheduling, service
from app.modules.m05_campaigns.models import ENDED, AttemptStatus, RunStatus
from app.modules.m05_campaigns.schemas import (
    AgentOut,
    ApprovalDecisionIn,
    ApprovalView,
    AttemptOut,
    AttemptPage,
    CampaignDetail,
    CampaignIn,
    CampaignRowOut,
    EstimateIn,
    EstimateOut,
    RefinementOut,
    RunDetail,
    RunListItem,
    RunOverviewItem,
    ScheduleIn,
    ScheduleOut,
    StopIn,
    SubmitForApprovalIn,
)

router = APIRouter(prefix="/campaigns", tags=["M5 Campaign Management"])
can_manage = require(Action.MANAGE_CAMPAIGNS)  # Security Analysts (FR-1.6)
can_pause = require(Action.PAUSE_CAMPAIGN_RUNS)  # Security Analysts (UC-5.7)
can_stop = require(Action.STOP_CAMPAIGN_RUNS)  # also AI Application Developers (UC-5.7, 1b)
can_approve = require(Action.APPROVE_CAMPAIGN_SCOPE)  # Security Managers (UC-5.2)


@router.get("")
def list_campaigns(
    suite: str = "",
    target_id: uuid.UUID | None = None,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[CampaignRowOut]:
    """The campaigns page (Screen 33); every member may read it. Each campaign comes with who
    approved it and its newest run (UX task 4.5)."""
    organization_id = membership.organization_id
    rows = service.list_campaigns(db, organization_id, suite, target_id)
    approved = approval.approvers(db, organization_id)
    latest = runs.last_runs(db, organization_id)
    return [
        CampaignRowOut.model_validate(
            {**row, "approved_by": approved.get(row["id"]), "last_run": latest.get(row["id"])}
        )
        for row in rows
    ]


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
    """UC-5.1 Create Campaign. Creating a campaign sends nothing to the target; step 7 launches
    its first run only when the user chose to run it immediately, and a campaign with a schedule
    waits for its moment (FR-5.3)."""
    fields = data.model_dump()
    chosen = fields.pop("schedule")
    immediately = chosen is not None and chosen["kind"] == scheduling.IMMEDIATELY
    planned = scheduling.ScheduleInput(**chosen) if chosen and not immediately else None
    campaign = service.create(db, membership, service.CampaignInput(**fields, schedule=planned))
    launched = error = None
    if immediately:
        try:
            runs.launch(db, membership, campaign.code)
        except AppError as exc:  # 7a, 3a or 4a: the campaign is saved, and the page says why
            error = exc.message
        else:
            launched = runs.list_runs(db, membership.organization_id, campaign.code)[0]
    return CampaignDetail.model_validate(
        {
            **service.get_campaign(db, membership.organization_id, campaign.code),
            "launched_run": launched,
            "launch_error": error,
        }
    )


@router.get("/runs")
def list_organization_runs(
    target_id: uuid.UUID | None = None,
    status: RunStatus | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[RunOverviewItem]:
    """The organization's campaign runs, newest first (Screen 33's "Campaign runs", and the
    recent runs of a target on Screen 20). Every member may read them."""
    rows = runs.list_organization_runs(
        db, membership.organization_id, target_id=target_id, status=status or "", limit=limit
    )
    return [RunOverviewItem.model_validate(row) for row in rows]


@router.get("/{code}")
def get_campaign(
    code: str, membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> CampaignDetail:
    return CampaignDetail.model_validate(service.get_campaign(db, membership.organization_id, code))


# ---------------------------------------------------------------- the schedule (FR-5.3)


def _schedule(db: Session, membership: Membership, code: str) -> ScheduleOut | None:
    campaign = runs.campaign_row(db, membership.organization_id, code)
    view = scheduling.view(db, campaign)
    return ScheduleOut.model_validate(view) if view else None


@router.get("/{code}/schedule")
def get_schedule(
    code: str, membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> ScheduleOut | None:
    """When the campaign runs by itself, and what came of its last moment. Every member may read
    it; null means it only runs when someone launches it."""
    return _schedule(db, membership, code)


@router.put("/{code}/schedule")
def save_schedule(
    code: str,
    data: ScheduleIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> ScheduleOut:
    """UC-5.1 step 5 for a campaign that is already saved: it replaces the schedule it had. The
    member who saves it is the one whose permissions its runs use (UC-5.3, 1a1)."""
    campaign = runs.campaign_row(db, membership.organization_id, code)
    before = scheduling.view(db, campaign)
    scheduling.save(db, membership, campaign, scheduling.ScheduleInput(**data.model_dump()))
    db.commit()
    after = scheduling.view(db, campaign)
    if (before or {}).get("summary") != (after or {}).get("summary"):
        # UC-5.2, 5a1: a changed schedule needs a new approval, where approval is required
        approval.after_schedule_change(db, membership, campaign)
    return _schedule(db, membership, code)


@router.post("/{code}/schedule/pause")
def pause_schedule(
    code: str, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> ScheduleOut:
    """No run starts from the schedule until it is resumed. A run already in progress goes on."""
    campaign = runs.campaign_row(db, membership.organization_id, code)
    scheduling.pause(db, membership, campaign)
    db.commit()
    return _schedule(db, membership, code)


@router.post("/{code}/schedule/resume")
def resume_schedule(
    code: str, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> ScheduleOut:
    campaign = runs.campaign_row(db, membership.organization_id, code)
    scheduling.resume(db, membership, campaign)
    db.commit()
    return _schedule(db, membership, code)


@router.delete("/{code}/schedule", status_code=status.HTTP_204_NO_CONTENT)
def remove_schedule(
    code: str, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> None:
    """The campaign keeps its settings and its runs: it simply runs only when someone starts it."""
    campaign = runs.campaign_row(db, membership.organization_id, code)
    scheduling.remove(db, membership, campaign)
    db.commit()


# ---------------------------------------------------------------- campaign runs (FR-5.4, FR-5.6)


def _detail(db: Session, membership: Membership, code: str, number: int) -> RunDetail:
    campaign, run = runs.run_row(db, membership.organization_id, code, number)
    return RunDetail.model_validate(runs.run_detail(db, campaign, run))


# ---------------------------------------------------------------- scope approval (FR-5.2)


@router.get("/{code}/approval")
def get_approval(
    code: str, membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> ApprovalView:
    """Screen 35, UC-5.2 step 2: everything the decision needs. Every member may read it;
    `can_decide` says whether this user may decide, and why not when they may not."""
    return ApprovalView.model_validate(approval.view(db, membership, code))


@router.post("/{code}/approval")
def submit_for_approval(
    code: str,
    data: SubmitForApprovalIn | None = None,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> ApprovalView:
    """UC-5.2, 3a1: the analyst asks for a decision again after a rejection, or for a campaign
    that is older than the organization's requirement."""
    approval.submit(db, membership, code, data.note if data else None)
    return ApprovalView.model_validate(approval.view(db, membership, code))


@router.post("/{code}/approval/decision")
def decide_approval(
    code: str,
    data: ApprovalDecisionIn,
    membership: Membership = Depends(can_approve),
    db: Session = Depends(get_db),
) -> ApprovalView:
    """UC-5.2 steps 3 and 4, or 3a: the Security Manager approves or rejects the scope. A
    rejection needs a reason, and nobody decides on a campaign they created themselves."""
    approval.decide(db, membership, code, data.approve, data.reason)
    return ApprovalView.model_validate(approval.view(db, membership, code))


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


@router.get("/{code}/runs/{number}/agent")
def run_agent(
    code: str,
    number: int,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AgentOut:
    """UC-5.5 step 5 and FR-5.5: what the adaptive testing agent did in this run — every
    refinement with its reason, the ones that were discarded as out of scope (3a1), and why it
    stopped if it did (2a1). Screens 36 and 37 read it; every member may."""
    _, run = runs.run_row(db, membership.organization_id, code, number)
    found = runs.agent_trail(db, run)
    return AgentOut(
        **{**found, "items": [RefinementOut.model_validate(row) for row in found["items"]]}
    )


@router.post("/{code}/runs/{number}/agent/stop")
def stop_run_agent(
    code: str,
    number: int,
    data: StopIn | None = None,
    membership: Membership = Depends(can_stop),
    db: Session = Depends(get_db),
) -> AgentOut:
    """FR-5.5: the analyst (or a developer, as for UC-5.7 1b) stops the adaptive testing agent in
    this run. The run goes on with its planned tests."""
    runs.stop_agent(db, membership, code, number, data.reason if data else "")
    return run_agent(code, number, membership, db)
