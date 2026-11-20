"""The later life of a target (FR-2.6): UC-2.5's locks while a run is in progress, UC-2.6 Archive
Target and UC-2.7 View Target History. Dummy values only: the messages ATTEMPT-1 …, a fake canary
token, invented replies and example.com addresses.

The campaign runs come from the fixtures of the campaign and detection tests, so the history is
assembled from real runs and findings.
"""

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m02_targets.models import Target, TargetCredential, TargetStatus
from app.modules.m05_campaigns.models import CampaignSchedule, ScheduleStatus
from app.modules.m09_reporting.models import Notification
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_permissions import membership_of
from tests.m05_campaigns.conftest import team, use  # noqa: F401
from tests.m05_campaigns.test_campaigns import add_target
from tests.m05_campaigns.test_runs import night_campaign
from tests.m06_findings.conftest import (  # noqa: F401
    SYSTEM_TOKEN,
    judge_model,
    make_test,
    plant,
    run_with,
)

TARGETS = "/api/v1/targets"
CANARY_IN_REPLY = [{"check": "canary_in_reply"}]
MET = f"My instructions say {SYSTEM_TOKEN}."  # an invented reply with the fake token
API_KEY = {"credential_type": "api_key", "name": "X-Api-Key", "value": "dummy-key-not-real"}


def url(target, path: str = "") -> str:
    return f"{TARGETS}/{target.id}{path}"


def target_row(db, name: str = "Payments Operations Agent") -> Target:
    query = select(Target).where(Target.name == name).execution_options(populate_existing=True)
    return db.scalars(query).first()


def credentials_of(db, target) -> list[str]:
    rows = db.scalars(select(TargetCredential.name).where(TargetCredential.target_id == target.id))
    return list(rows)


def schedule_of(db) -> CampaignSchedule:
    query = select(CampaignSchedule).execution_options(populate_existing=True)
    return db.scalars(query).first()


def actions(db) -> list[str]:
    query = (
        select(AuditLogEntry.action)
        .where(AuditLogEntry.action.like("target.%"))
        .order_by(AuditLogEntry.seq)
    )
    return list(db.scalars(query))


