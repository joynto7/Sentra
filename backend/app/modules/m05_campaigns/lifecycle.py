"""The lifecycle of a campaign run (report 2.3.2; UC-5.4, UC-5.7): every change of a run's status
goes through here, whether it comes from the API (pause, resume, stop) or from a worker.

A change locks the run's row first (SELECT … FOR UPDATE) and looks at the status it finds there,
so the API and a worker that meet at the same moment can't undo each other: a stop always wins.

Two fields decide who works on a run (NFR-2.2):
- the dispatch token: every queued job of a run carries the token that was current when it was
  queued. Pausing, stopping and queuing a new job change the token, so an older job that still
  waits in the queue does nothing when its time comes.
- the lease: the worker that works on a run holds it and renews it before every attempt. While it
  is held, no other worker touches the run; when the worker disappears, the lease runs out and
  another worker takes the run over (recover()).
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.llm.usage import cost_of_run
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m05_campaigns.models import (
    ACTIVE,
    ENDED,
    Attempt,
    AttemptStatus,
    Campaign,
    CampaignRun,
    EndReason,
    PauseKind,
    RunStatus,
)
from app.workers import jobs
from app.workers.orchestrator import hooks, live

JOB = "campaigns.advance_run"
LEASE_MARGIN_SECONDS = 30  # on top of the connector's time limit for one attempt
# A queued job waits at most this long; a longer wait is made of several. It stays well below the
# broker's visibility timeout (celery_app.py), after which a job that no worker finished is
# handed out again.
MAX_COUNTDOWN_SECONDS = 300
INTERRUPTED_TEXT = "The worker stopped while this attempt was on its way, so its reply was lost."

END_TEXT = {
    EndReason.TESTS_FINISHED: "All planned attempts were sent.",
    EndReason.BUDGET_USED: "The attempt budget is used up.",
    EndReason.TIME_WINDOW_ENDED: "The time window ended.",
    EndReason.NOTHING_TO_RUN: "No test could run against this target. The summary says why.",
}


def now() -> datetime:
    return datetime.now(UTC)


def lease_seconds() -> int:
    return get_settings().connector_timeout_seconds + LEASE_MARGIN_SECONDS


def lock(db: Session, run_id: uuid.UUID, *, skip_locked: bool = False) -> CampaignRun | None:
    """The run's row, locked until the caller commits, with what the database holds now."""
    return db.scalar(
        select(CampaignRun)
        .where(CampaignRun.id == run_id)
        .with_for_update(skip_locked=skip_locked)
        .execution_options(populate_existing=True)
    )


def lease_free(run: CampaignRun, at: datetime | None = None) -> bool:
    return run.lease_until is None or run.lease_until <= (at or now())


def code(run: CampaignRun, campaign: Campaign | None) -> str:
    """R-238-2: the second run of campaign C-238."""
    return f"R-{campaign.number:03d}-{run.number}" if campaign else f"R-{str(run.id)[:8]}"


def campaign_of(db: Session, run: CampaignRun) -> Campaign | None:
    return db.get(Campaign, run.campaign_id) if run.campaign_id else None


def status_data(run: CampaignRun) -> dict:
    return {
        "status": run.status,
        "status_message": run.status_message,
        "end_reason": run.end_reason,
        "attempts_planned": run.attempts_planned,
        "attempts_sent": run.attempts_sent,
        "attempt_budget": run.attempt_budget,
        "wake_at": run.wake_at,
    }


def publish_status(run: CampaignRun) -> None:
    live.publish(run.id, "status", status_data(run))


def record(
    db: Session,
    run: CampaignRun,
    action: str,
    summary: str,
    *,
    actor: User | None = None,
    details: dict | None = None,
) -> None:
    """An entry in the audit log (FR-10.2): the launch, pause, resume and stop of every run
    (architecture 2.5.4). Without an actor the action is Sentra's own, e.g. an automatic stop.
    The caller commits."""
    campaign = campaign_of(db, run)
    label = code(run, campaign) + (f" · {campaign.name}" if campaign else "")
    audit.record(
        db,
        organization_id=run.organization_id,
        actor=actor,
        action=action,
        summary=summary,
        item=audit.Item("campaign_run", run.id, label),
        details={"run": code(run, campaign), **(details or {})},
        **({} if actor is not None else {"source_address": None}),
    )


# ---------------------------------------------------------------- jobs


def dispatch(db: Session, run: CampaignRun, countdown: float | None = None) -> bool:
    """Queues the run's next job with a new token, which makes every older job stale. Commits.
    Returns False when the queue can't be reached."""
    run.dispatch_token, run.dispatched_at = uuid.uuid4(), now()
    token = run.dispatch_token
    db.commit()
    if countdown is not None:
        countdown = min(max(countdown, 0.0), MAX_COUNTDOWN_SECONDS) or None
    return jobs.start(db, JOB, run.id, token, countdown=countdown)


