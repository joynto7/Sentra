"""FR-9.6 (M9) Webhooks: UC-9.7 Manage Webhooks end to end, with 4a and 6a.

The receiving system is one the test runs: it records every request, checks the signature the way
a real receiver would, and answers whatever a test tells it to. Nothing leaves the test —
`webhooks.TRANSPORT` is replaced, the way the Target Connector's network is in `tests/conftest.py`.
"""

import hashlib
import hmac
import json
import socket
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core import addresses
from app.core.audit import AuditLogEntry
from app.core.crypto import decrypt
from app.modules.m01_users.models import Role
from app.modules.m09_reporting import notifications, webhooks
from app.modules.m09_reporting.models import (
    Notification,
    Webhook,
    WebhookDelivery,
    WebhookStatus,
)
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import organization_with

URL = "/api/v1/webhooks"
RECEIVER = "https://hooks.example.com/sentra"
ADMIN = "tom@example.com"
ANALYST = "arif@example.com"
EVENTS = ["campaign_run_completed", "finding_critical_high"]


class Receiver:
    """The organization's own system. It answers 202 until a test says otherwise, and it keeps
    every request so a test can check what Sentra really sent."""

    def __init__(self) -> None:
        self.status = 202
        self.body = ""
        self.requests: list[httpx.Request] = []
        self.offline = False

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.offline:
            raise httpx.ConnectError("the receiving system is not reachable")
        self.requests.append(request)
        return httpx.Response(self.status, text=self.body)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]

    def payload(self) -> dict:
        return json.loads(self.last.content)

    def verify(self, secret: str) -> bool:
        """What a receiving system does with every delivery (quality requirement 1)."""
        timestamp = self.last.headers["X-Sentra-Timestamp"]
        signed = f"{timestamp}.".encode() + self.last.content
        expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return hmac.compare_digest(self.last.headers["X-Sentra-Signature"], f"v1={expected}")


def _resolve(host: str, port: int) -> list[str]:
    """The tests have no internet; only the receiving system's host name is known."""
    if host == "hooks.example.com":
        return ["93.184.215.14"]
    raise socket.gaierror(f"{host} not found")


@pytest.fixture
def receiver(monkeypatch) -> Receiver:
    system = Receiver()
    monkeypatch.setattr(webhooks, "TRANSPORT", httpx.MockTransport(system.handle))
    monkeypatch.setattr(addresses, "resolve", _resolve)
    return system


@pytest.fixture
def halcyon(client, db):
    """Halcyon Bank with Tom its administrator and Arif an analyst, Tom logged in and confirmed."""
    organization_id = organization_with(db, client, {ANALYST: Role.SECURITY_ANALYST})
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    return organization_id


def add(client, **changes) -> dict:
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    data = {"name": "Jira Service Management", "url": RECEIVER, "events": EVENTS} | changes
    answer = client.post(URL, json=data)
    assert answer.status_code == 201, answer.text
    return answer.json()


def activate(client, webhook_id: str) -> dict:
    answer = client.post(f"{URL}/{webhook_id}/test")
    assert answer.status_code == 200, answer.text
    return answer.json()


# ---------------------------------------------------------------- UC-9.7 steps 1-5


def test_a_new_webhook_waits_for_its_test_event(halcyon, client, receiver, db):
    """Steps 1-3: the secret is shown once and the webhook is not active yet."""
    made = add(client)

    assert made["secret"].startswith("whsec_")
    assert made["webhook"]["status"] == WebhookStatus.INACTIVE
    assert made["webhook"]["events"] == EVENTS
    assert "secret" not in made["webhook"]
    row = db.scalar(select(Webhook))
    assert row.secret != made["secret"], "the secret is stored encrypted, never as it is"
    assert decrypt(row.secret, f"webhook-secret:{row.id}") == made["secret"]
    assert not receiver.requests, "nothing is sent before the test event"


def test_the_test_event_activates_the_webhook_and_is_signed(halcyon, client, receiver, db):
    """Steps 4-5 and quality requirement 1."""
    made = add(client)

    answer = activate(client, made["webhook"]["id"])

    assert answer["ok"] is True
    assert answer["webhook"]["status"] == WebhookStatus.ACTIVE
    assert answer["webhook"]["verified_at"] is not None
    assert receiver.verify(made["secret"]), "the receiving system can check the signature"
    assert receiver.last.headers["X-Sentra-Event"] == webhooks.TEST_EVENT
    assert receiver.payload()["data"]["label"] == "Test event"


