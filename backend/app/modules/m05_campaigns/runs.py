"""Campaign runs through the API (FR-5.4, FR-5.6): launching a campaign (UC-5.3), the runs and
attempts that the live campaign monitor shows (UC-5.6), and pause, resume and stop (UC-5.7).

The API never sends anything to a target: a launch queues the run's start job and returns at once
(UC-5.3, quality requirement 5), and the Background Workers run it (engine.py).
"""

import asyncio
import re
import uuid
from collections.abc import AsyncIterator
from datetime import time

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.tenancy import scoped_select
from app.llm.usage import cost_of_run
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns import lifecycle, limits, service
from app.modules.m05_campaigns.models import (
    ENDED,
    ApprovalStatus,
    Attempt,
    Campaign,
    CampaignRun,
    PauseKind,
    RunStatus,
    RunTrigger,
    RunType,
)
from app.workers import jobs
from app.workers.orchestrator import live

ENDED_ALREADY = "This run has already ended."


# ---------------------------------------------------------------- launching (UC-5.3)


def launch(
    db: Session, membership: Membership, code: str, trigger: RunTrigger = RunTrigger.MANUAL
) -> CampaignRun:
    """Steps 2-5: the approval, the target, the runs in progress and the monthly limits are
    checked; the run records the versions it uses and its start job is queued. The role is checked
    by the route; a schedule (FR-5.3) or a pipeline (FR-9.5) calls this with the permissions of the
    campaign's creator or of the API key (1a1)."""
    organization_id = membership.organization_id
    campaign = campaign_row(db, organization_id, code)
    user = db.get_one(User, membership.user_id)
    if campaign.approval_status == ApprovalStatus.AWAITING_APPROVAL:
        raise ConflictError(
            "This campaign is waiting for a Security Manager's approval, so it can't be launched "
            "yet.",
            code="awaiting_approval",
        )
    if campaign.approval_status == ApprovalStatus.REJECTED:
        raise ConflictError(
            "A Security Manager rejected this campaign's scope. Change the campaign and ask for "
            "approval again.",
            code="approval_rejected",
        )
    target = db.get_one(Target, campaign.target_id)
    if target.status != TargetStatus.VERIFIED:  # FR-5.7: only a verified target is tested
        raise ConflictError(
            f"{target.name} isn't verified, so this campaign can't run. Verify its ownership "
            "first.",
            code="target_not_verified",
        )
    _lab_ready(db, target)
    running = lifecycle.active_run(db, campaign.id)
    if running is not None:  # 4a
        raise ConflictError(
            f"Run {lifecycle.code(running, campaign)} of this campaign is still in progress. Wait "
            "until it ends, or stop it first.",
            code="run_in_progress",
        )
    in_force, used = limits.limits_for(db, organization_id), limits.usage(db, organization_id)
    reached = limits.reached(in_force, used, launching=True)
    if reached is not None:  # 3a
        db.rollback()
        lifecycle.notify_limit(db, organization_id, reached[1])
        raise ConflictError(reached[1], code="usage_limit_reached")
    suites, tests = _versions(db, campaign)
    if not tests:
        raise ConflictError(
            "None of this campaign's test suites can be used any more: they were archived or "
            "removed.",
            code="nothing_to_run",
        )

    number = (
        db.scalar(
            select(func.max(CampaignRun.number)).where(CampaignRun.campaign_id == campaign.id)
        )
        or 0
    ) + 1
    run = CampaignRun(
        organization_id=organization_id,
        campaign_id=campaign.id,
        target_id=target.id,
        number=number,
        run_type=RunType.CAMPAIGN,
        trigger=trigger,
        status=RunStatus.QUEUED,
        status_message="Waiting for a worker.",
        launched_by_id=user.id,
        settings=_settings(campaign),
        threat_model_id=campaign.threat_model_id,  # FR-3.3: the version it was based on
        versions={
            "suites": suites,
            "tests": tests,
            "threat_model": service._version(db, campaign.threat_model_id),
        },
        attempt_budget=campaign.attempt_budget,
        request_rate=min(campaign.request_rate, target.max_request_rate),
    )
    db.add(run)
    try:
        db.flush()
    except IntegrityError as exc:  # another launch of this campaign at the same moment (4a)
        db.rollback()
        raise ConflictError(
            "Another run of this campaign was launched at the same moment.", code="run_in_progress"
        ) from exc
    lifecycle.record(
        db,
        run,
        "campaign.run_launched",
        f"Launched campaign run {lifecycle.code(run, campaign)} of {campaign.name}",
        actor=user,
        details={
            "trigger": trigger,
            "target": target.name,
            "attempt_budget": run.attempt_budget,
            "request_rate": run.request_rate,
            "tests": len(tests),
        },
    )
    db.commit()
    # UC-10.6 step 5, with the run counted: the organization hears once a month that a limit is
    # coming close. It is after the commit, so the launch never waits for a notification.
    limits.watch(db, organization_id, in_force, limits.usage(db, organization_id))
    lifecycle.publish_status(run)
    if not lifecycle.dispatch(db, run):  # the Task Queue can't be reached
        lifecycle.cancel_unqueued(db, run.id)
        raise AppError(jobs.QUEUE_DOWN, code="queue_unavailable", status_code=503)
    return run


