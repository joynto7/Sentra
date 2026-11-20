"""Campaign schedules (FR-5.3; UC-5.1 step 5): a campaign may run at a chosen moment or on a
recurring schedule, instead of being launched by hand.

A schedule belongs to its campaign and holds the moment of its next run in UTC. Sentra's own
clock (app/workers/scheduler.py) asks `due()` for the schedules whose moment has come and calls
`fire()` for each of them, which launches the run through UC-5.3 with the permissions of the
member who saved the schedule (UC-5.3, 1a1) and records what came of it.

Nothing here sends anything to a target: a launch only queues the run's start job, exactly as it
does when an analyst presses "Launch".
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError, FieldValidationError, NotFoundError
from app.modules.m01_users.models import Membership, MembershipStatus, User, UserStatus
from app.modules.m01_users.permissions import Action, allowed
from app.modules.m05_campaigns import lifecycle
from app.modules.m05_campaigns.models import (
    Campaign,
    CampaignRun,
    CampaignSchedule,
    RunTrigger,
    ScheduleFrequency,
    ScheduleKind,
    ScheduleResult,
    ScheduleStatus,
)
from app.modules.m05_campaigns.recurrence import MAX_DAY_OF_MONTH, Recurrence
from app.modules.m05_campaigns.window import clock_time

# The builder's third choice (UC-5.1 step 5). It saves no schedule: the campaign's first run is
# launched at once instead (step 7), which is UC-5.3 itself.
IMMEDIATELY = "immediately"
# A moment that passed longer ago than this is not caught up with: Sentra was not running then,
# and starting a campaign hours late would send requests at a time nobody chose.
GRACE = timedelta(hours=6)
# Moments in a row that started no run; after these the schedule pauses itself and says why, so
# a campaign that can never run doesn't keep trying in silence.
MAX_MISSES = 3
LOST_CREATOR = (
    "The member who saved this schedule can no longer launch campaigns in this organization. "
    "Save the schedule again to run it with your own permissions."
)
MISSED_TEXT = "Sentra wasn't running at that moment, so this run was skipped."
RESULT_VERB = {
    ScheduleResult.LAUNCHED: "launched",
    ScheduleResult.SKIPPED: "didn't launch a run",
    ScheduleResult.MISSED: "missed its moment",
}


@dataclass
class ScheduleInput:
    """What the campaign builder sends (Screen 34, step 5)."""

    kind: str = ""
    frequency: str | None = None
    run_at: datetime | None = None  # once: the moment, in UTC or in the campaign's time zone
    at_time: str | None = None  # recurring: a clock time such as "02:00"
    weekday: int | None = None  # weekly: 0 = Monday … 6 = Sunday
    day_of_month: int | None = None  # monthly: 1 to 28


def now() -> datetime:
    return datetime.now(UTC)


def zone_of(campaign: Campaign) -> ZoneInfo:
    return ZoneInfo(campaign.time_zone)


# ---------------------------------------------------------------- reading


def of(db: Session, campaign: Campaign) -> CampaignSchedule | None:
    return db.scalar(select(CampaignSchedule).where(CampaignSchedule.campaign_id == campaign.id))


def recurrence_of(schedule: CampaignSchedule, zone: ZoneInfo) -> Recurrence | None:
    """The recurrence of a recurring schedule; None for one that runs once."""
    if schedule.kind != ScheduleKind.RECURRING or schedule.at_time is None:
        return None
    return Recurrence(
        frequency=schedule.frequency or ScheduleFrequency.DAILY,
        at_time=schedule.at_time,
        zone=zone,
        weekday=schedule.weekday,
        day_of_month=schedule.day_of_month,
    )


def summary(schedule: CampaignSchedule, zone: ZoneInfo) -> str:
    """The schedule in words, for the campaign's page, the audit log and the scope approval
    (UC-5.2 step 2): "Every Monday at 02:00 (Asia/Dhaka)"."""
    recurrence = recurrence_of(schedule, zone)
    if recurrence is not None:
        return recurrence.label()
    if schedule.run_at is None:
        return "No schedule"
    local = schedule.run_at.astimezone(zone)
    return f"Once on {local.day} {local:%B %Y} at {local:%H:%M} ({zone.key})"


def views(db: Session, campaigns: list[Campaign]) -> dict[uuid.UUID, dict]:
    """The schedules of these campaigns, by campaign id: what the campaigns page and a campaign's
    own page show (Screens 33 and 35), in three queries however many campaigns there are."""
    if not campaigns:
        return {}
    by_id = {campaign.id: campaign for campaign in campaigns}
    schedules = list(
        db.scalars(select(CampaignSchedule).where(CampaignSchedule.campaign_id.in_(by_id)))
    )
    numbers = {
        run.id: run.number
        for run in db.scalars(
            select(CampaignRun).where(
                CampaignRun.id.in_({s.last_run_id for s in schedules if s.last_run_id})
            )
        )
    }
    names = dict(
        db.execute(
            select(User.id, User.name).where(
                User.id.in_({s.created_by_id for s in schedules if s.created_by_id})
            )
        ).all()
    )
    result = {}
    for schedule in schedules:
        campaign = by_id[schedule.campaign_id]
        number = numbers.get(schedule.last_run_id)
        result[schedule.campaign_id] = {
            "kind": schedule.kind,
            "frequency": schedule.frequency,
            "run_at": schedule.run_at,
            "at_time": schedule.at_time,
            "weekday": schedule.weekday,
            "day_of_month": schedule.day_of_month,
            "status": schedule.status,
            "summary": summary(schedule, zone_of(campaign)),
            "next_run_at": schedule.next_run_at,
            "last_run_at": schedule.last_run_at,
            "last_result": schedule.last_result,
            "last_message": schedule.last_message,
            "last_run": f"R-{campaign.number:03d}-{number}" if number else None,
            "created_by": names.get(schedule.created_by_id),
        }
    return result


def view(db: Session, campaign: Campaign) -> dict | None:
    return views(db, [campaign]).get(campaign.id)


# ---------------------------------------------------------------- saving (UC-5.1 step 5)


def check(zone: ZoneInfo, data: ScheduleInput) -> dict:
    """The schedule's fields, each problem named as the builder's form shows it. The campaign's
    time zone decides what a clock time means, so a schedule never carries one of its own. It
    takes the zone, not the campaign, so the builder's schedule is checked before the campaign
    is saved: an impossible schedule saves no campaign either (UC-5.1, failed end condition)."""
    kind = (data.kind or "").strip()
    if kind == IMMEDIATELY:
        raise FieldValidationError(
            "schedule_kind",
            "A campaign that runs immediately has no schedule: launch it instead.",
        )
    if kind not in tuple(ScheduleKind):
        raise FieldValidationError("schedule_kind", "Choose when the campaign runs.")
    if kind == ScheduleKind.ONCE:
        if data.run_at is None:
            raise FieldValidationError("schedule_run_at", "Choose the date and time.")
        moment = data.run_at
        if moment.tzinfo is None:  # the time the analyst typed, in the campaign's time zone
            moment = moment.replace(tzinfo=zone)
        if moment <= now():
            raise FieldValidationError("schedule_run_at", "Choose a time in the future.")
        return {"kind": kind, "run_at": moment.astimezone(UTC)}

    frequency = (data.frequency or "").strip()
    if frequency not in tuple(ScheduleFrequency):
        raise FieldValidationError("schedule_frequency", "Choose how often the campaign runs.")
    try:
        at_time = clock_time(data.at_time)
    except ValueError:
        at_time = None
    if at_time is None:
        raise FieldValidationError(
            "schedule_at_time", "Enter the time as hours and minutes, such as 02:00."
        )
    checked: dict = {"kind": kind, "frequency": frequency, "at_time": at_time}
    if frequency == ScheduleFrequency.WEEKLY:
        if data.weekday is None or not 0 <= data.weekday <= 6:
            raise FieldValidationError("schedule_weekday", "Choose the day of the week.")
        checked["weekday"] = data.weekday
    elif frequency == ScheduleFrequency.MONTHLY:
        if data.day_of_month is None or not 1 <= data.day_of_month <= MAX_DAY_OF_MONTH:
            raise FieldValidationError(
                "schedule_day_of_month",
                f"Choose a day from 1 to {MAX_DAY_OF_MONTH}, so it exists in every month.",
            )
        checked["day_of_month"] = data.day_of_month
    return checked


FIELDS = ("kind", "frequency", "run_at", "at_time", "weekday", "day_of_month")


def save(
    db: Session, membership: Membership, campaign: Campaign, data: ScheduleInput
) -> CampaignSchedule:
    """Checks and saves the campaign's schedule (the schedule of Screen 35). The caller commits."""
    return write(db, membership, campaign, check(zone_of(campaign), data))


