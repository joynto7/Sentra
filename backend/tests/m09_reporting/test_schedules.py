"""FR-9.2 (M9) Scheduled Reports: UC-9.2 with 3a, 4a and 6a. Dummy values only."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import Membership, User
from app.modules.m09_reporting import schedules
from app.modules.m09_reporting.models import Report, ReportSchedule, ScheduleStatus
from tests.m01_users.test_organizations import log_in
from tests.m06_findings.conftest import PERSONAL_TOKEN, plant
from tests.m07_risk.conftest import canary_test, run_with, team  # noqa: F401

URL = "/api/v1/reports/schedules"


def user_id(db, email: str) -> uuid.UUID:
    return db.scalar(select(User.id).where(User.email == email))


def plan(team, **changes) -> dict:  # noqa: F811
    data = {
        "name": "Monthly executive report",
        "type": "executive",
        "scope": "organization",
        "format": "pdf",
        "frequency": "monthly",
        "recipient_ids": [str(user_id(team.db, "sofia@example.com"))],
    } | changes
    response = team.client.post(URL, json=data)
    assert response.status_code == 201, response.text
    return response.json()


def test_a_schedule_says_when_its_next_report_is_due(team, run_with):  # noqa: F811
    """UC-9.2 steps 1-4."""
    created = plan(team)

    assert created["frequency"] == "monthly" and created["status"] == "active"
    assert created["recipients"][0]["name"] == "Sofia"
    assert created["next_run_at"] is not None
    listed = team.client.get("/api/v1/reports").json()
    assert [one["name"] for one in listed["schedules"]] == ["Monthly executive report"]
    assert {one["name"] for one in listed["members"]} >= {"Arif", "Maya", "Sofia"}
    # Screen 53's picker matches a typed address against these, so every member carries one.
    assert all(one["email"] for one in listed["members"])
    entry = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "report_schedule.created"


def test_a_due_schedule_produces_its_report_and_tells_its_recipients(team, run_with):  # noqa: F811
    """Steps 5-6: the report is made like one asked for by hand, and the recipients get a link."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    run_with(canary_test(team, category="LLM02"), [f"Write to {PERSONAL_TOKEN} for help."])
    plan(team, format="json")

    made = schedules.due(team.db, datetime.now(UTC) + timedelta(days=40))

    assert len(made) == 1 and made[0].status == "ready"
    assert made[0].schedule_id is not None
    log_in(team.client, "sofia@example.com")
    notifications = team.client.get("/api/v1/notifications").json()
    assert notifications["items"][0]["event"] == "report_ready"
    assert notifications["items"][0]["link"].startswith("/reports?report=RP-")
    # The link needs a login, and the file itself is never in the message (QR 6)
    assert "RP-001" in notifications["items"][0]["text"]


def test_a_schedule_can_follow_the_campaign_runs_of_a_target(team, run_with):  # noqa: F811
    """Step 2, "after every campaign run of the target": M9's hook runs at the end of a run."""
    plan(
        team,
        name="After every run",
        type="technical",
        scope="target",
        format="json",
        frequency="after_each_run",
        target_id=str(team.agent.id),
    )
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)

    run_with(canary_test(team, category="LLM02"), [f"Write to {PERSONAL_TOKEN} for help."])

    reports = list(team.db.scalars(select(Report).execution_options(populate_existing=True)))
    assert len(reports) == 1 and reports[0].type == "technical"
    assert reports[0].schedule_id is not None


def test_only_members_can_be_recipients(team, run_with):  # noqa: F811
    """UC-9.2, 3a1: reports go only to members of the organization."""
    refused = team.client.post(
        URL,
        json={
            "name": "Monthly",
            "type": "executive",
            "scope": "organization",
            "format": "pdf",
            "frequency": "monthly",
            "recipient_ids": [str(uuid.uuid4())],
        },
    )

    assert refused.status_code == 422
    assert "members of this organization" in refused.json()["error"]["details"][0]["message"]


def test_a_recipient_who_left_the_organization_is_dropped(team, run_with):  # noqa: F811
    """UC-9.2, 6a1."""
    created = plan(team)
    sofia = user_id(team.db, "sofia@example.com")
    team.db.delete(
        team.db.scalar(
            select(Membership).where(
                Membership.user_id == sofia, Membership.organization_id == team.org
            )
        )
    )
    team.db.commit()

    shown = team.client.get("/api/v1/reports").json()["schedules"][0]

    assert shown["recipients"] == []
    assert schedules.recipients_of(team.db, uuid.UUID(created["id"])) == []


def test_a_paused_schedule_produces_nothing(team, run_with):  # noqa: F811
    """UC-9.2, 4a."""
    created = plan(team)

    paused = team.client.patch(f"{URL}/{created['id']}", json={"status": "paused"})

    assert paused.status_code == 200 and paused.json()["status"] == ScheduleStatus.PAUSED
    assert schedules.due(team.db, datetime.now(UTC) + timedelta(days=40)) == []


def test_a_change_applies_from_the_next_report(team, run_with):  # noqa: F811
    """UC-9.2, 4a1: the change is recorded and moves the next date."""
    created = plan(team)
    before = created["next_run_at"]

    changed = team.client.patch(
        f"{URL}/{created['id']}",
        json={"frequency": "weekly", "name": "Weekly executive report"},
    )

    assert changed.status_code == 200
    assert changed.json()["frequency"] == "weekly" and changed.json()["next_run_at"] != before
    actions = [
        entry.action for entry in team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq))
    ]
    assert "report_schedule.changed" in actions


def test_a_schedule_of_every_target_cannot_follow_the_campaign_runs(team, run_with):  # noqa: F811
    """4a1 keeps the rule of step 2: without a target there are no runs the report can follow,
    and Screen 53 only offers the frequency where it works."""
    created = plan(team)

    refused = team.client.patch(f"{URL}/{created['id']}", json={"frequency": "after_each_run"})

    assert refused.status_code == 422
    assert "needs a target to follow" in refused.json()["error"]["details"][0]["message"]
    assert team.db.get(ReportSchedule, uuid.UUID(created["id"])).frequency == "monthly"


def test_deleting_a_schedule_keeps_the_reports_it_produced(team, run_with):  # noqa: F811
    """UC-9.2, quality requirement 5: its reports stay until their retention period ends."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    run_with(canary_test(team, category="LLM02"), [f"Write to {PERSONAL_TOKEN} for help."])
    created = plan(team, format="json")
    schedules.due(team.db, datetime.now(UTC) + timedelta(days=40))

    deleted = team.client.delete(f"{URL}/{created['id']}")

    assert deleted.status_code == 204
    assert team.db.scalar(select(ReportSchedule)) is None
    reports = team.client.get("/api/v1/reports").json()
    assert len(reports["rows"]) == 1 and reports["rows"][0]["schedule"] is None


def test_only_an_analyst_or_a_manager_schedules_a_report(team, run_with):  # noqa: F811
    """UC-9.2's actors."""
    plan(team)
    log_in(team.client, "maya@example.com")  # AI Application Developer

    refused = team.client.post(URL, json={"name": "x"})

    assert refused.status_code == 403
    assert len(team.client.get("/api/v1/reports").json()["schedules"]) == 1


def test_the_next_monthly_report_is_the_first_of_the_next_month(team, run_with):  # noqa: F811
    """Step 2: "monthly, on the 1st"."""
    middle = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)

    assert schedules.next_time("monthly", middle) == datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
    assert schedules.next_time("weekly", middle) == middle + timedelta(days=7)
    assert schedules.next_time("after_each_run", middle) is None
