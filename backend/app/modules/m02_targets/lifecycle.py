"""The later life of a target (FR-2.6): archiving one that is no longer tested (UC-2.6) and the
history of what happened to it (UC-2.7). Changing its configuration is service.update().

Archiving keeps everything that was found and stops everything that would send: the campaigns
scheduled against the target are cancelled, its credentials are deleted — so Sentra holds fewer
secrets than it has to (NFR-3.1) — and no campaign can run against it any more. Its history,
findings and reports stay until their retention period ends (FR-10.5). A restored target comes
back unverified and without credentials, so it has to be set up again (UC-2.5, UC-2.3).

The history is assembled, not stored twice: the audit log already holds every change to a target
(FR-10.2) and the campaign runs hold what the testing found. A module that does something to a
target records it in the audit log with the target as its item, and it appears here by itself —
that is how the retests of FR-8.4 and the Shield Policies of FR-8.3 will show up.
"""

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.audit import AuditLogEntry
from app.core.errors import ConflictError, FieldValidationError
from app.modules.m01_users.members import WRONG_PASSWORD
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.security import verify_password
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m02_targets.service import get_target

# The kinds of event the history can be filtered by (Screen 23). "retest" and "shield_policy"
# come with FR-8.4 and FR-8.3, which record them in the audit log like every other module.
REGISTRATION = "registration"
VERIFICATION = "verification"
CONFIGURATION = "configuration"
PROFILE = "profile"
CAMPAIGN_RUN = "campaign_run"
LAB_RESET = "lab_reset"  # a lab target restored to its original state (FR-11.2, UC-11.2)
KINDS = (REGISTRATION, VERIFICATION, CONFIGURATION, PROFILE, CAMPAIGN_RUN, LAB_RESET)
# Which kind an audit action belongs to; anything else about a target is a configuration change.
ACTION_KINDS = {
    "target.registered": REGISTRATION,
    "target.verified": VERIFICATION,
    "target.verification_lost": VERIFICATION,
    "target.profile_saved": PROFILE,
    "target.profile_mapped": PROFILE,
    "target.canary_planted": PROFILE,
    "target.canary_removed": PROFILE,
    "target.lab_deployed": REGISTRATION,
    "target.lab_reset_started": LAB_RESET,
    "target.lab_reset": LAB_RESET,
    "target.retested": "retest",
    "target.policy_deployed": "shield_policy",
    "target.policy_rolled_back": "shield_policy",
}
DEFAULT_PERIOD_DAYS = 180  # "Last 6 months" (Screen 23)
DELETED_DETAILS = "The details of this run were deleted at the end of their retention period."


def now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- archiving (UC-2.6)


def active_run(db: Session, target_id: uuid.UUID):
    """The campaign run of the target that is still going on, if there is one: nothing that sends
    may be changed while it runs (UC-2.5, 3b; UC-2.6, 2a)."""
    from app.modules.m05_campaigns.models import ACTIVE, Campaign, CampaignRun

    run = db.scalar(
        select(CampaignRun)
        .where(CampaignRun.target_id == target_id, CampaignRun.status.in_(ACTIVE))
        .order_by(CampaignRun.created_at)
        .limit(1)
    )
    if run is None:
        return None
    campaign = db.get(Campaign, run.campaign_id) if run.campaign_id else None
    return run, campaign


def running_text(db: Session, target_id: uuid.UUID) -> str:
    """What to say when a run is in the way (UC-2.5, 3b1; UC-2.6, 2a1)."""
    from app.modules.m05_campaigns.lifecycle import code

    found = active_run(db, target_id)
    if found is None:
        return ""
    run, campaign = found
    return (
        f"Campaign run {code(run, campaign)} is running on this target. Stop it or wait until it "
        "ends."
    )


def _schedules(db: Session, target: Target) -> list[dict]:
    """The campaigns that run by themselves against this target (FR-5.3), with who scheduled
    them: archiving the target cancels them (UC-2.6 step 4)."""
    from app.modules.m05_campaigns.models import Campaign, CampaignSchedule, ScheduleStatus
    from app.modules.m05_campaigns.scheduling import summary, zone_of

    rows = db.execute(
        select(CampaignSchedule, Campaign)
        .join(Campaign, Campaign.id == CampaignSchedule.campaign_id)
        .where(
            Campaign.target_id == target.id,
            CampaignSchedule.status.in_((ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED)),
        )
        .order_by(Campaign.number)
    ).all()
    names = _names(db, [schedule.created_by_id for schedule, _ in rows])
    return [
        {
            "id": schedule.id,
            "campaign": campaign.code,
            "name": campaign.name,
            "schedule": summary(schedule, zone_of(campaign)),
            "next_run_at": schedule.next_run_at,
            "created_by": names.get(schedule.created_by_id),
            "created_by_id": schedule.created_by_id,
        }
        for schedule, campaign in rows
    ]