def write(
    db: Session, membership: Membership, campaign: Campaign, checked: dict
) -> CampaignSchedule:
    """Saves checked fields as the campaign's schedule, replacing the one it had. Whoever saves
    it is the member whose permissions its runs use (UC-5.3, 1a1). The caller commits.

    UC-5.2, 5a1 — changing the schedule of an approved campaign asks for its approval again —
    comes with the scope approval itself (FR-5.2).
    """
    schedule = of(db, campaign)
    if schedule is None:
        schedule = CampaignSchedule(
            organization_id=campaign.organization_id, campaign_id=campaign.id
        )
        db.add(schedule)
    for name in FIELDS:
        setattr(schedule, name, checked.get(name))
    schedule.status = ScheduleStatus.ACTIVE
    schedule.created_by_id = membership.user_id
    schedule.misses = 0
    schedule.next_run_at = _first_moment(schedule, zone_of(campaign))
    _record(
        db,
        campaign,
        schedule,
        "campaign.schedule_saved",
        f"Scheduled {_label(campaign)}: {summary(schedule, zone_of(campaign))}",
        membership=membership,
    )
    return schedule


def pause(db: Session, membership: Membership, campaign: Campaign) -> CampaignSchedule:
    """The schedule stays but starts no run until it is resumed. A run that is already in
    progress is not touched; pausing a run is UC-5.7."""
    schedule = of(db, campaign)
    if schedule is None or schedule.status != ScheduleStatus.ACTIVE:
        raise ConflictError("This campaign has no active schedule.", code="no_active_schedule")
    schedule.status, schedule.next_run_at = ScheduleStatus.PAUSED, None
    _record(
        db,
        campaign,
        schedule,
        "campaign.schedule_paused",
        f"Paused the schedule of {_label(campaign)}",
        membership=membership,
    )
    return schedule


