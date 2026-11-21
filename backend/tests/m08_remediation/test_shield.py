"""FR-8.3 (M8) Sentra Shield, part 1: UC-8.1 Connect Shield Gateway.

The credential of a gateway, the outbound endpoints it reports itself on, the harmless test
request that proves it is in the target's traffic path (step 5, and 5a1 when it never reports
one), and what a gateway credential may reach. No policy exists yet — UC-8.4 deploys the first
version in the next task — so the policy every gateway here reads is the empty one.

Nothing leaves the tests: the Target Connector's network is the mock transport of
tests/conftest.py, and every credential is made and thrown away inside the test database.
"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import Membership, Role, User
from app.modules.m08_remediation import fixes, gateways
from app.modules.m08_remediation.models import FixKind, ShieldGateway
from app.workers.connector import connector
from tests.m01_users.test_organizations import create, log_in, new_user
from tests.m05_campaigns.test_campaigns import add_target

SHIELD = "/api/v1/shield"
DEVELOPER = "maya@example.com"  # the AI Application Developer of UC-8.1
ANALYST = "arif@example.com"


def connect(team, target=None, position: str = "in_front") -> dict:
    """Steps 1-2: the developer says where the gateway sits and Sentra issues its credential."""
    log_in(team.client, DEVELOPER)
    response = team.client.post(
        f"{SHIELD}/targets/{(target or team.agent).id}", json={"position": position}
    )
    assert response.status_code == 201, response.text
    return response.json()


def stored(db) -> ShieldGateway:
    return db.scalar(select(ShieldGateway))


def as_gateway(team, credential: str) -> dict:
    """What a gateway sends: its credential, and no session of a person."""
    team.client.cookies.clear()
    return {"Authorization": f"Bearer {credential}"}


def announce(team, credential: str, version: str = "1.4.0", position: str = "") -> dict:
    sent = team.client.post(
        f"{SHIELD}/connect",
        json={"version": version, "position": position},
        headers=as_gateway(team, credential),
    )
    assert sent.status_code == 200, sent.text
    return sent.json()


def beat(team, credential: str, **data) -> dict:
    sent = team.client.post(f"{SHIELD}/heartbeat", json=data, headers=as_gateway(team, credential))
    assert sent.status_code == 200, sent.text
    return sent.json()


def requests_sent(monkeypatch) -> list[httpx.Headers]:
    """The headers of every request the Target Connector sends from here on."""
    seen: list[httpx.Headers] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "Hello! How can I help you?"}}]}
        )

    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(record))
    return seen


def prove_the_path(team, credential: str, monkeypatch) -> str:
    """Steps 5 and 6: the test request passes through the gateway, which reports its marker."""
    seen = requests_sent(monkeypatch)
    log_in(team.client, DEVELOPER)
    assert team.client.post(f"{SHIELD}/targets/{team.agent.id}/check").status_code == 200
    marker = seen[-1]["x-sentra-check"]
    beat(team, credential, requests=1, markers=[marker])
    return marker


def code_of(response) -> str:
    return response.json()["error"]["code"]


def test_the_developer_connects_a_gateway_and_sees_the_credential_once(team):
    """Steps 1-2: the credential is in that one answer, and Sentra keeps only its first
    characters and a SHA-256 of it (NFR-3.1), the way an API key of FR-9.5 is kept."""
    created = connect(team)

    credential = created["credential"]
    assert credential.startswith("sgw_") and len(credential) == 36
    gateway = created["gateway"]
    assert gateway["credential_prefix"] == credential[:10]
    assert (gateway["status"], gateway["status_label"]) == ("pending", "Waiting for the gateway")
    assert gateway["position_label"] == "In front of the endpoint"
    assert gateway["target_name"] == "Payments Operations Agent"
    assert gateway["in_traffic_path"] is False and gateway["requests_seen"] == 0
    assert gateway["connected_at"] is None and gateway["added_latency_ms"] is None
    row = stored(team.db)
    assert row.credential_hash == hashlib.sha256(credential.encode()).hexdigest()
    assert len(row.credential_hash) == 64
    listed = team.client.get(SHIELD).json()["rows"][0]
    assert "credential" not in listed and listed["credential_prefix"] == credential[:10]
    entry = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "shield_gateway.registered"
    assert entry.details["prefix"] == credential[:10] and credential not in entry.summary


def test_only_the_applications_developer_connects_a_gateway(team):
    """UC-8.1's primary actor is the developer of the application, the one who can change its
    deployment (FR-1.6). An analyst and a manager read Screen 47 but connect nothing."""
    url = f"{SHIELD}/targets/{team.agent.id}"

    assert team.client.post(url, json={"position": "in_front"}).status_code == 403  # the analyst
    log_in(team.client, "sofia@example.com")  # Security Manager
    assert team.client.post(url, json={"position": "in_front"}).status_code == 403
    assert team.client.get(SHIELD).status_code == 200
    log_in(team.client, DEVELOPER)
    assert team.client.post(url, json={"position": "in_front"}).status_code == 201
    log_in(team.client, ANALYST)
    assert team.client.post(f"{url}/check").status_code == 403
    assert team.client.post(f"{url}/revoke").status_code == 403
    assert team.client.get(f"{url}/check").status_code == 200  # the wizard is read by every member


def test_a_gateway_stands_in_front_of_a_verified_target(team):
    """A gateway stands in the traffic of an application Sentra may test, so its ownership is
    proved first (UC-2.3, FR-5.7)."""
    other = add_target(team.db, team.org, name="Depot Gate Bot", status="registered")
    log_in(team.client, DEVELOPER)

    refused = team.client.post(f"{SHIELD}/targets/{other.id}", json={"position": "in_front"})

    assert refused.status_code == 409 and code_of(refused) == "target_not_verified"
    assert "Verify that you own this target" in refused.json()["error"]["message"]
    assert stored(team.db) is None


def test_the_position_is_one_of_the_two_places_a_gateway_sits(team):
    """Step 1: in front of the endpoint, or between the application and its LLM provider."""
    log_in(team.client, DEVELOPER)

    refused = team.client.post(f"{SHIELD}/targets/{team.agent.id}", json={"position": "somewhere"})

    assert refused.status_code == 422
    assert stored(team.db) is None


def test_connecting_again_replaces_the_credential_of_the_one_gateway(team):
    """One gateway per target: with two in the same traffic, "which policy is active" would have
    no answer. Connecting again hands out a new credential and the old one stops working."""
    first = connect(team)
    announce(team, first["credential"])
    beat(team, first["credential"], requests=5, added_latency_ms=4)

    second = connect(team, position="before_model")

    assert second["gateway"]["id"] == first["gateway"]["id"]
    assert second["credential"] != first["credential"]
    assert len(team.db.scalars(select(ShieldGateway)).all()) == 1
    again = second["gateway"]
    assert again["status"] == "pending" and again["position"] == "before_model"
    assert again["connected_at"] is None and again["requests_seen"] == 0
    assert again["added_latency_ms"] is None and again["gateway_version"] is None
    old = team.client.post(
        f"{SHIELD}/heartbeat", json={}, headers=as_gateway(team, first["credential"])
    )
    assert old.status_code == 401


def test_the_gateway_announces_itself_and_is_not_in_the_path_yet(team):
    """Step 4: the gateway calls Sentra, not the other way round, so one behind a firewall works
    (quality requirement 4). Until a request has passed through it, it is not in the traffic
    path, and the position it reports is where it really sits."""
    created = connect(team)

    state = announce(team, created["credential"], version="1.4.0", position="before_model")

    assert state["gateway_id"] == created["gateway"]["id"]
    assert state["policy_version"] == 0 and state["heartbeat_seconds"] == 30
    row = stored(team.db)
    assert row.gateway_version == "1.4.0" and row.position == "before_model"
    assert row.connected_at is not None and row.last_contact_at is not None
    log_in(team.client, DEVELOPER)
    shown = team.client.get(SHIELD).json()["rows"][0]
    assert (shown["status"], shown["status_label"]) == ("not_in_path", "Not in the traffic path")
    assert shown["gateway_version"] == "1.4.0"
    waiting = team.client.get(f"{SHIELD}/targets/{team.agent.id}/check").json()
    assert (waiting["seen"], waiting["waiting"], waiting["message"]) == (False, False, None)


def test_an_unknown_credential_is_nobody(team):
    """The gateway's own endpoints take a credential and nothing else."""
    created = connect(team)
    secret = created["credential"]
    tampered = secret[:10] + ("y" if secret[10] == "z" else "z") + secret[11:]

    for credential in ("", "sgw_short", "sgw_" + "b" * 32, tampered, secret[4:]):
        refused = team.client.post(
            f"{SHIELD}/heartbeat", json={}, headers=as_gateway(team, credential)
        )
        assert refused.status_code == 401, credential
        assert code_of(refused) == "invalid_gateway_credential"


