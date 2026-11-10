"""FR-9.5 (M9) REST API and API Keys: UC-9.6 Manage API Keys with 1a and 3a, and what a key may
reach. No key in these tests leaves the test database."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import Role
from app.modules.m09_reporting import api_keys, schedules
from app.modules.m09_reporting.models import ApiKey
from tests.m01_users.test_organizations import PASSWORD, log_in
from tests.m01_users.test_permissions import organization_with
from tests.m06_findings.conftest import PERSONAL_TOKEN, plant
from tests.m07_risk.conftest import canary_test, findings_of, run_with, team  # noqa: F401

URL = "/api/v1/api-keys"
LATER = (datetime.now(UTC) + timedelta(days=90)).isoformat()


def confirm(client) -> None:
    """NFR-3.5: the settings that make a key need the password again (UC-1.7 step 2)."""
    assert (
        client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD}).status_code == 204
    )


def make(client, **changes) -> dict:
    confirm(client)
    data = {
        "name": "Release pipeline",
        "purpose": "The release pipeline of the support chatbot",
        "scopes": ["read_findings"],
        "target_ids": [],
        "expires_at": LATER,
    } | changes
    response = client.post(URL, json=data)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def admin(client, db):
    """Tom, the Organization Administrator of Halcyon Bank, is logged in."""
    org = organization_with(db, client, {"arif@example.com": Role.SECURITY_ANALYST})
    log_in(client, "tom@example.com")
    return {"client": client, "db": db, "org": org}


def test_an_administrator_creates_a_key_and_sees_it_once(admin):
    """UC-9.6 steps 1-5: the key is in the answer once, and Sentra keeps only its hash."""
    created = make(admin["client"])

    assert created["key"].startswith("snt_") and len(created["key"]) == 36
    assert created["prefix"] == created["key"][:12]
    assert created["scope_labels"] == ["Read findings"]
    assert created["state"] == "active" and created["last_used_at"] is None
    listed = admin["client"].get(URL).json()
    (row,) = listed["rows"]
    assert "key" not in row  # it is never shown again (quality requirement 5)
    assert row["prefix"] == created["prefix"] and row["created_by"] == "Tom"
    stored = admin["db"].scalar(select(ApiKey))
    assert stored.key_hash != created["key"] and len(stored.key_hash) == 64
    entry = admin["db"].scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "api_key.created" and entry.details["prefix"] == created["prefix"]
    assert created["key"] not in entry.summary


def test_creating_a_key_asks_for_the_password_again(admin):
    """NFR-3.5, UC-9.6 step 4."""
    refused = admin["client"].post(
        URL,
        json={
            "name": "Release pipeline",
            "purpose": "",
            "scopes": ["read_findings"],
            "target_ids": [],
            "expires_at": LATER,
        },
    )

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "password_confirmation_required"
    assert admin["db"].scalar(select(ApiKey)) is None


def test_only_an_administrator_manages_keys(admin):
    """UC-9.6's actor: the Organization Administrator."""
    make(admin["client"])
    log_in(admin["client"], "arif@example.com")  # Security Analyst

    assert admin["client"].get(URL).status_code == 403
    assert admin["client"].post(URL, json={}).status_code == 403


def test_a_key_reads_the_findings_it_is_scoped_for(team, run_with):  # noqa: F811
    """FR-9.5: an integration authenticates with the key; the findings are the part of the API it
    reads. Without the scope the same key is refused."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    run_with(canary_test(team, category="LLM02"), [f"Write to {PERSONAL_TOKEN} for help."])
    log_in(team.client, "tom@example.com")
    created = make(team.client)
    headers = {"Authorization": f"Bearer {created['key']}"}
    team.client.cookies.clear()  # an integration has no session

    found = team.client.get("/api/v1/findings", headers=headers)

    assert found.status_code == 200 and found.json()["total"] == 1
    assert (
        team.client.get("/api/v1/api-keys/me", headers=headers).json()["name"] == "Release pipeline"
    )
    # The same key may not reach anything that declares no scope
    assert team.client.get("/api/v1/targets", headers=headers).status_code == 401
    assert team.client.get(URL, headers=headers).status_code == 401


def test_a_key_without_the_scope_is_refused(team, run_with):  # noqa: F811
    log_in(team.client, "tom@example.com")
    created = make(team.client, scopes=["read_reports"])
    headers = {"Authorization": f"Bearer {created['key']}"}
    team.client.cookies.clear()

    refused = team.client.get("/api/v1/findings", headers=headers)

    assert refused.status_code == 401
    assert refused.json()["error"]["code"] == "scope_missing"


def test_a_key_limited_to_targets_reads_only_those(team, run_with):  # noqa: F811
    """UC-9.6 step 2: the administrator may limit a key to certain targets."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    run_with(canary_test(team, category="LLM02"), [f"Write to {PERSONAL_TOKEN} for help."])
    finding = findings_of(team.db)[0]
    other = uuid.uuid4()
    log_in(team.client, "tom@example.com")
    created = make(team.client, target_ids=[str(team.agent.id)])
    headers = {"Authorization": f"Bearer {created['key']}"}
    team.client.cookies.clear()

    assert team.client.get("/api/v1/findings", headers=headers).json()["total"] == 1
    assert team.client.get(f"/api/v1/findings/{finding.code}", headers=headers).status_code == 200
    narrowed = team.client.get(f"/api/v1/findings?target_id={other}", headers=headers)
    assert narrowed.json()["total"] == 0  # another target's findings stay out of reach