def cancel_unqueued(db: Session, run_id: uuid.UUID) -> None:
    """The start job couldn't be queued (UC-5.3, failed end): the run ends at once, unseen by
    any worker, and the user gets the reason."""
    run = lock(db, run_id)
    if run is None or run.status not in ACTIVE:
        db.rollback()
        return
    end(db, run, RunStatus.CANCELLED, EndReason.QUEUE_UNAVAILABLE, jobs.QUEUE_DOWN)
    run.finalized_at = now()
    db.commit()
    publish_status(run)


# ---------------------------------------------------------------- ending


def end(
    db: Session, run: CampaignRun, status: RunStatus, reason: str, message: str, *, by=None
) -> None:
    """Ends a locked, active run. The caller commits, then calls finalize() once no worker holds
    the run any more: the worker itself, or the API when no worker was working on it."""
    assert run.status in ACTIVE and status in ENDED
    run.status, run.end_reason, run.status_message = status, reason, message
    run.ended_at, run.ended_by_id = now(), by.id if by is not None else None
    run.wake_at = run.dispatch_token = None
    run.pause_kind = None


def finalize(db: Session, run_id: uuid.UUID) -> None:
    """UC-5.4 step 7, exactly once per run: the attempts it didn't send are marked, the run's cost
    is fixed, the extensions' on_run_end runs (e.g. the target's risk score, FR-7.2), and the
    people who launched or created the campaign are told how it ended."""
    run = lock(db, run_id)
    if (
        run is None
        or run.status not in ENDED
        or run.finalized_at is not None
        or not lease_free(run)  # a worker still works on it: it finalizes when it lets go
    ):
        db.rollback()
        return
    run.finalized_at = now()
    run.lease_owner = run.lease_until = None
    db.execute(
        update(Attempt)
        .where(Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.PLANNED)
        .values(status=AttemptStatus.NOT_SENT)
    )
    db.execute(  # a worker that disappeared during its last attempt (NFR-2.2)
        update(Attempt)
        .where(Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.SENDING)
        .values(status=AttemptStatus.INTERRUPTED, finished_at=now(), error_message=INTERRUPTED_TEXT)
    )
    run.cost_usd = cost_of_run(db, run.id)
    db.commit()

    problems = hooks.on_run_end(db, run)
    if problems:
        run.hook_errors = problems
        db.commit()
    publish_status(run)
    live.publish(run.id, "ended", {**status_data(run), "summary": summary(db, run)})
    live.expire(run.id)
    _notify_end(db, run)


def summary(db: Session, run: CampaignRun) -> dict:
    """UC-5.6 step 5: the attempts by status, the tests that were skipped and why, and the cost.
    The findings by severity come from Module 6."""
    rows = db.execute(
        select(Attempt.status, func.count())
        .where(Attempt.campaign_run_id == run.id)
        .group_by(Attempt.status)
    ).all()
    counts = {status.value: 0 for status in AttemptStatus}
    counts.update({status: number for status, number in rows})
    skipped = [
        {"code": t["code"], "name": t.get("name", ""), "reason": t.get("reason", "")}
        for t in (run.plan or {}).get("tests", [])
        if t.get("status") == "skipped"
    ]
    return {"attempts": counts, "skipped_tests": skipped, "cost_usd": run.cost_usd}


def _notify_end(db: Session, run: CampaignRun) -> None:
    """UC-5.4 step 7 and 1a1, UC-5.7 1b1: who launched the run and who created the campaign learn
    how it ended, unless they ended it themselves."""
    from app.modules.m02_targets.models import Target
    from app.modules.m09_reporting.notifications import notify

    campaign = campaign_of(db, run)
    people = [p for p in (run.launched_by_id, campaign.created_by_id if campaign else None) if p]
    people = [p for p in dict.fromkeys(people) if p != run.ended_by_id]
    if not people:
        return
    target = db.get(Target, run.target_id)
    name = f"{code(run, campaign)} of {campaign.name}" if campaign else code(run, campaign)
    verb = {
        RunStatus.COMPLETED: "finished",
        RunStatus.STOPPED: "was stopped",
        RunStatus.CANCELLED: "was cancelled",
    }[RunStatus(run.status)]
    notify(
        db,
        event="campaign_run_completed",
        user_ids=people,
        organization_id=run.organization_id,
        text=f"Campaign run {name} against {target.name} {verb}. {run.status_message}",
        subject=f"Campaign run {code(run, campaign)} {verb}",
        link=f"/campaigns/{campaign.code}/runs/{run.number}" if campaign else None,
    )


