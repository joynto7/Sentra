"""Tests for FR-5.3 (M5) Campaign Scheduling: UC-5.1 step 5 (when the campaign runs) and
UC-5.3, 1a (Sentra launches it at that moment, with the permissions of its creator).

Nothing is sent to a target: the send loop is the stub sender of conftest.py, and the moment of
every tick is given to the scheduler, so no test waits for a clock.
"""

from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m01_users.models import Role
from app.modules.m02_targets.models import TargetStatus
from app.modules.m05_campaigns import scheduling
from app.modules.m05_campaigns.models import CampaignRun, CampaignSchedule, ScheduleStatus
from app.modules.m05_campaigns.recurrence import Recurrence
from app.workers import extensions, scheduler
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import membership_of, organization_with
from tests.m05_campaigns.conftest import CAMPAIGNS
from tests.m05_campaigns.test_campaigns import add_target, campaign, details
from tests.m05_campaigns.test_runs import notifications

PROBLEM = "campaign_schedule_problem"
DAY_OF_MONTH = "Choose a day from 1 to 28, so it exists in every month."
NO_SCHEDULE = "A campaign that runs immediately has no schedule: launch it instead."


def url(code: str = "C-001", path: str = "") -> str:
    return f"{CAMPAIGNS}/{code}/schedule{path}"


def weekly(**changes) -> dict:
    """Every Monday at 02:00, as the campaign builder sends it (Screen 34, step 5)."""
    return {"kind": "recurring", "frequency": "weekly", "weekday": 0, "at_time": "02:00"} | changes


def once(hours: int = 2, **changes) -> dict:
    moment = datetime.now(UTC) + timedelta(hours=hours)
    return {"kind": "once", "run_at": moment.isoformat()} | changes


def row(db) -> CampaignSchedule:
    return db.scalar(select(CampaignSchedule))


def runs_of(db) -> int:
    return db.scalar(select(func.count()).select_from(CampaignRun))


def schedule_actions(db) -> list[str]:
    return list(
        db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.action.like("campaign.schedule_%"))
            .order_by(AuditLogEntry.seq)
        )
    )


# ---------------------------------------------------------------- when the next run falls


def test_the_next_moment_of_every_frequency():
    dhaka = ZoneInfo("Asia/Dhaka")
    monday_afternoon = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # 15:00 on Monday in Dhaka

    def next_local(recurrence: Recurrence) -> str:
        moment = recurrence.next_after(monday_afternoon)
        return moment.astimezone(dhaka).strftime("%Y-%m-%d %H:%M")

    # 02:00 has passed today, so each one waits for its next day
    assert next_local(Recurrence("daily", time(2, 0), dhaka)) == "2026-11-03 02:00"
    assert next_local(Recurrence("weekly", time(2, 0), dhaka, weekday=0)) == "2026-11-09 02:00"
    monthly = Recurrence("monthly", time(2, 0), dhaka, day_of_month=1)
    assert next_local(monthly) == "2026-12-01 02:00"
    assert next_local(Recurrence("daily", time(23, 30), dhaka)) == "2026-11-02 23:30"


def test_a_day_of_the_month_exists_in_every_month():
    dhaka = ZoneInfo("Asia/Dhaka")
    monthly = Recurrence("monthly", time(2, 0), dhaka, day_of_month=28)
    after_january = monthly.next_after(datetime(2026, 1, 31, tzinfo=UTC))

    assert after_january.astimezone(dhaka).strftime("%Y-%m-%d %H:%M") == "2026-02-28 02:00"


def test_a_schedule_keeps_its_clock_time_through_a_time_change():
    berlin = ZoneInfo("Europe/Berlin")
    nightly = Recurrence("daily", time(2, 30), berlin)

    # Summer time ends on 25 October 2026, and 02:30 still means 02:30
    ends = nightly.next_after(datetime(2026, 10, 24, 12, 0, tzinfo=UTC))
    assert ends.astimezone(berlin).strftime("%Y-%m-%d %H:%M") == "2026-10-25 02:30"
    # 28 March 2027 has no 02:30 in Berlin: the run starts at the same instant as 01:30 would
    # have, which the clock calls 03:30 (recurrence.py).
    gap = nightly.next_after(datetime(2027, 3, 27, 12, 0, tzinfo=UTC))
    assert gap.astimezone(berlin).strftime("%Y-%m-%d %H:%M") == "2027-03-28 03:30"


# ---------------------------------------------------------------- saving it (UC-5.1 step 5)