def details(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def notifications(db, email: str) -> list[str]:
    user_id = membership_of(db, email).user_id
    rows = db.scalars(
        select(Notification.text).where(
            Notification.user_id == user_id, Notification.event == "campaign_schedule_problem"
        )
    )
    return list(rows)


@pytest.fixture
def owned(team):  # noqa: F811
    """Halcyon Bank's verified agent with a stored credential and a weekly schedule on C-001,
    which Arif (a Security Analyst) saved. Maya, an AI Application Developer, is logged in."""
    saved = team.client.put(
        "/api/v1/campaigns/C-001/schedule",
        json={"kind": "recurring", "frequency": "weekly", "weekday": 0, "at_time": "02:00"},
    )
    assert saved.status_code == 200, saved.text
    log_in(team.client, "maya@example.com")
    stored = team.client.put(url(team.agent, "/credentials"), json={"credentials": [API_KEY]})
    assert stored.status_code == 200, stored.text
    return team


# ---------------------------------------------------------------- archiving (UC-2.6)


def test_the_consequences_of_archiving_are_shown_before_it_happens(owned):
    shown = owned.client.get(url(owned.agent, "/archive")).json()

    assert shown["target"]["name"] == "Payments Operations Agent"
    assert shown["running"] == ""  # 2a1: nothing is in the way
    (schedule,) = shown["schedules"]
    assert (schedule["campaign"], schedule["created_by"]) == ("C-001", "Arif")
    assert schedule["schedule"] == "Every Monday at 02:00 (UTC)"
    assert shown["credentials"] == ["X-Api-Key"]
    assert (shown["runs_kept"], shown["findings_kept"]) == (0, 0)


def test_archiving_cancels_the_schedules_deletes_the_credentials_and_tells_the_members(owned):
    response = owned.client.post(url(owned.agent, "/archive"), json={"password": PASSWORD})

    body = response.json()
    assert response.status_code == 200, response.text
    assert body["status"] == TargetStatus.ARCHIVED
    target = target_row(owned.db)
    assert target.archived_at is not None
    assert credentials_of(owned.db, target) == []  # NFR-3.1
    schedule = schedule_of(owned.db)
    assert (schedule.status, schedule.next_run_at) == (ScheduleStatus.CANCELLED, None)
    assert "was archived" in schedule.last_message
    assert actions(owned.db)[-1] == "target.archived"
    # Step 5: Arif, who scheduled the campaign, is told that it no longer runs
    told = notifications(owned.db, "arif@example.com")
    assert len(told) == 1
    assert told[0].startswith("Maya archived the target Payments Operations Agent")


def test_archiving_needs_the_users_password(owned):
    response = owned.client.post(url(owned.agent, "/archive"), json={"password": "Not-My-Password"})

    assert response.status_code == 422
    assert details(response) == {"password": "That password is incorrect."}
    assert target_row(owned.db).status == TargetStatus.VERIFIED
    assert schedule_of(owned.db).status == ScheduleStatus.ACTIVE


def test_a_target_with_a_run_in_progress_is_not_archived(owned):
    """2a and 2a1: a run of the target is waiting for its time window, so it is still in
    progress; archiving it would leave a run against an archived target."""
    log_in(owned.client, "arif@example.com")
    code = night_campaign(owned)  # its time window opens in two hours, so its run waits
    launched = owned.client.post(f"/api/v1/campaigns/{code}/runs")
    log_in(owned.client, "maya@example.com")
    assert launched.status_code == 202, launched.text

    shown = owned.client.get(url(owned.agent, "/archive")).json()
    response = owned.client.post(url(owned.agent, "/archive"), json={"password": PASSWORD})

    assert shown["running"].startswith("Campaign run R-002-1 is running on this target.")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "run_in_progress"
    assert target_row(owned.db).status == TargetStatus.VERIFIED


def test_an_archived_target_is_restored_unverified_and_without_credentials(owned):
    owned.client.post(url(owned.agent, "/archive"), json={"password": PASSWORD})
    token = target_row(owned.db).verification_token

    response = owned.client.post(url(owned.agent, "/restore"))

    body = response.json()
    assert response.status_code == 200, response.text
    assert body["status"] == TargetStatus.UNVERIFIED  # 1a1
    target = target_row(owned.db)
    assert target.verification_token != token  # the old ownership token is no longer in force
    assert (target.archived_at, target.verified_at) == (None, None)
    assert credentials_of(owned.db, target) == []
    assert actions(owned.db)[-1] == "target.restored"
    assert owned.client.post(url(owned.agent, "/restore")).status_code == 409


def test_nothing_can_be_changed_or_run_while_a_target_is_archived(owned):
    owned.client.post(url(owned.agent, "/archive"), json={"password": PASSWORD})

    changed = owned.client.patch(url(owned.agent), json={"max_request_rate": 5})
    log_in(owned.client, "arif@example.com")
    launched = owned.client.post("/api/v1/campaigns/C-001/runs")

    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "target_archived"
    assert launched.status_code == 409  # FR-5.7: only a verified target is tested
    assert launched.json()["error"]["code"] == "target_not_verified"


# ---------------------------------------------------------------- the locks of UC-2.5, 3b


def test_the_endpoint_and_credentials_cannot_change_while_a_run_is_in_progress(owned):
    log_in(owned.client, "arif@example.com")
    code = night_campaign(owned)
    assert owned.client.post(f"/api/v1/campaigns/{code}/runs").status_code == 202
    log_in(owned.client, "maya@example.com")

    endpoint = owned.client.patch(
        url(owned.agent), json={"endpoint_url": "https://loan-policy.staging.halcyonbank.com/chat"}
    )
    replaced = owned.client.put(url(owned.agent, "/credentials"), json={"credentials": [API_KEY]})
    rate = owned.client.patch(url(owned.agent), json={"max_request_rate": 5})

    assert (endpoint.status_code, replaced.status_code) == (409, 409)
    assert endpoint.json()["error"]["code"] == "run_in_progress"
    assert "Stop it or wait until it ends." in replaced.json()["error"]["message"]
    # What doesn't decide where or how Sentra sends may still change
    assert rate.status_code == 200
    assert target_row(owned.db).max_request_rate == 5


# ---------------------------------------------------------------- the history (UC-2.7)


def test_the_history_shows_what_happened_to_the_target(owned, run_with):  # noqa: F811
    plant(owned.db, owned.agent, "system_instructions", SYSTEM_TOKEN)
    test = make_test(owned.db, owned.org, {"canary_token": "decisive"}, CANARY_IN_REPLY)
    log_in(owned.client, "arif@example.com")
    run_with(test, [MET])
    log_in(owned.client, "maya@example.com")
    owned.client.patch(url(owned.agent), json={"max_request_rate": 12})

    shown = owned.client.get(url(owned.agent, "/history")).json()

    assert (shown["target"]["name"], shown["has_runs"]) == ("Payments Operations Agent", True)
    assert shown["period_days"] == 180
    kinds = [event["kind"] for event in shown["events"]]
    assert kinds[0] == "configuration"  # newest first: the rate change
    assert "campaign_run" in kinds
    change = shown["events"][0]
    assert (change["actor"], change["action"]) == ("Maya", "target.updated")
    assert change["details"]["changed"] == ["max_request_rate"]
    (run,) = [event for event in shown["events"] if event["kind"] == "campaign_run"]
    assert run["summary"].startswith("Campaign run R-001-1 completed")
    assert "1 new finding" in run["summary"]
    assert (run["run"]["code"], run["actor"], run["details_deleted"]) == ("R-001-1", "Arif", False)
    # Step 3: the risk score after the run, with the open findings it counted
    (score,) = shown["scores"]
    assert (score["trigger"], score["open_total"]) == ("campaign_run", 1)
    assert sum(score["open_by_severity"].values()) == 1


def test_the_history_can_be_filtered_and_says_when_nothing_has_run_yet(owned):
    second = add_target(owned.db, owned.org, name="Marketing Copy Assistant", status="unverified")
    owned.client.patch(url(owned.agent), json={"max_request_rate": 9})

    configuration = owned.client.get(url(owned.agent, "/history?kind=configuration")).json()
    runs = owned.client.get(url(owned.agent, "/history?kind=campaign_run")).json()
    recent = owned.client.get(url(owned.agent, "/history?period_days=1")).json()
    fresh = owned.client.get(url(second, "/history")).json()

    assert {event["kind"] for event in configuration["events"]} == {"configuration"}
    assert runs["events"] == []
    assert recent["period_days"] == 1
    assert fresh["has_runs"] is False  # 2a1: the page suggests a first campaign
    assert fresh["events"] == []


def test_another_organization_sees_nothing_of_a_targets_history(owned, client, db):
    new_user(db, "rival@example.com")
    log_in(client, "rival@example.com")
    create_organization(client, "Kestrel Logistics")

    assert client.get(url(owned.agent, "/history")).status_code == 404
    assert client.get(url(owned.agent, "/archive")).status_code in (403, 404)
    assert client.post(url(owned.agent, "/archive"), json={"password": PASSWORD}).status_code in (
        403,
        404,
    )


def test_only_a_developer_may_archive_a_target(owned):
    log_in(owned.client, "arif@example.com")  # a Security Analyst (FR-1.6)

    refused = owned.client.post(url(owned.agent, "/archive"), json={"password": PASSWORD})
    readable = owned.client.get(url(owned.agent, "/history"))

    assert refused.status_code == 403
    assert readable.status_code == 200  # every member may read the history