def test_a_gateway_credential_reaches_nothing_else_in_sentra(team):
    """It may report its gateway and read its policy. Everything else stays closed to it."""
    created = connect(team)
    headers = as_gateway(team, created["credential"])

    opened = team.client.post(f"{SHIELD}/connect", json={"version": "1.4.0"}, headers=headers)

    assert opened.status_code == 200
    assert team.client.get(f"{SHIELD}/policy", headers=headers).status_code == 200
    closed = (
        SHIELD,
        "/api/v1/findings",
        "/api/v1/remediations",
        "/api/v1/targets",
        f"{SHIELD}/targets/{team.agent.id}/check",
    )
    for url in closed:
        assert team.client.get(url, headers=headers).status_code == 401, url


def test_the_heartbeat_reports_the_requests_and_the_latency_it_adds(team):
    """NFR-1.5: the gateway measures what it adds to a request itself and reports the median of
    its window, which Screen 47 shows beside the requests it has seen."""
    created = connect(team)
    announce(team, created["credential"])

    beat(team, created["credential"], requests=12, added_latency_ms=7)
    beat(team, created["credential"], requests=8, added_latency_ms=9)

    log_in(team.client, DEVELOPER)
    shown = team.client.get(SHIELD).json()["rows"][0]
    assert shown["requests_seen"] == 20 and shown["added_latency_ms"] == 9


