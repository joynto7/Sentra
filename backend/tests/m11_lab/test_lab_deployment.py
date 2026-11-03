"""FR-11.2 (M11) Isolated Lab Deployment: UC-11.1 Deploy Lab Target (1a, 2a) and UC-11.2 Reset Lab
Target (1a, 5a) end to end, and Screen 65's catalogue.

No lab target runs in the tests: a stub answers the Lab zone's administration API the way the RAG
chatbot does — the canary tokens it reports are made-up markers, never attack content.
"""

import json
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m01_users.models import Role
from app.modules.m02_targets import canaries, lifecycle
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m11_lab.models import LabDeployment, LabState
from app.workers.connector import connector
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import organization_with

URL = "/api/v1/lab"
LAB_HOST = "lab-rag-chatbot"
KEY = "rag-chatbot"
KNOWN = [
    {
        "id": "RAG-01",
        "title": "System prompt disclosure",
        "category": "LLM07",
        "description": "Asked for its instructions, the assistant repeats its system prompt.",
    },
    {
        "id": "RAG-02",
        "title": "Indirect prompt injection through a retrieved document",
        "category": "LLM01",
        "description": "A retrieved document carries an instruction the assistant follows.",
    },
]
SLOTS = [
    {"slot": "system_instructions", "token": "CANARY-SYS-1", "topic": None},
    {"slot": "test_document", "token": "CANARY-DOC-1", "topic": "account fees"},
]


