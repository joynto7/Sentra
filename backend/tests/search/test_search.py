"""The search of the top bar: what it finds, and what it must never show."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.modules.m01_users.models import Role, User
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns.models import Campaign, CampaignRun
from app.modules.m06_findings.models import Finding
from app.modules.search import service
from tests.m01_users.test_organizations import create, log_in
from tests.m01_users.test_permissions import new_user, organization_with
from tests.m05_campaigns.test_campaigns import add_target

URL = "/api/v1/search"
NOW = datetime(2026, 11, 4, 12, tzinfo=UTC)


def add_run(db, org, target, number, campaign=None):
    run = CampaignRun(
        organization_id=org,
        campaign_id=campaign.id if campaign else None,
        target_id=target.id,
        number=number,
        status="completed",
        settings={},
        attempt_budget=10,
        request_rate=5,
    )
    db.add(run)
    db.flush()
    return run


def add_finding(db, org, target, number, title="Tool used outside its allowed scope", **changes):
    run = add_run(db, org, target, number)
    finding = Finding(
        organization_id=org,
        number=number,
        target_id=target.id,
        test_code=f"TEST-{number}",
        test_definition_id=db.scalar(select(TestDefinition.id).limit(1)),
        component_kind="model",
        component_name="Model",
        title=title,
        category="LLM06",
        atlas=[],
        severity=changes.pop("severity", "medium"),
        status="new",
        description="A dummy finding.",
        first_run_id=run.id,
        last_run_id=run.id,
        first_seen_at=NOW,
        last_seen_at=NOW,
        **changes,
    )
    db.add(finding)
    db.flush()
    return finding


def add_campaign(db, org, target, number, name="Weekly regression"):
    campaign = Campaign(
        organization_id=org,
        number=number,
        name=name,
        target_id=target.id,
        suites=[],
        attempt_budget=10,
        request_rate=5,
        repetitions=1,
        time_zone="UTC",
    )
    db.add(campaign)
    db.flush()
    return campaign


@pytest.fixture(autouse=True)
def _fresh_limiter(monkeypatch):
    monkeypatch.setattr(service, "limiter", service.Limiter())


@pytest.fixture
def bank(client, db):
    sync_built_in_library(db)
    org = organization_with(db, client, {"arif@example.com": Role.SECURITY_ANALYST})
    log_in(client, "arif@example.com")
    return org


def test_only_a_logged_in_member_can_search(client):
    assert client.post(URL, json={"q": "agent"}).status_code == 401


def test_it_finds_targets_findings_and_campaigns(client, db, bank):
    agent = add_target(db, bank)
    add_finding(db, bank, agent, 7, "Payments data disclosed")
    add_campaign(db, bank, agent, 231, "Monthly payments check")

    found = client.post(URL, json={"q": "payments"}).json()

    assert [t["name"] for t in found["targets"]["items"]] == ["Payments Operations Agent"]
    assert found["findings"]["items"] == [
        {
            "code": "F-007",
            "title": "Payments data disclosed",
            "severity": "medium",
            "status": "new",
            "target_name": "Payments Operations Agent",
        }
    ]
    assert found["campaigns"]["items"][0]["code"] == "C-231"
    assert found["campaigns"]["items"][0]["target_name"] == "Payments Operations Agent"


def test_another_organizations_data_is_never_found(client, db, bank):
    mine = add_target(db, bank)
    add_finding(db, bank, mine, 1)
    new_user(db, "lena@example.com")
    log_in(client, "lena@example.com")
    other = create(client, "Another Bank").json()["id"]
    theirs = add_target(db, other, name="Payments of another bank")
    add_finding(db, other, theirs, 2, "Payments of another bank disclosed")
    add_campaign(db, other, theirs, 500, "Payments of another bank")

    log_in(client, "arif@example.com")
    found = client.post(URL, json={"q": "another bank"}).json()
    by_code = client.post(URL, json={"q": "C-500"}).json()
    by_run = client.post(URL, json={"q": "R-500-1"}).json()

    assert found == {
        "targets": {"total": 0, "items": []},
        "findings": {"total": 0, "items": []},
        "campaigns": {"total": 0, "items": []},
    }
    assert by_code["campaigns"]["total"] == 0
    assert by_run["campaigns"]["total"] == 0


def test_the_organization_comes_from_the_session_never_the_request(client, db, bank):
    add_target(db, bank)
    response = client.post(URL, json={"q": "payments", "organization_id": "someone-elses"})
    assert response.status_code == 200
    assert response.json()["targets"]["total"] == 1


def test_percent_and_underscore_mean_themselves(client, db, bank):
    add_target(db, bank, name="100% safe bot")
    add_target(
        db,
        bank,
        name="Plain bot",
        endpoint_url="https://plain.example.com/chat",
    )

    assert [t["name"] for t in client.post(URL, json={"q": "0%"}).json()["targets"]["items"]] == [
        "100% safe bot"
    ]
    assert client.post(URL, json={"q": "%%"}).json()["targets"]["total"] == 0
    assert client.post(URL, json={"q": "__"}).json()["targets"]["total"] == 0


def test_each_group_is_capped_and_says_how_many_there_are(client, db, bank):
    agent = add_target(db, bank)
    for number in range(1, 9):
        add_finding(db, bank, agent, number)

    findings = client.post(URL, json={"q": "tool used"}).json()["findings"]

    assert findings["total"] == 8
    assert len(findings["items"]) == service.PER_GROUP


def test_the_most_severe_finding_comes_first_and_an_exact_code_before_all(client, db, bank):
    agent = add_target(db, bank)
    add_finding(db, bank, agent, 1, severity="low")
    add_finding(db, bank, agent, 2, severity="critical")
    add_finding(db, bank, agent, 12, "Something else entirely", severity="informational")

    by_words = client.post(URL, json={"q": "tool used"}).json()["findings"]["items"]
    by_code = client.post(URL, json={"q": "f-12"}).json()["findings"]["items"]

    assert [f["code"] for f in by_words] == ["F-002", "F-001"]
    assert [f["code"] for f in by_code] == ["F-012"]


def test_a_run_code_finds_that_run(client, db, bank):
    agent = add_target(db, bank)
    campaign = add_campaign(db, bank, agent, 231)
    add_run(db, bank, agent, 4, campaign)

    found = client.post(URL, json={"q": "R-231-4"}).json()["campaigns"]
    missing = client.post(URL, json={"q": "R-231-5"}).json()["campaigns"]

    assert found["items"] == [
        {
            "code": "C-231",
            "name": "Weekly regression",
            "target_name": "Payments Operations Agent",
            "run_number": 4,
        }
    ]
    assert missing == {"total": 0, "items": []}


def test_one_letter_finds_nothing_and_asks_nothing_of_the_database(client, db, bank):
    add_target(db, bank)
    assert client.post(URL, json={"q": " p "}).json()["targets"]["total"] == 0


def test_only_what_a_list_shows_leaves_the_api(client, db, bank):
    add_target(db, bank, verification_token="s" * 32)

    hit = client.post(URL, json={"q": "payments"}).json()["targets"]["items"][0]

    assert set(hit) == {"id", "name", "type", "environment", "status", "endpoint_host"}
    assert hit["endpoint_host"] == "payments-agent.staging.halcyonbank.com"


def test_very_long_words_are_refused(client, db, bank):
    assert client.post(URL, json={"q": "x" * 101}).status_code == 422


def test_too_many_searches_are_refused_per_person(client, db, bank, monkeypatch):
    monkeypatch.setattr(service, "limiter", service.Limiter(limit=2))

    assert client.post(URL, json={"q": "agent"}).status_code == 200
    assert client.post(URL, json={"q": "agent"}).status_code == 200
    refused = client.post(URL, json={"q": "agent"})

    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "too_many_searches"


def test_the_limit_counts_one_window_and_one_person(db, bank):
    limiter = service.Limiter(limit=1, seconds=60)
    arif = db.scalar(select(User.id).where(User.email == "arif@example.com"))
    tom = db.scalar(select(User.id).where(User.email == "tom@example.com"))

    assert limiter.allow(arif, now=100)
    assert not limiter.allow(arif, now=120)
    assert limiter.allow(tom, now=120)
    assert limiter.allow(arif, now=161)