def test_the_test_request_carries_a_marker_the_gateway_reports(team, monkeypatch):
    """Step 5: Sentra sends the harmless connection test of UC-2.2 through the Target Connector
    with a one-time marker. A gateway in the traffic path sees that header and reports it with
    its next heartbeat, which is how step 6 knows it is really there."""
    created = connect(team)
    announce(team, created["credential"])
    seen = requests_sent(monkeypatch)

    log_in(team.client, DEVELOPER)
    check = team.client.post(f"{SHIELD}/targets/{team.agent.id}/check").json()

    marker = seen[-1]["x-sentra-check"]
    assert len(seen) == 1 and marker == stored(team.db).check_marker and len(marker) == 16
    assert (check["seen"], check["waiting"]) == (False, True)
    assert "every 30 seconds" in check["message"]
    assert check["gateway"]["in_traffic_path"] is False

    beat(team, created["credential"], requests=1, markers=["another gateway's", marker])

    log_in(team.client, DEVELOPER)
    after = team.client.get(f"{SHIELD}/targets/{team.agent.id}/check").json()
    assert (after["seen"], after["waiting"], after["message"]) == (True, False, None)
    assert after["gateway"]["status"] == "active" and after["gateway"]["in_traffic_path"] is True


def test_a_gateway_that_never_reports_the_request_is_not_in_the_path(team, monkeypatch):
    """5a1: the window passes without the marker, so the gateway is not in the traffic path and
    the page says what to check instead of waiting for ever."""
    created = connect(team)
    announce(team, created["credential"])
    requests_sent(monkeypatch)
    log_in(team.client, DEVELOPER)
    team.client.post(f"{SHIELD}/targets/{team.agent.id}/check")

    row = stored(team.db)
    row.check_sent_at = datetime.now(UTC) - gateways.CHECK_WINDOW - timedelta(minutes=1)
    team.db.commit()

    state = team.client.get(f"{SHIELD}/targets/{team.agent.id}/check").json()
    assert (state["seen"], state["waiting"]) == (False, False)
    assert "didn't report Sentra's test request" in state["message"]
    assert state["gateway"]["status"] == "not_in_path"
    assert gateways.active(team.db, team.agent.id) is None  # 5a1: nothing is deployed to it