class LabSide:
    """The Lab zone's side of the network: the lab target's administration API and its chat."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.tokens: list[str] = []
        self.slots = [dict(slot) for slot in SLOTS]
        self.known = [dict(item) for item in KNOWN]
        self.reachable = True
        self.resets = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.reachable:
            raise httpx.ConnectError("the lab zone isn't running")
        path = request.url.path
        if path == "/lab/verification":
            self.tokens.append(json.loads(request.content)["token"])
            return httpx.Response(204)
        if path == "/lab/state":
            return httpx.Response(
                200, json={"slots": self.slots, "known_vulnerabilities": self.known}
            )
        if path == "/lab/reset":
            self.resets += 1
            # Step 4: the reset plants new tokens, so the old ones are retired.
            self.slots = [
                {**slot, "token": f"{slot['token']}-{self.resets + 1}"} for slot in self.slots
            ]
            return httpx.Response(200, json={"reset_at": "2026-11-03T09:00:00Z"})
        if path == "/.well-known/sentra-verification.txt" and self.tokens:
            return httpx.Response(200, text="\n".join(self.tokens) + "\n")
        if request.method == "GET":
            return httpx.Response(404)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello!"}}]})


@pytest.fixture
def zone(monkeypatch) -> LabSide:
    """The Lab zone is running, and this deployment has the RAG chatbot."""
    side = LabSide()
    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(side))
    monkeypatch.setattr(get_settings(), "lab_hosts", [LAB_HOST])
    return side


@pytest.fixture
def analyst(client, db, zone):
    """Priya, a Security Analyst of Halcyon Bank, is logged in; Maya owns targets."""
    organization_with(
        db,
        client,
        {"priya@example.com": Role.SECURITY_ANALYST, "maya@example.com": Role.TARGET_OWNER},
    )
    log_in(client, "priya@example.com")
    return client


def lab(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200
    return response.json()


def card(client, key: str = KEY) -> dict:
    return next(c for c in lab(client)["cards"] if c["key"] == key)


def deploy(client, key: str = KEY):
    return client.post(f"{URL}/targets/{key}/deploy")


def reset(client, target_id: str):
    return client.post(f"{URL}/targets/{target_id}/reset")


def actions(db, organization_id=None) -> list[str]:
    chain = str(organization_id) if organization_id else None
    query = select(AuditLogEntry.action).order_by(AuditLogEntry.seq)
    if chain:
        query = query.where(AuditLogEntry.chain == chain)
    return list(db.scalars(query))


# ---------------------------------------------------------------- the catalogue (step 1)


def test_the_catalogue_shows_what_the_lab_offers(analyst):
    found = lab(analyst)

    assert [c["key"] for c in found["cards"]] == [KEY]
    chatbot = found["cards"][0]
    assert chatbot["deployed"] is False
    assert (chatbot["name"], chatbot["type"]) == ("RAG chatbot (lab)", "rag_application")
    assert chatbot["memory_mb"] > 0 and chatbot["minutes"] > 0
    assert "no internet access" in found["isolation"]


def test_a_deployment_without_the_lab_shows_no_lab_target(analyst, monkeypatch):
    monkeypatch.setattr(get_settings(), "lab_hosts", [])

    assert lab(analyst)["cards"] == []
    refused = deploy(analyst)
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "lab_disabled")


# ---------------------------------------------------------------- deploying (UC-11.1)


def test_one_action_deploys_a_lab_target_and_verifies_it(analyst, db, zone):
    response = deploy(analyst)

    assert response.status_code == 201
    body = response.json()
    assert body["deployed"] is True and body["state_label"] == "Ready"
    assert body["status"] == TargetStatus.VERIFIED  # Sentra placed the token itself (step 5)
    assert body["vulnerabilities"] == 2
    assert body["categories"] == ["LLM01", "LLM07"]
    assert body["canaries"] == 2
    target = db.get(Target, uuid.UUID(body["target_id"]))
    assert target.name == "RAG chatbot (lab)"
    assert zone.tokens == [target.verification_token]
    assert "target.lab_deployed" in actions(db, target.organization_id)


def test_the_lab_target_reports_its_own_known_vulnerabilities(analyst, db):
    target_id = deploy(analyst).json()["target_id"]

    response = analyst.get(f"{URL}/targets/{target_id}/vulnerabilities")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == ["RAG-01", "RAG-02"]
    assert response.json()[0]["category"] == "LLM07"


def test_deploying_it_again_opens_the_one_that_is_there(analyst, db):
    first = deploy(analyst).json()

    again = deploy(analyst)

    assert again.status_code == 201
    assert again.json()["target_id"] == first["target_id"]
    assert db.scalar(select(LabDeployment.id)) is not None
    assert len(db.scalars(select(LabDeployment)).all()) == 1


def test_a_lab_zone_that_is_not_running_says_what_to_start(analyst, db, zone):
    zone.reachable = False

    response = deploy(analyst)

    # 2a1: Sentra names the requirement. Sentra starts no container, so nothing is half-started;
    # the lab target stays on the page as "Not ready" with what to do, and Deploy tries again.
    assert response.status_code == 201
    found = card(analyst)
    assert found["state_label"] == "Not ready"
    assert "docker compose --profile lab up -d" in found["last_error"]
    assert db.scalar(select(LabDeployment)).state == LabState.NOT_READY

    zone.reachable = True
    assert deploy(analyst).status_code == 201
    assert card(analyst)["state_label"] == "Ready"  # Deploy tries again


def test_only_a_security_analyst_uses_the_lab(client, db, zone):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    log_in(client, "maya@example.com")

    assert client.get(URL).status_code == 200  # reading the catalogue is open to every member
    assert deploy(client).status_code == 403


def test_another_organization_sees_nothing_of_a_deployed_lab_target(analyst, db, client, zone):
    deploy(analyst)

    from tests.m01_users.test_organizations import create, new_user

    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    create(client, "Kestrel Logistics")

    assert card(client)["deployed"] is False


# ---------------------------------------------------------------- resetting (UC-11.2)


def test_a_reset_plants_new_canary_tokens_and_keeps_the_old_ones(analyst, db, zone):
    target_id = deploy(analyst).json()["target_id"]
    before = {c.slot: c.token for c in canaries.current(db, uuid.UUID(target_id))}

    response = reset(analyst, target_id)

    assert response.status_code == 200
    assert zone.resets == 1
    after = {c.slot: c.token for c in canaries.current(db, uuid.UUID(target_id))}
    assert after != before and set(after) == set(before)
    retired = db.scalars(
        select(canaries.TargetCanary).where(canaries.TargetCanary.retired_at.is_not(None))
    ).all()
    assert len(retired) == 2  # the earlier tokens stay recorded (quality requirement 4)
    row = db.scalar(select(LabDeployment))
    assert (row.state, row.resets) == (LabState.READY, 1)
    assert row.last_reset_at is not None


def test_the_reset_is_in_the_targets_history(analyst, db, zone):
    target_id = deploy(analyst).json()["target_id"]

    reset(analyst, target_id)

    found = analyst.get(f"/api/v1/targets/{target_id}/history").json()
    kinds = {event["kind"] for event in found["events"]}
    assert lifecycle.LAB_RESET in kinds
    summaries = [event["summary"] for event in found["events"]]
    assert any("Reset the lab target" in summary for summary in summaries)


def test_a_reset_that_fails_twice_leaves_the_target_not_ready(analyst, db, zone):
    target_id = deploy(analyst).json()["target_id"]
    zone.reachable = False

    response = reset(analyst, target_id)

    assert response.status_code == 200
    row = db.scalar(select(LabDeployment))
    assert row.state == LabState.NOT_READY
    assert "tried twice" in row.last_error
    assert card(analyst)["state_label"] == "Not ready"


def test_a_lab_target_that_is_not_ready_runs_no_campaign(analyst, db, zone):
    target_id = deploy(analyst).json()["target_id"]
    zone.reachable = False
    reset(analyst, target_id)
    zone.reachable = True

    created = analyst.post(
        "/api/v1/campaigns",
        json={
            "name": "Lab campaign",
            "target_id": target_id,
            "suites": ["QUICK-REGRESSION"],
            "attempt_budget": 20,
            "request_rate": 10,
            "schedule": {"kind": "manual"},
        },
    )
    assert created.status_code in (201, 422)
    if created.status_code == 201:
        launched = analyst.post(f"/api/v1/campaigns/{created.json()['code']}/runs")
        assert launched.status_code == 409
        assert launched.json()["error"]["code"] == "lab_target_not_ready"


def test_a_reset_is_refused_while_a_campaign_run_uses_the_lab_target(analyst, db, zone):
    target_id = deploy(analyst).json()["target_id"]
    from app.modules.m05_campaigns.models import CampaignRun, RunStatus, RunType

    db.add(
        CampaignRun(
            organization_id=db.scalar(select(Target.organization_id)),
            target_id=uuid.UUID(target_id),
            number=1,
            run_type=RunType.CAMPAIGN,
            status=RunStatus.RUNNING,
            attempt_budget=100,
            request_rate=10,
        )
    )
    db.flush()

    refused = reset(analyst, target_id)

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "run_in_progress"
    assert db.scalar(select(LabDeployment)).state == LabState.READY
    assert zone.resets == 0


def test_a_lab_target_that_is_not_deployed_cannot_be_reset(analyst, db):
    assert reset(analyst, str(uuid.uuid4())).status_code == 404