def test_a_test_event_the_system_refuses_keeps_the_webhook_inactive(halcyon, client, receiver, db):
    """4a and 4a1: Sentra shows what the receiving system answered and activates nothing."""
    made = add(client)
    receiver.status = 401
    receiver.body = "unknown signing key"

    answer = activate(client, made["webhook"]["id"])

    assert answer["ok"] is False
    assert "401" in answer["message"] and "unknown signing key" in answer["message"]
    assert answer["webhook"]["status"] == WebhookStatus.INACTIVE
    assert db.scalar(select(Webhook)).verified_at is None


def test_a_system_that_cannot_be_reached_is_said_in_words(halcyon, client, receiver, db):
    """4a: no answer at all is as much a failed test as a refusal."""
    made = add(client)
    receiver.offline = True

    answer = activate(client, made["webhook"]["id"])

    assert answer["ok"] is False
    assert "ConnectError" in answer["message"]
    assert answer["webhook"]["status"] == WebhookStatus.INACTIVE


def test_an_address_inside_sentras_network_is_refused(halcyon, client, receiver, db):
    """Step 2 and quality requirement 2 (NFR-3.4)."""
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    answer = client.post(
        URL, json={"name": "Internal", "url": "https://169.254.169.254/hook", "events": EVENTS}
    )

    assert answer.status_code == 422
    assert "Private network" in json.dumps(answer.json())
    assert db.scalar(select(Webhook)) is None


def test_an_address_that_is_not_https_is_refused(halcyon, client, receiver, db):
    """The precondition of UC-9.7: the receiving system accepts HTTPS requests."""
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    answer = client.post(
        URL, json={"name": "Plain", "url": "http://hooks.example.com/x", "events": EVENTS}
    )

    assert answer.status_code == 422
    assert "https" in json.dumps(answer.json())


def test_only_an_organization_administrator_manages_webhooks(halcyon, client, receiver, db):
    """UC-9.7's actor (FR-1.6)."""
    add(client)
    log_in(client, ANALYST)
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    assert client.get(URL).status_code == 403
    made = {"name": "x", "url": RECEIVER, "events": EVENTS}
    assert client.post(URL, json=made).status_code == 403


def test_adding_a_webhook_asks_for_the_password_again(halcyon, client, receiver, db):
    """NFR-3.5: it is a security setting, like an API key."""
    log_in(client, ADMIN)  # a new session, no confirmation

    answer = client.post(URL, json={"name": "Jira", "url": RECEIVER, "events": EVENTS})

    assert answer.status_code == 403
    assert db.scalar(select(Webhook)) is None


def test_the_webhook_is_in_the_audit_log(halcyon, client, receiver, db):
    made = add(client)
    client.patch(f"{URL}/{made['webhook']['id']}", json={"events": ["report_ready"]})

    actions = list(db.scalars(select(AuditLogEntry.action)))

    assert "webhook.created" in actions and "webhook.changed" in actions


# ---------------------------------------------------------------- step 6: the events themselves


def test_an_event_reaches_the_webhooks_that_asked_for_it(halcyon, client, receiver, db):
    """Step 6: what a person is told, a receiving system is told too."""
    made = add(client)
    activate(client, made["webhook"]["id"])
    tom = db.scalar(select(Webhook)).created_by_id

    notifications.notify(
        db,
        event="campaign_run_completed",
        user_ids=[tom],
        organization_id=halcyon,
        subject="Campaign run finished",
        text="Quick Regression finished on the Support Assistant with 2 new findings.",
        link="/campaigns/C-001/runs/3",
        data={"run": "C-001-3", "findings": 2},
    )

    body = receiver.payload()
    assert body["event"] == "campaign_run_completed"
    assert body["data"]["summary"].startswith("Quick Regression finished")
    assert body["data"]["link"] == "/campaigns/C-001/runs/3"
    assert body["data"]["run"] == "C-001-3" and body["data"]["findings"] == 2
    assert receiver.verify(made["secret"])


def test_an_event_nobody_asked_for_is_not_sent(halcyon, client, receiver, db):
    made = add(client, events=["report_ready"])
    activate(client, made["webhook"]["id"])
    sent = len(receiver.requests)
    tom = db.scalar(select(Webhook)).created_by_id

    notifications.notify(
        db,
        event="campaign_run_completed",
        user_ids=[tom],
        organization_id=halcyon,
        subject="Campaign run finished",
        text="Quick Regression finished.",
    )

    assert len(receiver.requests) == sent


