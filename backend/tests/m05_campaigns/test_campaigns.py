"""Tests for FR-5.1 (M5) Campaign Creation: UC-5.1 Create Campaign."""

import uuid
from types import SimpleNamespace

import pytest

from app.modules.m01_users.models import Role
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.suites import ATTEMPTS_PER_TEST, sync_built_in_suites
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m01_users.test_permissions import membership_of, organization_with

URL = "/api/v1/campaigns"
SAFE_RATE = 20


def add_target(db, organization_id, **changes) -> Target:
    data = {
        "name": "Payments Operations Agent",
        "type": "tool_using_agent",
        "endpoint_url": "https://payments-agent.staging.halcyonbank.com/v1/chat",
        "environment": "staging",
        "max_request_rate": SAFE_RATE,
        "status": "verified",
        "verification_token": "t" * 32,
    }
    target = Target(organization_id=organization_id, **(data | changes))
    db.add(target)
    db.flush()
    return target


@pytest.fixture
def halcyon(client, db):
    """Arif, a Security Analyst of Halcyon Bank, is logged in. The bank has a verified tool-using
    agent with a safe rate of 20 per minute; the built-in tests and suites are loaded."""
    sync_built_in_library(db)
    sync_built_in_suites(db)
    org = organization_with(
        db,
        client,
        {"arif@example.com": Role.SECURITY_ANALYST, "maya@example.com": Role.TARGET_OWNER},
    )
    agent = add_target(db, org)
    log_in(client, "arif@example.com")
    return SimpleNamespace(client=client, db=db, org=org, agent=agent)


def campaign(target_id, **changes) -> dict:
    """The campaign of Screen 34."""
    data = {
        "name": "Quarterly assessment — Payments Operations Agent",
        "target_id": str(target_id),
        "suites": ["LLM06-EXCESSIVE-AGENCY", "LLM01-PROMPT-INJECTION"],
        "adaptive_agent": True,
        "attempt_budget": 2000,
        "request_rate": 15,
        "repetitions": 5,
        "window_start": "02:00",
        "window_end": "05:00",
        "time_zone": "Asia/Dhaka",
    }
    return data | changes