def _names(db: Session, ids: list[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    wanted = {one for one in ids if one}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def consequences(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> dict:
    """UC-2.6 step 2: everything that archiving this target would do, before it is confirmed
    (Screen 24). It changes nothing."""
    from app.modules.m05_campaigns.models import CampaignRun
    from app.modules.m06_findings.models import Finding

    target = get_target(db, organization_id, target_id)
    runs = db.scalar(
        select(func.count()).where(
            CampaignRun.organization_id == organization_id, CampaignRun.target_id == target.id
        )
    )
    findings = db.scalar(
        select(func.count()).where(
            Finding.organization_id == organization_id, Finding.target_id == target.id
        )
    )
    return {
        "target": {"id": target.id, "name": target.name, "status": target.status},
        "running": running_text(db, target.id),  # 2a1: empty when nothing runs
        "schedules": _schedules(db, target),
        "credentials": [credential.name for credential in target.credentials],
        "runs_kept": runs,
        "findings_kept": findings,
    }


def archive(
    db: Session, membership: Membership, target_id: uuid.UUID, password: str
) -> tuple[Target, dict]:
    """UC-2.6 steps 3-5: the user confirms with their password (quality requirement 3, NFR-3.5),
    the scheduled campaigns are cancelled, the credentials are deleted and the target is
    archived. Returns the target and what was done, so the members can be told."""
    from app.modules.m05_campaigns.models import CampaignSchedule, ScheduleStatus

    user = db.get_one(User, membership.user_id)
    if not verify_password(user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    target = get_target(db, membership.organization_id, target_id)
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError(f"{target.name} is already archived.", code="target_archived")
    if blocked := running_text(db, target.id):  # 2a1
        raise ConflictError(blocked, code="run_in_progress")

    cancelled = _schedules(db, target)
    for row in cancelled:
        schedule = db.get(CampaignSchedule, row["id"])
        if schedule is not None:
            schedule.status, schedule.next_run_at = ScheduleStatus.CANCELLED, None
            schedule.last_message = f"{target.name} was archived, so this campaign doesn't run."
    headers = [credential.name for credential in target.credentials]
    target.credentials.clear()  # NFR-3.1: Sentra keeps no secret it doesn't need
    target.status = TargetStatus.ARCHIVED
    target.archived_at, target.archived_by_id = now(), user.id
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="target.archived",
        summary=f"Archived target {target.name}",
        item=audit.Item("target", target.id, target.name),
        details={
            "cancelled_schedules": [row["campaign"] for row in cancelled],
            "deleted_credentials": headers,
        },
    )
    db.commit()
    _tell(db, target, cancelled, user)
    return target, {"schedules": cancelled, "credentials": headers}


def _tell(db: Session, target: Target, cancelled: list[dict], actor: User) -> None:
    """UC-2.6 step 5: whoever scheduled a campaign that no longer runs hears about it (FR-9.3)."""
    from app.modules.m09_reporting.notifications import notify

    for row in cancelled:
        if row["created_by_id"] is None or row["created_by_id"] == actor.id:
            continue
        notify(
            db,
            event="campaign_schedule_problem",
            user_ids=[row["created_by_id"]],
            organization_id=target.organization_id,
            text=(
                f"{actor.name} archived the target {target.name}, so the scheduled campaign "
                f"{row['campaign']} · {row['name']} doesn't run any more."
            ),
            subject=f"{row['campaign']} no longer runs: {target.name} was archived",
            link=f"/campaigns/{row['campaign']}",
        )


def restore(db: Session, membership: Membership, target_id: uuid.UUID) -> Target:
    """UC-2.6, 1a1: the target comes back unverified and without credentials, so its owner enters
    new ones (UC-2.5) and proves ownership again (UC-2.3). Its old ownership token is replaced."""
    target = get_target(db, membership.organization_id, target_id)
    if target.status != TargetStatus.ARCHIVED:
        raise ConflictError(f"{target.name} is not archived.", code="target_not_archived")
    user = db.get_one(User, membership.user_id)
    target.status = TargetStatus.UNVERIFIED
    target.verification_token = secrets.token_hex(16)
    target.verified_at = target.verified_by_id = target.verification_method = None
    target.archived_at = target.archived_by_id = None
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="target.restored",
        summary=f"Restored target {target.name}, which has to be set up and verified again",
        item=audit.Item("target", target.id, target.name),
    )
    db.commit()
    return target


# ---------------------------------------------------------------- the history (UC-2.7)


def history(
    db: Session,
    organization_id: uuid.UUID,
    target_id: uuid.UUID,
    *,
    period_days: int = DEFAULT_PERIOD_DAYS,
    kind: str = "",
) -> dict:
    """UC-2.7 steps 2-4: what happened to the target, newest first, and its risk score over time
    with the open findings by severity after each campaign run. Every member of the organization
    may read it; another organization gets "not found" (NFR-3.3)."""
    from app.modules.m07_risk import scoring

    target = get_target(db, organization_id, target_id)
    since = now() - timedelta(days=period_days)
    events = _audit_events(db, organization_id, target, since, kind)
    runs, has_runs = _run_events(db, organization_id, target, since, kind)
    events.extend(runs)
    events.sort(key=lambda event: event["at"], reverse=True)
    scores = [
        {
            "at": row.calculated_at,
            "score": row.score,
            "band": row.band,
            "trigger": row.trigger,
            "open_by_severity": row.counted_by_severity,
            "open_total": row.counted,
        }
        for row in reversed(scoring.history(db, organization_id, target.id))
        if row.calculated_at >= since
    ]
    return {
        "target": {"id": target.id, "name": target.name, "status": target.status},
        "period_days": period_days,
        "kinds": list(KINDS),
        "has_runs": has_runs,  # 2a1: without a run the page suggests a first campaign
        "events": events,
        "scores": scores,
    }


def _audit_events(
    db: Session, organization_id: uuid.UUID, target: Target, since: datetime, kind: str
) -> list[dict]:
    """Everything the audit log holds about this target (FR-10.2): its registration, the
    verifications, the configuration changes, the profile, and whatever later modules record."""
    rows = db.scalars(
        select(AuditLogEntry)
        .where(
            AuditLogEntry.organization_id == organization_id,
            AuditLogEntry.item_type == "target",
            AuditLogEntry.item_id == str(target.id),
            AuditLogEntry.occurred_at >= since,
        )
        .order_by(AuditLogEntry.occurred_at.desc())
    ).all()
    events = []
    for row in rows:
        of_kind = ACTION_KINDS.get(row.action, CONFIGURATION)
        if kind and of_kind != kind:
            continue
        events.append(
            {
                "at": row.occurred_at,
                "kind": of_kind,
                "action": row.action,
                "summary": row.summary,
                "actor": row.actor_name,
                "by_sentra": row.actor_type != "user",
                "details": row.details or {},
                "run": None,
                "details_deleted": False,
            }
        )
    return events


def _run_events(
    db: Session, organization_id: uuid.UUID, target: Target, since: datetime, kind: str
) -> tuple[list[dict], bool]:
    """The campaign runs of the target (UC-2.7 step 2), each with what it found and whether its
    details are still there (5a1)."""
    from app.modules.m05_campaigns.lifecycle import code
    from app.modules.m05_campaigns.models import Attempt, Campaign, CampaignRun
    from app.modules.m06_findings.models import Finding

    rows = db.execute(
        select(CampaignRun, Campaign)
        .outerjoin(Campaign, Campaign.id == CampaignRun.campaign_id)
        .where(CampaignRun.organization_id == organization_id, CampaignRun.target_id == target.id)
        .order_by(CampaignRun.created_at.desc())
    ).all()
    has_runs = bool(rows)
    if kind and kind != CAMPAIGN_RUN:
        return [], has_runs
    ids = [run.id for run, _ in rows]
    found = dict(
        db.execute(
            select(Finding.first_run_id, func.count())
            .where(Finding.first_run_id.in_(ids))
            .group_by(Finding.first_run_id)
        ).all()
    )
    kept = dict(
        db.execute(
            select(Attempt.campaign_run_id, func.count())
            .where(Attempt.campaign_run_id.in_(ids))
            .group_by(Attempt.campaign_run_id)
        ).all()
    )
    names = _names(db, [run.launched_by_id for run, _ in rows])
    events = []
    for run, campaign in rows:
        at = run.ended_at or run.started_at or run.created_at
        if at < since:
            continue
        new = found.get(run.id, 0)
        deleted = run.attempts_sent > 0 and not kept.get(run.id)
        label = code(run, campaign)
        summary = f"Campaign run {label} {_run_word(run)}"
        if campaign is not None:
            summary += f" · {campaign.name}"
        if new:
            summary += f" · {new} new finding{'' if new == 1 else 's'}"
        if deleted:
            summary += f" · {DELETED_DETAILS}"
        events.append(
            {
                "at": at,
                "kind": CAMPAIGN_RUN,
                "action": f"campaign.run_{run.status}",
                "summary": summary,
                "actor": names.get(run.launched_by_id) or "Sentra",
                "by_sentra": run.launched_by_id is None,
                "details": {
                    "attempts_sent": run.attempts_sent,
                    "new_findings": new,
                    "trigger": run.trigger,
                    "end_reason": run.end_reason,
                },
                "run": {
                    "id": run.id,
                    "code": label,
                    "number": run.number,
                    "campaign": campaign.code if campaign else None,
                },
                "details_deleted": deleted,  # 5a1
            }
        )
    return events, has_runs


def _run_word(run) -> str:
    from app.modules.m05_campaigns.models import RunStatus

    return {
        RunStatus.COMPLETED: "completed",
        RunStatus.STOPPED: "was stopped",
        RunStatus.CANCELLED: "was cancelled",
        RunStatus.PAUSED: "is paused",
        RunStatus.RUNNING: "is running",
        RunStatus.QUEUED: "is waiting for a worker",
    }.get(run.status, run.status)