def test_a_revoked_key_is_refused_at_once(team, run_with):  # noqa: F811
    """UC-9.6, 1a1."""
    log_in(team.client, "tom@example.com")
    created = make(team.client)
    headers = {"Authorization": f"Bearer {created['key']}"}
    assert team.client.get("/api/v1/findings", headers=headers).status_code == 200

    revoked = team.client.post(f"{URL}/{created['id']}/revoke")

    assert revoked.status_code == 200 and revoked.json()["state"] == "revoked"
    assert revoked.json()["revoked_by"] == "Tom"
    team.client.cookies.clear()
    assert team.client.get("/api/v1/findings", headers=headers).status_code == 401
    log_in(team.client, "tom@example.com")
    assert len(team.client.get(URL).json()["rows"]) == 1  # it stays listed


def test_an_expired_key_is_refused(team, run_with):  # noqa: F811
    log_in(team.client, "tom@example.com")
    created = make(team.client)
    key = team.db.scalar(select(ApiKey))
    key.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    team.db.commit()
    team.client.cookies.clear()

    refused = team.client.get(
        "/api/v1/findings", headers={"Authorization": f"Bearer {created['key']}"}
    )

    assert refused.status_code == 401
    log_in(team.client, "tom@example.com")
    assert team.client.get(URL).json()["rows"][0]["state"] == "expired"


def test_an_expiry_date_is_required_and_bounded(admin):
    """UC-9.6 step 3: a key has an expiry date, and it may not last forever."""
    confirm(admin["client"])
    past = {
        "name": "Old key",
        "purpose": "",
        "scopes": ["read_findings"],
        "target_ids": [],
        "expires_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
    }
    assert admin["client"].post(URL, json=past).status_code == 422
    far = past | {"expires_at": (datetime.now(UTC) + timedelta(days=365 * 3)).isoformat()}
    assert admin["client"].post(URL, json=far).status_code == 422
    assert admin["client"].post(URL, json=past | {"scopes": []}).status_code == 422


def test_the_page_marks_a_key_that_expires_soon(admin):
    """Screen 56: an expiring key stands out, and the scopes say what they wait for."""
    soon = (datetime.now(UTC) + timedelta(days=5)).isoformat()
    make(admin["client"], expires_at=soon)

    listed = admin["client"].get(URL).json()

    assert listed["rows"][0]["state"] == "expiring"
    scopes = {scope["value"]: scope for scope in listed["scopes"]}
    assert scopes["read_findings"]["available"] and scopes["read_findings"]["waiting_for"] is None
    assert scopes["run_security_gate"]["available"] and scopes["read_gate_results"]["available"]
    assert not scopes["read_reports"]["available"]
    assert scopes["read_reports"]["waiting_for"] == "the reports endpoint of the API"


def test_the_administrators_are_told_once_that_a_key_expires_soon(admin):
    """UC-9.6, 3a1: the warning goes out in time, and only once per key."""
    make(admin["client"], expires_at=(datetime.now(UTC) + timedelta(days=3)).isoformat())

    told = api_keys.notify_expiring(admin["db"])

    assert told == 1
    assert api_keys.notify_expiring(admin["db"]) == 0
    unread = admin["client"].get("/api/v1/notifications").json()
    assert unread["items"][0]["event"] == "api_key_expiring"
    assert "expires in 3 days" in unread["items"][0]["text"]


def test_the_clock_gives_the_warning_on_its_daily_round(admin):
    """3a1 through Sentra's clock: Module 9's `daily()` runs once a day (FR-5.3)."""
    make(admin["client"], expires_at=(datetime.now(UTC) + timedelta(days=3)).isoformat())

    assert schedules.daily(admin["db"]) is True
    assert schedules.daily(admin["db"]) is False  # once per key

    unread = admin["client"].get("/api/v1/notifications").json()
    assert [item["event"] for item in unread["items"]].count("api_key_expiring") == 1