def test_a_webhook_that_is_not_active_is_sent_nothing(halcyon, client, receiver, db):
    """A webhook whose test event was never confirmed, and one an administrator paused."""
    made = add(client)
    tom = db.scalar(select(Webhook)).created_by_id

    notifications.notify(
        db,
        event="campaign_run_completed",
        user_ids=[tom],
        organization_id=halcyon,
        subject="Campaign run finished",
        text="Quick Regression finished.",
    )
    assert not receiver.requests

    activate(client, made["webhook"]["id"])
    paused = client.patch(f"{URL}/{made['webhook']['id']}", json={"status": "paused"})
    assert paused.status_code == 200
    sent = len(receiver.requests)
    notifications.notify(
        db,
        event="campaign_run_completed",
        user_ids=[tom],
        organization_id=halcyon,
        subject="Campaign run finished",
        text="Quick Regression finished.",
    )

    assert len(receiver.requests) == sent


def test_a_delivery_carries_a_summary_and_never_evidence(halcyon, client, receiver, db):
    """Quality requirement 3: a summary and a link, never evidence or secrets."""
    made = add(client)
    activate(client, made["webhook"]["id"])
    tom = db.scalar(select(Webhook)).created_by_id

    notifications.notify(
        db,
        event="finding_critical_high",
        user_ids=[tom],
        organization_id=halcyon,
        subject="New Critical finding",
        text="F-014 System Instruction Disclosure on the Support Assistant.",
        link="/findings/F-014",
        data={"finding": "F-014", "severity": "critical"},
    )

    body = receiver.payload()
    assert set(body) == {"id", "event", "created_at", "data"}
    assert set(body["data"]) == {"event", "label", "summary", "link", "finding", "severity"}
    text = json.dumps(body)
    assert made["secret"] not in text and "whsec_" not in text


# ---------------------------------------------------------------- 6a: deliveries that fail


def test_a_failed_delivery_is_tried_again_with_longer_waits(halcyon, client, receiver, db):
    """6a1: increasing delays, and the delivery says what went wrong each time."""
    made = add(client)
    activate(client, made["webhook"]["id"])
    receiver.status = 500
    receiver.body = "boom"
    tom = db.scalar(select(Webhook)).created_by_id

    notifications.notify(
        db,
        event="campaign_run_completed",
        user_ids=[tom],
        organization_id=halcyon,
        subject="Campaign run finished",
        text="Quick Regression finished.",
    )

    delivery = db.scalar(
        select(WebhookDelivery).where(WebhookDelivery.event == "campaign_run_completed")
    )
    assert delivery.status_code == 500
    assert "500" in delivery.error and "boom" in delivery.error
    assert delivery.delivered_at is None
    assert delivery.attempts == 1, "the next attempts wait in the queue"


def test_a_webhook_whose_deliveries_keep_failing_is_switched_off(halcyon, client, receiver, db):
    """6a1: Sentra stops sending and tells the administrators — not through the webhook."""
    made = add(client)
    activate(client, made["webhook"]["id"])
    webhook = db.scalar(select(Webhook))
    webhook.failures = webhooks.FAILURES_BEFORE_DISABLED - 1
    db.commit()
    receiver.status = 500

    delivery = WebhookDelivery(
        organization_id=halcyon,
        webhook_id=webhook.id,
        event="campaign_run_completed",
        payload={"summary": "Quick Regression finished."},
    )
    db.add(delivery)
    db.commit()
    webhooks.deliver(db, delivery.id, webhooks.ATTEMPTS - 1)

    db.refresh(webhook)
    assert webhook.status == WebhookStatus.DISABLED and webhook.disabled_at is not None
    told = db.scalar(select(Notification).where(Notification.event == "webhook_disabled"))
    assert told is not None and "could not be sent" in told.text


def test_a_delivery_that_arrives_clears_the_failures(halcyon, client, receiver, db):
    made = add(client)
    activate(client, made["webhook"]["id"])
    webhook = db.scalar(select(Webhook))
    webhook.failures = 3
    db.commit()

    delivery = WebhookDelivery(
        organization_id=halcyon,
        webhook_id=webhook.id,
        event="campaign_run_completed",
        payload={"summary": "Quick Regression finished."},
    )
    db.add(delivery)
    db.commit()
    webhooks.deliver(db, delivery.id)

    db.refresh(webhook)
    assert webhook.failures == 0
    assert db.get(WebhookDelivery, delivery.id).delivered_at is not None