def details(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def test_analyst_creates_a_campaign(halcyon):
    response = halcyon.client.post(URL, json=campaign(halcyon.agent.id))

    body = response.json()
    assert response.status_code == 201
    assert (body["code"], body["target"]["name"], body["suite_count"]) == (
        "C-001",
        "Payments Operations Agent",
        2,
    )
    assert (body["request_rate"], body["window_start"], body["time_zone"]) == (
        15,
        "02:00:00",
        "Asia/Dhaka",
    )
    assert body["approval_status"] == "not_required"
    assert body["estimate"]["tests"] == 6  # all six tests apply to a tool-using agent


def test_campaign_numbers_count_up_in_each_organization(halcyon):
    halcyon.client.post(URL, json=campaign(halcyon.agent.id))

    second = halcyon.client.post(URL, json=campaign(halcyon.agent.id, name="Weekly regression"))

    assert second.json()["code"] == "C-002"
    assert [c["code"] for c in halcyon.client.get(URL).json()] == ["C-002", "C-001"]


def test_the_rate_cannot_exceed_the_targets_safe_rate(halcyon):
    response = halcyon.client.post(URL, json=campaign(halcyon.agent.id, request_rate=25))

    assert details(response) == {
        "request_rate": "The rate can't exceed the target's safe rate of 20 per minute."
    }


@pytest.mark.parametrize(
    ("status", "message"),
    [
        ("unverified", "Verify the ownership of this target first."),
        ("archived", "This target is archived, so it can't be tested."),
    ],
)
def test_only_a_verified_target_can_be_chosen(halcyon, status, message):
    other = add_target(halcyon.db, halcyon.org, name="Marketing Copy Assistant", status=status)

    response = halcyon.client.post(URL, json=campaign(other.id))

    assert details(response) == {"target_id": message}


def test_every_missing_setting_is_named(halcyon):
    response = halcyon.client.post(URL, json={"repetitions": None})

    assert details(response) == {
        "name": "Enter a name.",
        "target_id": "Choose a target.",
        "suites": "Choose at least one test suite.",
        "attempt_budget": "Enter the attempt budget.",
        "request_rate": "Enter the maximum request rate.",
        "repetitions": "Enter 1 to 10 repetitions.",
    }


@pytest.mark.parametrize(
    ("start", "end", "message"),
    [
        ("02:00", None, "Enter both the start and the end, or neither."),
        ("02:00", "02:00", "The window must be longer than zero minutes."),
        ("2 am", "05:00", "Enter the times as hours and minutes, such as 02:00."),
    ],
)
def test_a_time_window_needs_two_different_times(halcyon, start, end, message):
    response = halcyon.client.post(
        URL, json=campaign(halcyon.agent.id, window_start=start, window_end=end)
    )

    assert details(response) == {"window": message}


def test_a_window_may_cross_midnight_or_be_left_out(halcyon):
    overnight = campaign(halcyon.agent.id, window_start="22:00", window_end="02:00")
    no_window = campaign(halcyon.agent.id, window_start=None, window_end=None)

    assert halcyon.client.post(URL, json=overnight).status_code == 201
    assert halcyon.client.post(URL, json=no_window).status_code == 201


def test_an_unknown_time_zone_is_refused(halcyon):
    response = halcyon.client.post(URL, json=campaign(halcyon.agent.id, time_zone="Mars/Olympus"))

    assert details(response) == {"time_zone": "Unknown time zone."}


def test_the_estimate_counts_the_tests_for_this_target(halcyon):
    chatbot = add_target(halcyon.db, halcyon.org, name="Customer Support Assistant", type="chatbot")

    body = halcyon.client.post(
        f"{URL}/estimate",
        json={"target_id": str(chatbot.id), "suites": ["QUICK-REGRESSION"], "attempt_budget": 100},
    ).json()

    applicable = body["tests"]
    assert 0 < applicable < 8 and body["skipped"] == 8 - applicable  # some apply to agents only
    assert body["estimated_attempts"] == applicable * ATTEMPTS_PER_TEST
    assert body["threat_model"] is None  # UC-5.1, 2a: the target has no approved threat model
    assert f"{body['skipped']} tests don't apply to a chatbot and are skipped." in body["warnings"]
    assert (
        "The budget is smaller than the estimate, so the run may stop before every test has run."
        in body["warnings"]
    )


def test_suites_without_a_test_for_the_target_are_refused(halcyon):
    chatbot = add_target(halcyon.db, halcyon.org, name="Customer Support Assistant", type="chatbot")

    response = halcyon.client.post(
        URL, json=campaign(chatbot.id, suites=["LLM06-EXCESSIVE-AGENCY"], request_rate=10)
    )

    assert details(response) == {
        "suites": "None of these suites' tests apply to a chatbot. Choose other suites."
    }


def test_campaigns_are_visible_only_in_their_organization(halcyon, client, db):
    halcyon.client.post(URL, json=campaign(halcyon.agent.id))
    new_user(db, "ravi@example.com")
    log_in(client, "ravi@example.com")
    create_organization(client, "Orion Health")

    assert client.get(f"{URL}/C-001").status_code == 404
    assert client.get(URL).json() == []


def test_another_organizations_target_cannot_be_used(halcyon, client, db):
    new_user(db, "ravi@example.com")
    log_in(client, "ravi@example.com")
    create_organization(client, "Orion Health")
    membership_of(db, "ravi@example.com").role = Role.SECURITY_ANALYST
    db.flush()

    response = client.post(URL, json=campaign(halcyon.agent.id))

    assert details(response)["target_id"] == "Target not found."


@pytest.mark.parametrize("email", ["maya@example.com", "tom@example.com"])
def test_only_security_analysts_create_campaigns(halcyon, client, email):
    log_in(client, email)  # an AI Application Developer, then the Organization Administrator

    assert client.post(URL, json=campaign(halcyon.agent.id)).status_code == 403
    assert client.get(URL).status_code == 200  # everyone may read


def test_the_campaigns_of_a_suite_can_be_listed(halcyon):
    halcyon.client.post(URL, json=campaign(halcyon.agent.id))

    using = halcyon.client.get(URL, params={"suite": "LLM06-EXCESSIVE-AGENCY"}).json()
    other = halcyon.client.get(URL, params={"suite": "QUICK-REGRESSION"}).json()

    assert [c["code"] for c in using] == ["C-001"]
    assert other == []


def test_an_unknown_campaign_is_not_found(halcyon):
    assert halcyon.client.get(f"{URL}/C-999").status_code == 404
    assert halcyon.client.get(f"{URL}/{uuid.uuid4()}").status_code == 404