@pytest.fixture
def arif(client, db):
    """Arif, a Security Analyst of Halcyon Bank, is logged in and has saved campaign C-001 in
    Asia/Dhaka. Maya, an AI Application Developer, is a member as well."""
    from app.modules.m04_tests.library import sync_built_in_library
    from app.modules.m04_tests.suites import sync_built_in_suites

    sync_built_in_library(db)
    sync_built_in_suites(db)
    org = organization_with(
        db,
        client,
        {"arif@example.com": Role.SECURITY_ANALYST, "maya@example.com": Role.TARGET_OWNER},
    )
    agent = add_target(db, org)
    log_in(client, "arif@example.com")
    created = client.post(CAMPAIGNS, json=campaign(agent.id, time_zone="Asia/Dhaka"))
    assert created.status_code == 201
    return SimpleNamespace(client=client, db=db, org=org, agent=agent)


def test_an_analyst_schedules_a_campaign_weekly(arif):
    response = arif.client.put(url(), json=weekly())

    body = response.json()
    assert response.status_code == 200
    assert body["summary"] == "Every Monday at 02:00 (Asia/Dhaka)"
    assert (body["kind"], body["frequency"], body["status"]) == ("recurring", "weekly", "active")
    assert body["created_by"] == "Arif"
    assert datetime.fromisoformat(body["next_run_at"]) > datetime.now(UTC)
    assert body["last_result"] is None
    assert schedule_actions(arif.db) == ["campaign.schedule_saved"]


def test_a_moment_without_an_offset_is_read_in_the_campaigns_time_zone(arif):
    response = arif.client.put(url(), json={"kind": "once", "run_at": "2027-01-01T02:00:00"})

    body = response.json()
    assert response.status_code == 200
    # 02:00 in Asia/Dhaka (UTC+6) is 20:00 UTC the evening before
    assert datetime.fromisoformat(body["run_at"]) == datetime(2026, 12, 31, 20, 0, tzinfo=UTC)
    assert body["summary"] == "Once on 1 January 2027 at 02:00 (Asia/Dhaka)"


def test_a_schedule_is_replaced_and_read_back(arif):
    arif.client.put(url(), json=weekly())

    response = arif.client.put(url(), json=weekly(frequency="monthly", day_of_month=1))

    assert response.status_code == 200
    assert response.json()["summary"] == "On day 1 of each month at 02:00 (Asia/Dhaka)"
    assert arif.client.get(url()).json()["frequency"] == "monthly"
    assert arif.db.scalar(select(func.count()).select_from(CampaignSchedule)) == 1


def test_the_campaign_pages_show_the_schedule(arif):
    arif.client.put(url(), json=weekly())

    listed = arif.client.get(CAMPAIGNS).json()
    detail = arif.client.get(f"{CAMPAIGNS}/C-001").json()

    assert listed[0]["schedule"]["summary"] == "Every Monday at 02:00 (Asia/Dhaka)"
    assert detail["schedule"]["next_run_at"] == listed[0]["schedule"]["next_run_at"]


def test_a_campaign_without_a_schedule_says_so(arif):
    assert arif.client.get(url()).json() is None
    assert arif.client.get(f"{CAMPAIGNS}/C-001").json()["schedule"] is None


@pytest.mark.parametrize(
    ("body", "problem"),
    [
        (weekly(weekday=None), {"schedule_weekday": "Choose the day of the week."}),
        (weekly(frequency="monthly", day_of_month=None), {"schedule_day_of_month": DAY_OF_MONTH}),
        (
            weekly(at_time="24:30"),
            {"schedule_at_time": "Enter the time as hours and minutes, such as 02:00."},
        ),
        (
            {"kind": "once", "run_at": "2020-01-01T02:00:00Z"},
            {"schedule_run_at": "Choose a time in the future."},
        ),
        ({"kind": "immediately"}, {"schedule_kind": NO_SCHEDULE}),
    ],
)
def test_a_schedule_that_cannot_work_is_refused(arif, body, problem):
    response = arif.client.put(url(), json=body)

    assert response.status_code == 422
    assert details(response) == problem
    assert row(arif.db) is None


def test_a_campaign_is_saved_with_its_schedule_or_not_at_all(arif):
    refused = arif.client.post(
        CAMPAIGNS, json=campaign(arif.agent.id, schedule=weekly(weekday=None))
    )

    assert refused.status_code == 422
    assert details(refused) == {"schedule_weekday": "Choose the day of the week."}
    assert [one["code"] for one in arif.client.get(CAMPAIGNS).json()] == ["C-001"]

    saved = arif.client.post(CAMPAIGNS, json=campaign(arif.agent.id, schedule=weekly()))

    assert saved.status_code == 201
    assert saved.json()["schedule"]["summary"] == "Every Monday at 02:00 (Asia/Dhaka)"
    assert saved.json()["launched_run"] is None


def test_only_an_analyst_may_change_the_schedule(arif):
    arif.client.put(url(), json=weekly())
    log_in(arif.client, "maya@example.com")

    refused = arif.client.put(url(), json=weekly(weekday=3))
    readable = arif.client.get(url())

    assert refused.status_code == 403
    assert readable.status_code == 200  # every member may see when a campaign runs