def test_a_gateway_taken_out_of_the_path_is_not_active_any_more(team, monkeypatch):
    """A later test request that the gateway doesn't report means it is no longer there, even
    though an earlier one proved that it was."""
    created = connect(team)
    announce(team, created["credential"])
    prove_the_path(team, created["credential"], monkeypatch)
    assert gateways.active(team.db, team.agent.id) is not None

    log_in(team.client, DEVELOPER)
    team.client.post(f"{SHIELD}/targets/{team.agent.id}/check")  # the gateway is gone from the path
    row = stored(team.db)
    row.check_sent_at = datetime.now(UTC) - gateways.CHECK_WINDOW - timedelta(minutes=1)
    team.db.commit()

    state = team.client.get(f"{SHIELD}/targets/{team.agent.id}/check").json()
    assert state["gateway"]["status"] == "not_in_path"
    assert gateways.active(team.db, team.agent.id) is None


def test_only_a_gateway_in_the_traffic_path_can_carry_a_fix(team, monkeypatch):
    """UC-8.2 step 6 with 6a: a guardrail takes effect in the gateway when one is really in the
    traffic, and is a change inside the application when none is. `fixes.active_gateway()` is
    the single function this task replaces."""
    created = connect(team)
    announce(team, created["credential"])
    before = fixes.enforcement(team.db, team.agent.id, FixKind.GUARDRAIL)
    assert before[0] == "application" and "No Sentra Shield gateway" in before[1]

    prove_the_path(team, created["credential"], monkeypatch)

    assert fixes.active_gateway(team.db, team.agent.id) is not None
    assert fixes.enforcement(team.db, team.agent.id, FixKind.GUARDRAIL) == ("gateway", None)
    prompt = fixes.enforcement(team.db, team.agent.id, FixKind.SYSTEM_PROMPT)
    assert prompt[0] == "application" and "system prompt belongs" in prompt[1]


def test_a_gateway_that_stops_reporting_is_seen_as_silent(team, monkeypatch):
    """Three missed heartbeats, so one slow window doesn't make a gateway look broken. FR-10.6
    reads the same state for the Sentra Shield row of Screen 63."""
    created = connect(team)
    announce(team, created["credential"])
    prove_the_path(team, created["credential"], monkeypatch)

    row = stored(team.db)
    row.last_contact_at = datetime.now(UTC) - gateways.SILENT_AFTER - timedelta(seconds=5)
    team.db.commit()

    log_in(team.client, DEVELOPER)
    shown = team.client.get(SHIELD).json()["rows"][0]
    assert (shown["status"], shown["status_label"]) == ("not_reporting", "Not reporting")
    assert gateways.active(team.db, team.agent.id) is None  # no policy to a silent gateway
    assert stored(team.db).status == "active"  # what Sentra was told; the state is what is true now