def resume(db: Session, membership: Membership, campaign: Campaign) -> CampaignSchedule:
    """The schedule runs again, from its next moment. Whoever resumes it becomes the member whose
    permissions its runs use, so a schedule that stopped for that reason works again (1a1)."""
    schedule = _row(db, campaign)
    if schedule.status == ScheduleStatus.ACTIVE:
        raise ConflictError("This schedule is already active.", code="schedule_active")
    moment = _first_moment(schedule, zone_of(campaign))
    if moment is None or moment <= now():  # a one-off whose moment has passed
        raise ConflictError(
            "This campaign was scheduled for one moment, which has passed. Choose a new time.",
            code="schedule_finished",
        )
    schedule.status, schedule.next_run_at, schedule.misses = ScheduleStatus.ACTIVE, moment, 0
    schedule.created_by_id = membership.user_id
    _record(
        db,
        campaign,
        schedule,
        "campaign.schedule_resumed",
        f"Resumed the schedule of {_label(campaign)}: {summary(schedule, zone_of(campaign))}",
        membership=membership,
    )
    return schedule


def remove(db: Session, membership: Membership, campaign: Campaign) -> None:
    """The campaign keeps its settings and its runs; only the schedule goes."""
    schedule = _row(db, campaign)
    _record(
        db,
        campaign,
        schedule,
        "campaign.schedule_removed",
        f"Removed the schedule of {_label(campaign)}",
        membership=membership,
    )
    db.delete(schedule)


def _row(db: Session, campaign: Campaign) -> CampaignSchedule:
    schedule = of(db, campaign)
    if schedule is None:
        raise NotFoundError("This campaign has no schedule.")
    return schedule


def _first_moment(schedule: CampaignSchedule, zone: ZoneInfo) -> datetime | None:
    recurrence = recurrence_of(schedule, zone)
    return recurrence.next_after(now()) if recurrence is not None else schedule.run_at


def _label(campaign: Campaign) -> str:
    return f"{campaign.code} · {campaign.name}"


def _record(
    db: Session,
    campaign: Campaign,
    schedule: CampaignSchedule,
    action: str,
    text: str,
    *,
    membership: Membership | None = None,
    details: dict | None = None,
) -> None:
    """One entry in the audit log for every change of a schedule and every moment the scheduler
    acted on (FR-10.2). Without a member the action is Sentra's own. The caller commits."""
    user = db.get(User, membership.user_id) if membership is not None else None
    audit.record(
        db,
        organization_id=campaign.organization_id,
        actor=user,
        action=action,
        summary=text,
        item=audit.Item("campaign", campaign.id, _label(campaign)),
        details={
            "campaign": campaign.code,
            "schedule": summary(schedule, zone_of(campaign)),
            "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
            "status": schedule.status,
            **(details or {}),
        },
        **({} if user is not None else {"source_address": None}),
    )


# ---------------------------------------------------------------- the moments (UC-5.3, 1a)


def due(db: Session, at: datetime) -> list[uuid.UUID]:
    """The schedules whose moment has come, the longest waiting first."""
    return list(
        db.scalars(
            select(CampaignSchedule.id)
            .where(
                CampaignSchedule.status == ScheduleStatus.ACTIVE,
                CampaignSchedule.next_run_at.is_not(None),
                CampaignSchedule.next_run_at <= at,
            )
            .order_by(CampaignSchedule.next_run_at)
        )
    )