def notify_limit(db: Session, organization_id: uuid.UUID, sentence: str) -> None:
    """UC-5.3, 3a1 and UC-10.6 step 6: a monthly limit stopped work; the Organization
    Administrators are told, once an hour at most (FR-9.3, 1a)."""
    from app.modules.m09_reporting.notifications import notify

    admins = db.scalars(
        select(Membership.user_id).where(
            Membership.organization_id == organization_id,
            Membership.role == Role.ORG_ADMIN,
            Membership.status == MembershipStatus.ACTIVE,
        )
    ).all()
    if admins:
        notify(
            db,
            event="usage_limit_warning",
            user_ids=list(admins),
            organization_id=organization_id,
            text=sentence,
            subject="A monthly usage limit is reached",
            link="/campaigns",
            group_key=f"usage_limit:{organization_id}",
        )


# ---------------------------------------------------------------- the controls of UC-5.7


def pause(db: Session, run: CampaignRun, user: User) -> None:
    """UC-5.7 steps 1-3: the run pauses before its next attempt; an attempt already on its way is
    still recorded and evaluated (quality requirement 3). `run` is locked; the caller commits."""
    run.status, run.pause_kind = RunStatus.PAUSED, PauseKind.USER
    run.paused_at, run.paused_by_id = now(), user.id
    run.status_message = f"Paused by {user.name}."
    run.wake_at = run.dispatch_token = None
    record(db, run, "campaign.run_paused", f"Paused campaign run {_label(db, run)}", actor=user)


def resume(db: Session, run: CampaignRun, user: User) -> bool:
    """UC-5.7 step 4 and 4a. Returns False when the run's time window ended while it was paused:
    then the run is ended instead (the caller commits and finalizes)."""
    if run.window_ends_at is not None and run.window_ends_at <= now():
        end(
            db,
            run,
            RunStatus.COMPLETED,
            EndReason.TIME_WINDOW_ENDED,
            "The time window ended while the run was paused, so it ended instead of resuming.",
        )
        record(
            db,
            run,
            "campaign.run_resumed",
            f"Resumed campaign run {_label(db, run)}, which ended because its time window was over",
            actor=user,
        )
        return False
    run.status = RunStatus.RUNNING if run.started_at else RunStatus.QUEUED
    run.pause_kind = run.paused_at = run.paused_by_id = run.wake_at = None
    run.retries = 0
    run.status_message = f"Resumed by {user.name}."
    record(db, run, "campaign.run_resumed", f"Resumed campaign run {_label(db, run)}", actor=user)
    return True


def stop(db: Session, run: CampaignRun, user: User, reason: str = "") -> None:
    """UC-5.7 1a/1b: no further attempt is sent (FR-5.6). `run` is locked; the caller commits."""
    text = f"Stopped by {user.name}" + (f": {reason}" if reason else ".")
    end(db, run, RunStatus.STOPPED, EndReason.STOPPED_BY_USER, text, by=user)
    record(
        db,
        run,
        "campaign.run_stopped",
        f"Stopped campaign run {_label(db, run)}",
        actor=user,
        details={"reason": reason} if reason else None,
    )


def _label(db: Session, run: CampaignRun) -> str:
    return code(run, campaign_of(db, run))


def active_run(db: Session, campaign_id: uuid.UUID) -> CampaignRun | None:
    return db.scalar(
        select(CampaignRun).where(
            CampaignRun.campaign_id == campaign_id, CampaignRun.status.in_(ACTIVE)
        )
    )


# ---------------------------------------------------------------- after a worker failure


def recover(db: Session) -> int:
    """When a worker starts (NFR-2.2): every active run that no worker holds gets a new job, and a
    run that ended without being finalized is finalized. Returns how many runs were picked up."""
    picked = 0
    waiting = db.scalars(select(CampaignRun.id).where(CampaignRun.finalized_at.is_(None))).all()
    db.rollback()
    for run_id in waiting:
        run = lock(db, run_id, skip_locked=True)  # skip a run that is being changed right now
        at = now()
        if run is None or not lease_free(run, at):
            db.rollback()
            continue
        if run.status in ENDED:
            db.commit()
            finalize(db, run.id)
            picked += 1
            continue
        if run.status == RunStatus.PAUSED and run.pause_kind != PauseKind.AUTOMATIC:
            db.rollback()  # paused by a person: it waits for "Resume"
            continue
        wait = (run.wake_at - at).total_seconds() if run.wake_at else 0
        dispatch(db, run, countdown=wait if wait > 0 else None)
        picked += 1
    return picked


def window_left(run: CampaignRun) -> timedelta | None:
    return run.window_ends_at - now() if run.window_ends_at else None