def _versions(db: Session, campaign: Campaign) -> tuple[list[dict], list[dict]]:
    """Step 4 (FR-4.5): the exact versions the run uses, current at the launch: each test of the
    campaign's suites once, in suite order."""
    found = service._suites(db, campaign.organization_id, campaign.suites)
    suites = [found[code] for code in campaign.suites if code in found]
    codes = list(dict.fromkeys(code for suite in suites for code in suite.tests))
    definitions = {
        d.code: d
        for d in db.scalars(
            select(TestDefinition).where(
                TestDefinition.code.in_(codes),
                TestDefinition.is_current.is_(True),
                TestDefinition.retired.is_(False),
                service._visible(TestDefinition, campaign.organization_id),
            )
        )
    }
    tests = [
        {
            "id": str(definitions[code].id),
            "code": code,
            "version": definitions[code].version,
            "suites": [suite.code for suite in suites if code in suite.tests],
        }
        for code in codes
        if code in definitions
    ]
    return [{"id": str(s.id), "code": s.code, "version": s.version} for s in suites], tests


def _clock(value: time | None) -> str | None:
    return value.isoformat(timespec="minutes") if value else None


def _lab_ready(db: Session, target: Target) -> None:
    """UC-11.2 step 1: a lab target that is being reset, or that a reset left not ready, is not
    tested — every run must start from the same state (FR-11.2). It costs one query, and only for
    a lab target; every other target is never in the way."""
    from app.modules.m11_lab import deployment

    if not deployment.before_run(db, target.id):
        raise ConflictError(
            f"{target.name} is a lab target that isn't ready. Reset it in the Security Lab first.",
            code="lab_target_not_ready",
        )


def _settings(campaign: Campaign) -> dict:
    """The campaign's settings at the launch: changing the campaign later doesn't change a run."""
    return {
        "suites": list(campaign.suites),
        "adaptive_agent": campaign.adaptive_agent,
        "attempt_budget": campaign.attempt_budget,
        "request_rate": campaign.request_rate,
        "repetitions": campaign.repetitions,
        "window_start": _clock(campaign.window_start),
        "window_end": _clock(campaign.window_end),
        "time_zone": campaign.time_zone,
    }


# ---------------------------------------------------------------- reading (UC-5.6)


def campaign_row(db: Session, organization_id: uuid.UUID, code: str) -> Campaign:
    match = re.fullmatch(r"C-(\d{1,9})", code)
    campaign = (
        db.scalar(
            scoped_select(Campaign, organization_id).where(Campaign.number == int(match.group(1)))
        )
        if match
        else None
    )
    if campaign is None:  # also another organization's campaign (NFR-3.3)
        raise NotFoundError("Campaign not found.")
    return campaign