def test_a_switched_off_webhook_can_be_started_again(halcyon, client, receiver, db):
    made = add(client)
    activate(client, made["webhook"]["id"])
    webhook = db.scalar(select(Webhook))
    webhook.status = WebhookStatus.DISABLED
    webhook.failures = 10
    db.commit()

    answer = client.patch(f"{URL}/{made['webhook']['id']}", json={"status": "active"})

    assert answer.status_code == 200
    assert answer.json()["status"] == WebhookStatus.ACTIVE and answer.json()["failures"] == 0


def test_a_webhook_is_not_activated_without_a_confirmed_test_event(halcyon, client, receiver, db):
    made = add(client)

    answer = client.patch(f"{URL}/{made['webhook']['id']}", json={"status": "active"})

    assert answer.status_code == 422
    assert "test event" in json.dumps(answer.json())


# ---------------------------------------------------------------- the secret and the list


def test_the_secret_can_be_rotated_and_is_shown_once(halcyon, client, receiver, db):
    made = add(client)
    activate(client, made["webhook"]["id"])
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    answer = client.post(f"{URL}/{made['webhook']['id']}/secret")

    assert answer.status_code == 200
    new = answer.json()["secret"]
    assert new != made["secret"] and new.startswith("whsec_")
    row = db.scalar(select(Webhook))
    assert decrypt(row.secret, f"webhook-secret:{row.id}") == new
    # From now on the new secret is the one a receiving system checks against.
    activate(client, made["webhook"]["id"])
    assert receiver.verify(new) and not receiver.verify(made["secret"])


def test_a_new_address_has_to_prove_itself_again(halcyon, client, receiver, db):
    made = add(client)
    activate(client, made["webhook"]["id"])

    answer = client.patch(
        f"{URL}/{made['webhook']['id']}", json={"url": "https://hooks.example.com/other"}
    )

    assert answer.json()["status"] == WebhookStatus.INACTIVE
    assert answer.json()["verified_at"] is None


def test_screen_57_lists_the_endpoints_with_their_last_delivery(halcyon, client, receiver, db):
    made = add(client)
    activate(client, made["webhook"]["id"])

    body = client.get(URL).json()

    assert len(body["webhooks"]) == 1
    one = body["webhooks"][0]
    assert one["status"] == WebhookStatus.ACTIVE
    assert one["last_delivery"]["event"] == webhooks.TEST_EVENT
    assert one["last_delivery"]["status_code"] == 202
    assert any(event["key"] == "campaign_run_completed" for event in body["events"])
    deliveries = client.get(f"{URL}/{made['webhook']['id']}/deliveries").json()
    assert len(deliveries) == 1 and deliveries[0]["attempts"] == 1


def test_a_webhook_of_another_organization_cannot_be_read(halcyon, client, receiver, db):
    """NFR-3.3: every row belongs to exactly one organization."""
    made = add(client)
    new_user(db, "lea@fjord.example")
    log_in(client, "lea@fjord.example")
    client.post("/api/v1/organizations", json={"name": "Fjord Analytics"})
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    assert client.get(URL).json()["webhooks"] == []
    assert client.post(f"{URL}/{made['webhook']['id']}/test").status_code == 404
    assert client.delete(f"{URL}/{made['webhook']['id']}").status_code == 404


def test_a_webhook_is_removed_with_its_deliveries(halcyon, client, receiver, db):
    made = add(client)
    activate(client, made["webhook"]["id"])
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    assert client.delete(f"{URL}/{made['webhook']['id']}").status_code == 204

    assert db.scalar(select(Webhook)) is None
    assert db.scalar(select(WebhookDelivery)) is None


def test_the_signature_is_over_the_timestamp_and_the_body(halcyon, client, receiver, db):
    """A replay of an old delivery cannot be passed off as a new one, because the timestamp is
    signed with the body."""
    secret = "whsec_test"
    body = webhooks.body_of(
        "finding_critical_high", {"summary": "x"}, uuid.uuid4(), datetime.now(UTC)
    )

    first = webhooks.signature(secret, "1700000000", body)
    later = webhooks.signature(secret, "1700000060", body)

    assert first != later and first.startswith("v1=")
    assert webhooks.signature(secret, "1700000000", body) == first


def test_an_old_secret_is_worth_rotating(halcyon, client, receiver, db):
    """Only wording on the page; nothing is enforced."""
    made = add(client)
    webhook = db.scalar(select(Webhook))
    assert webhooks.stale_secret(webhook) is False

    webhook.secret_created_at = datetime.now(UTC) - timedelta(days=400)
    db.commit()

    assert webhooks.stale_secret(webhook) is True
    assert client.get(URL).json()["webhooks"][0]["secret_is_old"] is True
    assert made["webhook"]["secret_is_old"] is False