def fire(db: Session, schedule_id: uuid.UUID, at: datetime) -> str:
    """One schedule whose moment has come (UC-5.3, 1a1). The moment is claimed and committed
    first, so no second tick can use it, and the run is then launched with the permissions of the
    member who saved the schedule. Returns what came of it, or "" if another tick had it."""
    schedule = db.scalar(
        select(CampaignSchedule)
        .where(CampaignSchedule.id == schedule_id)
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    )
    if (
        schedule is None
        or schedule.status != ScheduleStatus.ACTIVE
        or schedule.next_run_at is None
        or schedule.next_run_at > at
    ):
        db.rollback()
        return ""
    campaign = db.get_one(Campaign, schedule.campaign_id)
    moment = schedule.next_run_at
    _claim(db, schedule, campaign, at)
    db.commit()

    if at - moment > GRACE:  # Sentra was not running at the moment itself
        return _result(db, schedule, campaign, ScheduleResult.MISSED, MISSED_TEXT, tell=False)
    membership = _creator(db, schedule)
    if membership is None:  # they left the organization, or lost the permission (FR-1.6)
        return _result(db, schedule, campaign, ScheduleResult.SKIPPED, LOST_CREATOR)
    from app.modules.m05_campaigns import runs  # the launch itself is UC-5.3

    try:
        run = runs.launch(db, membership, campaign.code, RunTrigger.SCHEDULE)
    except AppError as exc:  # 3a and 4a: a limit, the approval, a run still in progress
        return _result(db, schedule, campaign, ScheduleResult.SKIPPED, exc.message)
    return _result(
        db,
        schedule,
        campaign,
        ScheduleResult.LAUNCHED,
        f"Launched {lifecycle.code(run, campaign)}.",
        run=run,
        tell=False,
    )


def _claim(db: Session, schedule: CampaignSchedule, campaign: Campaign, at: datetime) -> None:
    """The moment is used up before anything is launched: the next one is set, and a schedule
    that runs once is finished. A run that then doesn't start is recorded, not tried again at
    once; `misses` and the schedule's own message say what happened."""
    recurrence = recurrence_of(schedule, zone_of(campaign))
    schedule.last_run_at = at
    if recurrence is None:
        schedule.status, schedule.next_run_at = ScheduleStatus.FINISHED, None
    else:
        schedule.next_run_at = recurrence.next_after(at)


def _result(
    db: Session,
    schedule: CampaignSchedule,
    campaign: Campaign,
    result: str,
    message: str,
    *,
    run: CampaignRun | None = None,
    tell: bool = True,
) -> str:
    """What came of the moment, kept with the schedule for its page and the audit log, and told
    to the member whose schedule it is when no run started (UC-5.3, 3a1 and 4a1). A moment that
    Sentra itself was not running for is only recorded: nobody can act on it."""
    schedule.last_result, schedule.last_message = result, message
    schedule.last_run_id = run.id if run is not None else None
    schedule.misses = 0 if result == ScheduleResult.LAUNCHED else schedule.misses + 1
    paused = result == ScheduleResult.SKIPPED and schedule.misses >= MAX_MISSES
    if paused:
        schedule.status, schedule.next_run_at = ScheduleStatus.PAUSED, None
    _record(
        db,
        campaign,
        schedule,
        f"campaign.schedule_{result}",
        f"The schedule of {_label(campaign)} {RESULT_VERB[result]}: {message}",
        details={"result": result, "paused": paused},
    )
    db.commit()
    if tell:
        _tell(db, schedule, campaign, message, paused)
    return result


def _tell(
    db: Session, schedule: CampaignSchedule, campaign: Campaign, message: str, paused: bool
) -> None:
    """UC-5.3, 3a1 and 4a1: whoever scheduled the campaign hears that its run didn't start. A
    usage limit also reaches the organization's administrators, from the launch itself. One
    schedule that keeps failing stays one notification, kept up to date (FR-9.3, 1a)."""
    from app.modules.m09_reporting.notifications import notify

    if schedule.created_by_id is None:
        return
    text = f"The scheduled run of {_label(campaign)} didn't start. {message}"
    if paused:
        text += " The schedule is paused until you start it again."
    notify(
        db,
        event="campaign_schedule_problem",
        user_ids=[schedule.created_by_id],
        organization_id=campaign.organization_id,
        text=text,
        combined_text=f"{text} This has happened {{count}} times.",
        subject=f"The scheduled run of {campaign.code} didn't start",
        link=f"/campaigns/{campaign.code}",
        group_key=f"campaign_schedule:{schedule.id}",
    )


def _creator(db: Session, schedule: CampaignSchedule) -> Membership | None:
    """Whose permissions the run uses (UC-5.3, 1a1): the member who saved the schedule, if they
    are still an active member of the organization and may still launch campaigns (FR-1.6)."""
    if schedule.created_by_id is None:
        return None
    membership = db.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.user_id == schedule.created_by_id,
            Membership.organization_id == schedule.organization_id,
            Membership.status == MembershipStatus.ACTIVE,
            User.status == UserStatus.ACTIVE,
        )
    )
    if membership is None or not allowed(membership.role, Action.MANAGE_CAMPAIGNS):
        return None
    return membership