def run_row(
    db: Session, organization_id: uuid.UUID, code: str, number: int, *, lock: bool = False
) -> tuple[Campaign, CampaignRun]:
    campaign = campaign_row(db, organization_id, code)
    query = scoped_select(CampaignRun, organization_id).where(
        CampaignRun.campaign_id == campaign.id, CampaignRun.number == number
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    run = db.scalar(query)
    if run is None:
        raise NotFoundError("Campaign run not found.")
    return campaign, run


def list_runs(db: Session, organization_id: uuid.UUID, code: str) -> list[dict]:
    campaign = campaign_row(db, organization_id, code)
    runs = db.scalars(
        select(CampaignRun)
        .where(CampaignRun.campaign_id == campaign.id)
        .order_by(CampaignRun.number.desc())
    ).all()
    names = _names(db, runs)
    return [_row(run, campaign, names) for run in runs]


def list_organization_runs(
    db: Session,
    organization_id: uuid.UUID,
    *,
    target_id: uuid.UUID | None = None,
    status: str = "",
    limit: int = 50,
) -> list[dict]:
    """Every run of the organization, newest first (UC-5.6 step 1, and the recent runs of a
    target on Screen 20). A campaign's own runs are `list_runs`."""
    query = scoped_select(CampaignRun, organization_id).order_by(CampaignRun.created_at.desc())
    if target_id is not None:
        query = query.where(CampaignRun.target_id == target_id)
    if status:
        query = query.where(CampaignRun.status == status)
    runs = list(db.scalars(query.limit(limit)))
    campaigns = {
        c.id: c
        for c in db.scalars(
            scoped_select(Campaign, organization_id).where(
                Campaign.id.in_({r.campaign_id for r in runs if r.campaign_id})
            )
        )
    }
    targets = {
        t.id: t
        for t in db.scalars(
            scoped_select(Target, organization_id).where(Target.id.in_({r.target_id for r in runs}))
        )
    }
    names = _names(db, runs)
    rows = []
    for run in runs:
        campaign = campaigns.get(run.campaign_id) if run.campaign_id else None
        target = targets.get(run.target_id)
        rows.append(
            {
                **_row(run, campaign, names),
                "campaign": {"code": campaign.code, "name": campaign.name} if campaign else None,
                "target": (
                    {"id": target.id, "name": target.name, "type": target.type} if target else None
                ),
            }
        )
    return rows


def run_detail(db: Session, campaign: Campaign, run: CampaignRun) -> dict:
    """Step 2 and 5: the run's state, its progress and limits, and when it has ended its summary.
    `last_event_id` is where the monitor follows the live events from (step 3)."""
    target = db.get_one(Target, run.target_id)
    names = _names(db, [run])
    ended = run.status in ENDED
    return {
        **_row(run, campaign, names),
        "campaign": {"code": campaign.code, "name": campaign.name},
        "target": {"id": target.id, "name": target.name, "type": target.type},
        "status_message": run.status_message,
        "paused_by": names.get(run.paused_by_id),
        "paused_at": run.paused_at,
        "pause_kind": run.pause_kind,
        "wake_at": run.wake_at,
        "window_ends_at": run.window_ends_at,
        "queue_position": _queue_position(db, run) if run.status == RunStatus.QUEUED else None,
        "request_rate": run.request_rate,
        "attempts_planned": run.attempts_planned,
        "attempts_replied": run.attempts_replied,
        "attempts_failed": run.attempts_failed,
        "cost_usd": run.cost_usd if run.finalized_at else cost_of_run(db, run.id),
        "settings": run.settings,
        "versions": run.versions,
        "tests": (run.plan or {}).get("tests", []),
        "summary": lifecycle.summary(db, run) if ended and run.finalized_at else None,
        "extension_errors": run.hook_errors or [],
        "last_event_id": live.last_id(run.id),
    }


def list_attempts(
    db: Session, run: CampaignRun, status: str, page: int, page_size: int
) -> tuple[list[Attempt], int]:
    """The attempts of a run, in the order they were planned (NFR-6.2: one page at a time)."""
    query = select(Attempt).where(Attempt.campaign_run_id == run.id)
    if status:
        query = query.where(Attempt.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(
        query.order_by(Attempt.attempt_no).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(rows), total


def _row(run: CampaignRun, campaign: Campaign | None, names: dict) -> dict:
    return {
        "id": run.id,
        "code": lifecycle.code(run, campaign),
        "number": run.number,
        "status": run.status,
        "end_reason": run.end_reason,
        "trigger": run.trigger,
        "launched_by": names.get(run.launched_by_id),
        "ended_by": names.get(run.ended_by_id),
        "created_at": run.created_at,
        "started_at": run.started_at,
        "ended_at": run.ended_at,
        "attempts_sent": run.attempts_sent,
        "attempt_budget": run.attempt_budget,
    }


def _names(db: Session, runs: list[CampaignRun]) -> dict:
    ids = {i for r in runs for i in (r.launched_by_id, r.ended_by_id, r.paused_by_id) if i}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all()) if ids else {}


def _queue_position(db: Session, run: CampaignRun) -> int | None:
    """UC-5.6, 1a1: how many runs wait for a worker before this one. A run that waits for its
    time window isn't in the line."""
    if run.wake_at is not None:
        return None
    ahead = db.scalar(
        select(func.count()).where(
            CampaignRun.status == RunStatus.QUEUED,
            CampaignRun.wake_at.is_(None),
            CampaignRun.created_at < run.created_at,
        )
    )
    return ahead + 1


# ---------------------------------------------------------------- the controls (UC-5.7)


def pause(db: Session, membership: Membership, code: str, number: int) -> CampaignRun:
    """Steps 1-3: the run pauses before its next attempt."""
    _, run = run_row(db, membership.organization_id, code, number, lock=True)
    if run.status in ENDED:
        raise ConflictError(ENDED_ALREADY, code="run_ended")
    if run.status == RunStatus.PAUSED and run.pause_kind == PauseKind.USER:
        raise ConflictError("This run is already paused.", code="run_paused")
    lifecycle.pause(db, run, db.get_one(User, membership.user_id))
    db.commit()
    lifecycle.publish_status(run)
    return run


def resume(db: Session, membership: Membership, code: str, number: int) -> CampaignRun:
    """Step 4 and 4a: the run goes on within its remaining budget and time window, or ends when
    its window closed while it was paused."""
    _, run = run_row(db, membership.organization_id, code, number, lock=True)
    if run.status != RunStatus.PAUSED:
        raise ConflictError("Only a paused run can be resumed.", code="run_not_paused")
    user = db.get_one(User, membership.user_id)
    if not lifecycle.resume(db, run, user):
        db.commit()
        lifecycle.publish_status(run)
        lifecycle.finalize(db, run.id)
        return run
    db.commit()
    lifecycle.publish_status(run)
    if not lifecycle.dispatch(db, run):
        _pause_again(db, run.id)
        raise AppError(jobs.QUEUE_DOWN, code="queue_unavailable", status_code=503)
    return run


def _pause_again(db: Session, run_id: uuid.UUID) -> None:
    """The resumed run couldn't be queued: it stays paused, so the user can try again."""
    run = lifecycle.lock(db, run_id)
    if run is None or run.status not in (RunStatus.QUEUED, RunStatus.RUNNING):
        db.rollback()
        return
    run.status, run.pause_kind, run.paused_at = RunStatus.PAUSED, PauseKind.USER, lifecycle.now()
    run.dispatch_token = None
    run.status_message = "Paused: Sentra's background workers couldn't be reached to resume it."
    lifecycle.record(
        db,
        run,
        "campaign.run_paused",
        f"Paused campaign run {lifecycle.code(run, lifecycle.campaign_of(db, run))} again: the "
        "background workers couldn't be reached",
    )
    db.commit()
    lifecycle.publish_status(run)


def stop(db: Session, membership: Membership, code: str, number: int, reason: str) -> CampaignRun:
    """1a and 1b: no further attempt is sent (FR-5.6). An attempt already on its way is still
    recorded and evaluated by its worker, which then finalizes the run."""
    _, run = run_row(db, membership.organization_id, code, number, lock=True)
    if run.status in ENDED:
        raise ConflictError(ENDED_ALREADY, code="run_ended")
    lifecycle.stop(db, run, db.get_one(User, membership.user_id), reason.strip())
    db.commit()
    lifecycle.publish_status(run)
    if lifecycle.lease_free(run):  # no worker holds it: nobody else will finalize it
        lifecycle.finalize(db, run.id)
    return run


# ---------------------------------------------------------------- live events (UC-5.6 step 3)


async def events(run_id: uuid.UUID, after: str | None, ended: bool) -> AsyncIterator[str]:
    """The run's live events as Server-Sent Events, from the one after `after`. The stream closes
    after live_stream_seconds, or with the run's "ended" event; the browser then reconnects with
    the last id it saw (3a1), and its session and membership are checked again (NFR-3.3). A
    monitor that is too far behind gets a "reload" event and loads the run again."""
    deadline = asyncio.get_running_loop().time() + get_settings().live_stream_seconds
    yield "retry: 3000\n\n"
    told = False
    while (left := deadline - asyncio.get_running_loop().time()) > 0:
        batch = await live.follow(run_id, after, int(min(left, 15) * 1000))
        if batch.missed and not told:
            told = True
            yield "event: reload\ndata: {}\n\n"
        for event in batch.events:
            after = event.id
            yield event.sse()
            if event.kind == "ended":
                return
        if not batch.events:
            if ended:
                return
            yield ": waiting\n\n"