def test_a_schedule_is_paused_and_resumed(arif):
    arif.client.put(url(), json=weekly())

    paused = arif.client.post(url(path="/pause"))

    assert paused.status_code == 200
    assert (paused.json()["status"], paused.json()["next_run_at"]) == ("paused", None)
    assert arif.client.post(url(path="/pause")).status_code == 409

    resumed = arif.client.post(url(path="/resume"))

    assert resumed.json()["status"] == "active"
    assert datetime.fromisoformat(resumed.json()["next_run_at"]) > datetime.now(UTC)
    assert schedule_actions(arif.db) == [
        "campaign.schedule_saved",
        "campaign.schedule_paused",
        "campaign.schedule_resumed",
    ]


def test_a_one_off_schedule_cannot_be_resumed_after_its_moment(arif):
    arif.client.put(url(), json=once())
    arif.client.post(url(path="/pause"))
    schedule = row(arif.db)
    schedule.run_at = datetime.now(UTC) - timedelta(days=1)
    arif.db.commit()

    refused = arif.client.post(url(path="/resume"))

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "schedule_finished"


def test_removing_the_schedule_keeps_the_campaign(arif):
    arif.client.put(url(), json=weekly())

    removed = arif.client.delete(url())

    assert removed.status_code == 204
    assert row(arif.db) is None
    assert arif.client.get(f"{CAMPAIGNS}/C-001").status_code == 200
    assert arif.client.delete(url()).status_code == 404


# ---------------------------------------------------------------- the moment comes (UC-5.3, 1a)


def due_now(team, **changes) -> datetime:
    """C-001 is scheduled, and its moment has just come."""
    assert team.client.put(url(), json=weekly(**changes)).status_code == 200
    moment = datetime.now(UTC)
    row(team.db).next_run_at = moment
    team.db.commit()
    return moment


def test_the_tick_launches_a_due_campaign_as_its_creator(team, use):
    use()
    moment = due_now(team)

    scheduler.tick(team.db, moment.isoformat())

    run = team.db.scalar(select(CampaignRun))
    schedule = row(team.db)
    assert (run.trigger, run.number) == ("schedule", 1)
    # UC-5.3, 1a1: the run belongs to the member whose schedule it is, not to Sentra
    assert run.launched_by_id == membership_of(team.db, "arif@example.com").user_id
    assert (schedule.last_result, schedule.last_run_id) == ("launched", run.id)
    assert schedule.last_message == "Launched R-001-1."
    assert schedule.next_run_at > moment  # the next Monday
    assert schedule.status == ScheduleStatus.ACTIVE
    assert schedule_actions(team.db)[-1] == "campaign.schedule_launched"
    assert notifications(team.db, "arif@example.com", PROBLEM) == []


def test_a_campaign_scheduled_once_has_its_moment_only_once(team, use):
    use()
    assert team.client.put(url(), json=once()).status_code == 200
    moment = datetime.now(UTC)
    row(team.db).next_run_at = moment
    team.db.commit()

    scheduler.tick(team.db, moment.isoformat())

    schedule = row(team.db)
    assert (schedule.status, schedule.next_run_at) == (ScheduleStatus.FINISHED, None)
    assert schedule.last_result == "launched"
    assert runs_of(team.db) == 1


def test_a_moment_is_used_up_before_the_run_is_launched(team, use):
    use()
    moment = due_now(team)

    scheduler.tick(team.db, moment.isoformat())
    scheduler.tick(team.db, moment.isoformat())

    assert runs_of(team.db) == 1  # the second tick finds nothing due


def test_a_moment_that_passed_while_sentra_was_down_is_not_caught_up_with(team, use):
    use()
    moment = due_now(team)
    row(team.db).next_run_at = moment - scheduling.GRACE - timedelta(minutes=1)
    team.db.commit()

    scheduler.tick(team.db, moment.isoformat())

    schedule = row(team.db)
    assert runs_of(team.db) == 0
    assert schedule.last_result == "missed"
    assert schedule.next_run_at > moment  # it runs again at its next moment
    assert schedule.misses == 1
    assert notifications(team.db, "arif@example.com", PROBLEM) == []


def test_a_campaign_that_cannot_run_is_recorded_and_told(team, use):
    use()
    moment = due_now(team)
    team.agent.status = TargetStatus.UNVERIFIED  # its ownership verification lapsed (FR-5.7)
    team.db.commit()

    scheduler.tick(team.db, moment.isoformat())

    schedule = row(team.db)
    assert runs_of(team.db) == 0
    assert (schedule.last_result, schedule.misses) == ("skipped", 1)
    assert "isn't verified" in schedule.last_message
    assert schedule.status == ScheduleStatus.ACTIVE  # it tries again at its next moment
    told = notifications(team.db, "arif@example.com", PROBLEM)
    assert len(told) == 1
    assert told[0].startswith("The scheduled run of C-001")
    assert schedule_actions(team.db)[-1] == "campaign.schedule_skipped"