def test_the_developer_revokes_the_gateway_and_its_credential_stops_working(team):
    """4a: a credential stays valid until it is revoked. The gateway keeps enforcing its last
    policy until it is stopped, as it does whenever Sentra cannot be reached."""
    created = connect(team)
    announce(team, created["credential"])

    log_in(team.client, DEVELOPER)
    revoked = team.client.post(f"{SHIELD}/targets/{team.agent.id}/revoke")

    assert revoked.status_code == 200
    assert (revoked.json()["status"], revoked.json()["status_label"]) == ("revoked", "Revoked")
    assert stored(team.db).revoked_at is not None
    entry = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "shield_gateway.revoked"
    gone = team.client.post(
        f"{SHIELD}/heartbeat", json={}, headers=as_gateway(team, created["credential"])
    )
    assert gone.status_code == 401
    log_in(team.client, DEVELOPER)
    again = team.client.post(f"{SHIELD}/targets/{team.agent.id}/revoke")
    assert again.status_code == 409 and code_of(again) == "already_revoked"


def test_a_revoked_gateway_is_not_checked_at_all(team, monkeypatch):
    """Nothing is sent to the target for a gateway that can no longer report anything."""
    created = connect(team)
    announce(team, created["credential"])
    log_in(team.client, DEVELOPER)
    team.client.post(f"{SHIELD}/targets/{team.agent.id}/revoke")
    seen = requests_sent(monkeypatch)

    check = team.client.post(f"{SHIELD}/targets/{team.agent.id}/check").json()

    assert seen == []
    assert (check["seen"], check["waiting"]) == (False, False)
    assert "revoked" in check["message"]


def test_a_target_without_a_gateway_has_nothing_to_check(team):
    log_in(team.client, DEVELOPER)
    url = f"{SHIELD}/targets/{team.agent.id}/check"

    assert team.client.post(url).status_code == 404
    assert team.client.get(url).status_code == 404
    assert team.client.post(f"{SHIELD}/targets/{uuid.uuid4()}/revoke").status_code == 404


def test_screen_47_lists_the_targets_with_and_without_a_gateway(team):
    """Screen 47: the gateways of the organization, and the targets that have none with
    "Connect" beside them. Every member reads it."""
    add_target(team.db, team.org, name="Depot Gate Bot")
    connect(team)

    log_in(team.client, ANALYST)
    listed = team.client.get(SHIELD).json()

    assert [row["target_name"] for row in listed["rows"]] == ["Payments Operations Agent"]
    assert [one["name"] for one in listed["targets_without_gateway"]] == ["Depot Gate Bot"]
    assert listed["rows"][0]["target_environment"] == "staging"
    assert listed["heartbeat_seconds"] == 30


def test_the_policy_is_empty_until_a_version_is_deployed(team):
    """The gateway reads its policy from Sentra; until UC-8.4 deploys the first version it
    forwards every request unchanged and only reports what it sees."""
    created = connect(team)

    policy = team.client.get(f"{SHIELD}/policy", headers=as_gateway(team, created["credential"]))

    assert policy.json() == {"version": 0, "document": {"rules": []}}


def test_the_connection_test_of_a_target_carries_no_marker_by_itself(team, monkeypatch):
    """The one change in the Target Connector is an optional header: UC-2.2's own connection
    test, and every attempt of a campaign run, send exactly what they sent before."""
    seen = requests_sent(monkeypatch)

    connector.check_connection(team.db, team.agent)

    assert "x-sentra-check" not in seen[-1]


def test_another_organization_sees_nothing_of_this_gateway(team):
    """NFR-3.3: a gateway, like the target it stands in front of, belongs to one organization."""
    connect(team)
    url = f"{SHIELD}/targets/{team.agent.id}"

    new_user(team.db, "nadia@example.com")
    log_in(team.client, "nadia@example.com")
    other = uuid.UUID(create(team.client, "Kestrel Logistics").json()["id"])
    new_user(team.db, "omar@example.com")
    omar = team.db.scalar(select(User.id).where(User.email == "omar@example.com"))
    team.db.add(Membership(user_id=omar, organization_id=other, role=Role.TARGET_OWNER))
    team.db.flush()
    log_in(team.client, "omar@example.com")

    assert team.client.get(SHIELD).json()["rows"] == []
    assert team.client.post(url, json={"position": "in_front"}).status_code == 404
    assert team.client.get(f"{url}/check").status_code == 404
    assert team.client.post(f"{url}/revoke").status_code == 404