def test_a_schedule_that_never_works_pauses_itself(team, use):
    use()
    moment = due_now(team)
    team.agent.status = TargetStatus.UNVERIFIED
    team.db.commit()

    for number in range(scheduling.MAX_MISSES):
        row(team.db).next_run_at = moment
        team.db.commit()
        scheduler.tick(team.db, (moment + timedelta(minutes=number)).isoformat())

    schedule = row(team.db)
    assert (schedule.status, schedule.next_run_at) == (ScheduleStatus.PAUSED, None)
    assert schedule.misses == scheduling.MAX_MISSES
    # One notification for the schedule, kept up to date (FR-9.3, 1a), now saying it is paused
    told = notifications(team.db, "arif@example.com", PROBLEM)
    assert len(told) == 1
    assert "paused until you start it again" in told[0]
    assert "This has happened 3 times." in told[0]


def test_a_creator_who_may_no_longer_launch_campaigns_starts_no_run(team, use):
    use()
    moment = due_now(team)
    # Arif becomes an AI Application Developer, a role that may not launch campaigns (FR-1.6)
    membership_of(team.db, "arif@example.com").role = Role.TARGET_OWNER
    team.db.commit()

    scheduler.tick(team.db, moment.isoformat())

    schedule = row(team.db)
    assert runs_of(team.db) == 0
    assert (schedule.last_result, schedule.last_message) == ("skipped", scheduling.LOST_CREATOR)
    # Saving the schedule again makes it the saver's, so it can run again (UC-5.3, 1a1)
    assert "Save the schedule again" in notifications(team.db, "arif@example.com", PROBLEM)[-1]


def test_a_campaign_that_runs_immediately_launches_its_first_run(team, use):
    use()

    created = team.client.post(
        CAMPAIGNS,
        json=campaign(
            team.agent.id,
            name="Nightly check",
            attempt_budget=10,
            request_rate=20,
            window_start=None,
            window_end=None,
            schedule={"kind": "immediately"},
        ),
    )

    body = created.json()
    assert created.status_code == 201
    assert body["schedule"] is None  # running now is not a schedule (UC-5.1 step 5)
    assert body["launched_run"]["code"] == "R-002-1"
    assert body["launched_run"]["trigger"] == "manual"
    assert body["launch_error"] is None


def test_a_campaign_whose_first_run_cannot_start_is_still_saved(team, use, monkeypatch):
    """UC-5.1, 7a and UC-5.3, 3a: the campaign is saved, and the builder is told why no run
    started, so the analyst can launch it later instead of building it again."""
    use()
    monkeypatch.setattr(get_settings(), "default_monthly_campaign_runs", 0)

    created = team.client.post(
        CAMPAIGNS,
        json=campaign(team.agent.id, name="Nightly check", schedule={"kind": "immediately"}),
    )

    body = created.json()
    assert created.status_code == 201
    assert body["launched_run"] is None
    assert body["launch_error"].startswith("The monthly limit of 0 campaign runs is reached.")
    assert runs_of(team.db) == 0
    assert [one["code"] for one in team.client.get(CAMPAIGNS).json()] == ["C-002", "C-001"]


# ---------------------------------------------------------------- the other modules' turn


def module(name: str, **functions) -> SimpleNamespace:
    """A stand-in for a module's schedules.py (app/workers/extensions.py)."""
    return SimpleNamespace(__name__=f"app.modules.{name}.schedules", **functions)


def test_every_module_gets_its_turn_even_when_one_fails(team, monkeypatch):
    called: list[tuple[str, str]] = []

    def failing(db, at):
        raise RuntimeError("the report couldn't be made")

    def working(name: str):
        def work(db, at) -> int:
            called.append((name, at.isoformat()))
            return 1

        return work

    moment = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    monkeypatch.setattr(
        scheduler,
        "_modules",
        [
            module("m03_threat_models", due=failing),
            module("m09_reporting", due=working("due"), daily=working("daily")),
        ],
    )

    scheduler.tick(team.db, moment.isoformat())
    scheduler.daily(team.db, moment.isoformat())

    assert [name for name, _ in called] == ["due", "daily"]
    assert {at for _, at in called} == {"2026-11-02T01:00:00+00:00"}


def test_a_module_without_due_work_is_left_alone(team, monkeypatch):
    monkeypatch.setattr(scheduler, "_modules", [module("m10_admin")])

    scheduler.tick(team.db, "")  # nothing to call, and no error

    assert extensions.label(module("m10_admin")) == "m10_admin"
