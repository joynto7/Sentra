"""Tests for FR-2.4 Connection Testing, FR-2.3 Ownership Verification and FR-2.5 Target Profile
(UC-2.2, UC-2.3, UC-2.4), and for adding a lab target (UC-11.1, steps 4 and 5).

The tests have no network: the target's side is a MockTransport that records every request."""

import json
import uuid

import dns.exception
import dns.resolver
import httpx
import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m01_users.models import Role, User
from app.modules.m02_targets import verification
from app.modules.m02_targets.models import TargetProfileRevision, TargetStatus
from app.modules.m09_reporting.models import Notification
from app.modules.m11_lab import registration
from app.workers.celery_app import celery_app
from app.workers.connector import connector
from tests.m01_users.test_organizations import log_in
from tests.m02_targets.test_targets import errors, register, stored

HOST = "payments-agent.staging.halcyonbank.com"
FILE_URL = f"https://{HOST}/.well-known/sentra-verification.txt"
LAB_HOST = "lab-rag-chatbot"
GREETING = "Hello! How can I help you today?"


def answer(text: str, **extra) -> dict:
    return {"choices": [{"message": {"content": text, **extra.pop("message", {})}}], **extra}


class TargetSide:
    """The target's side of the network: what it answers, and every request it received."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.chat = lambda request: httpx.Response(200, json=answer(GREETING))
        self.file: str | None = None  # the well-known file, None = HTTP 404
        self.lab_tokens: list[str] = []
        self.lab_slots: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/lab/verification":  # Sentra places a lab target's token itself
            self.lab_tokens.append(json.loads(request.content)["token"])
            return httpx.Response(204)
        if path == "/lab/state":
            return httpx.Response(200, json={"slots": self.lab_slots})
        if request.method == "GET":
            if path == "/.well-known/sentra-verification.txt":
                content = self.file
                if self.lab_tokens:
                    content = "\n".join(self.lab_tokens) + "\n"
                if content is not None:
                    return httpx.Response(200, text=content)
            return httpx.Response(404)
        return self.chat(request)

    def messages(self) -> list[str]:
        return [
            json.loads(r.content)["messages"][-1]["content"]
            for r in self.requests
            if r.method == "POST" and r.url.path != "/lab/verification"
        ]


@pytest.fixture
def side(monkeypatch) -> TargetSide:
    target_side = TargetSide()
    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(target_side))
    return target_side


@pytest.fixture
def no_dns(monkeypatch):
    """The DNS TXT records the checks find, by name."""
    records: dict[str, object] = {}

    def resolve(name: str) -> list[str]:
        found = records.get(name)
        if isinstance(found, Exception):
            raise found
        if found is None:
            raise dns.resolver.NXDOMAIN()
        return found

    monkeypatch.setattr(verification, "resolve_txt", resolve)
    return records


def url(target_id, path: str = "") -> str:
    return f"/api/v1/targets/{target_id}{path}"


def new_target(client, **changes) -> str:
    response = register(client, **changes)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def publish_and_check(client, target_id, side: TargetSide) -> dict:
    """UC-2.3 steps 1-3 with the well-known file."""
    token = client.get(url(target_id, "/verification")).json()["token"]
    side.file = f"{token}\n"
    response = client.post(
        url(target_id, "/verification/checks"), json={"method": "well_known_file"}
    )
    assert response.status_code == 202, response.text
    return response.json()


def audit_actions(db) -> list[str]:
    return list(db.scalars(select(AuditLogEntry.action).order_by(AuditLogEntry.seq)))


# ---------------------------------------------------------------- connection test (UC-2.2)


def test_registration_runs_one_harmless_connection_test(developer, side):
    target_id = new_target(developer)  # UC-2.1 step 7

    assert side.messages() == [connector.CONNECTION_TEST_MESSAGE]  # one request, no attack
    target = developer.get(url(target_id)).json()
    assert target["last_connection_test"]["status"] == "passed"
    assert target["last_connection_test"]["status_code"] == 200
    [test] = developer.get(url(target_id, "/connection-tests")).json()
    assert (test["reply_excerpt"], test["reply_path"], test["error_message"]) == (
        GREETING,
        "$.choices[0].message.content",
        None,
    )
    assert test["duration_ms"] is not None  # the response time is recorded (step 5)


def test_the_request_carries_the_credentials_and_goes_to_the_checked_address(developer, side):
    new_target(developer)

    [request] = side.requests
    assert request.url.host == "93.184.215.15"  # pinned to the address that was checked
    assert request.headers["host"] == HOST
    assert request.headers["x-api-key"] == "sk-test-0123456789abcdef"


def test_rejected_credentials_are_named(developer, side):  # 3b
    side.chat = lambda request: httpx.Response(401)
    target_id = new_target(developer)

    [test] = developer.get(url(target_id, "/connection-tests")).json()
    assert (test["status"], test["error_kind"]) == ("failed", "authentication")
    assert "Check the credentials, or replace them" in test["error_message"]


def test_an_unreachable_target_suggests_checking_the_endpoint(developer, side):  # 3a
    def refuse(request):
        raise httpx.ConnectError("Connection refused")

    side.chat = refuse
    target_id = new_target(developer)

    [test] = developer.get(url(target_id, "/connection-tests")).json()
    assert test["error_kind"] == "network"
    assert test["error_message"].endswith("Check the endpoint URL.")


def test_an_answer_in_another_format_shows_the_part_that_could_not_be_read(developer, side):
    side.chat = lambda request: httpx.Response(
        200, text="<html><script>alert(1)</script>Contact ops@halcyonbank.com</html>"
    )
    target_id = new_target(developer)  # 4a

    [test] = developer.get(url(target_id, "/connection-tests")).json()
    assert test["error_kind"] == "format"
    assert "Adjust the response format" in test["error_message"]
    # Stored and returned as plain text only (NFR-3.6), with personal data masked.
    assert test["unreadable_excerpt"].startswith("<html><script>alert(1)</script>Contact [EMAIL_1]")


def test_a_reply_in_the_wrong_place_names_the_path(developer, side):
    side.chat = lambda request: httpx.Response(200, json={"output": {"text": "Hi"}})
    target_id = new_target(developer)

    [test] = developer.get(url(target_id, "/connection-tests")).json()
    assert "no reply at $.choices[0].message.content" in test["error_message"]
    assert '"output"' in test["unreadable_excerpt"]


def test_test_connection_starts_a_new_test_and_its_result_can_be_followed(developer, side):
    target_id = new_target(developer)
    side.chat = lambda request: httpx.Response(503)

    started = developer.post(url(target_id, "/connection-tests"))

    assert started.status_code == 202
    followed = developer.get(url(target_id, f"/connection-tests/{started.json()['id']}")).json()
    assert (followed["status"], followed["error_kind"]) == ("failed", "overloaded")
    assert [t["status"] for t in developer.get(url(target_id, "/connection-tests")).json()] == [
        "failed",
        "passed",
    ]


def test_a_change_of_endpoint_or_credentials_tests_the_connection_again(developer, side):
    target_id = new_target(developer)

    developer.patch(
        url(target_id), json={"endpoint_url": "https://loan-policy.staging.halcyonbank.com/chat"}
    )
    developer.put(
        url(target_id, "/credentials"),
        json={"credentials": [{"credential_type": "bearer_token", "name": "", "value": "t" * 20}]},
    )
    developer.patch(url(target_id), json={"max_request_rate": 30})  # no new test for this

    assert len(developer.get(url(target_id, "/connection-tests")).json()) == 3


def test_a_security_analyst_may_test_the_connection_but_an_administrator_may_not(
    developer, side, client
):
    target_id = new_target(developer)

    log_in(client, "priya@example.com")
    assert client.post(url(target_id, "/connection-tests")).status_code == 202
    log_in(client, "tom@example.com")
    refused = client.post(url(target_id, "/connection-tests"))
    assert refused.status_code == 403
    assert "Test target connections" in refused.json()["error"]["message"]


def test_another_organization_cannot_test_or_see_the_target(developer, side, client, db):
    from tests.m01_users.test_organizations import create, new_user

    target_id = new_target(developer)
    new_user(db, "eve@example.com")
    log_in(client, "eve@example.com")
    create(client, "Other Bank")

    assert client.get(url(target_id)).status_code == 404  # the same answer as for no target
    assert client.get(url(target_id, "/connection-tests")).status_code == 404
    assert client.get(url(target_id, "/verification")).status_code == 404
    assert client.get(url(target_id, "/profile")).status_code == 404


def test_a_job_queue_that_cant_be_reached_never_leaves_a_test_running(developer, side, monkeypatch):
    target_id = new_target(developer)
    monkeypatch.setattr(get_settings(), "run_jobs_inline", False)

    def down(*args, **kwargs):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(celery_app, "send_task", down)
    test = developer.post(url(target_id, "/connection-tests")).json()

    assert (test["status"], test["error_kind"]) == ("failed", "queue")
    assert "background workers can't be reached" in test["error_message"]


def test_every_target_job_is_a_worker_task():
    import app.workers.targets  # noqa: F401  (the worker imports it through the include list)

    assert {"targets.connection_test", "targets.check_ownership", "targets.map_profile"} <= set(
        celery_app.tasks
    )


# ---------------------------------------------------------------- ownership (UC-2.3)


def test_the_ownership_card_shows_the_token_and_both_methods(developer, side):
    target_id = new_target(developer)

    card = developer.get(url(target_id, "/verification")).json()

    assert card["status"] == "unverified" and len(card["token"]) == 32
    assert card["dns"] == {
        "type": "TXT",
        "name": f"_sentra-verify.{HOST}",
        "value": f"sentra-verification={card['token']}",
    }
    assert card["file"] == {"url": FILE_URL, "content": card["token"]}
    assert (card["is_lab"], card["ip_endpoint"], card["recent_checks"]) == (False, False, [])


def test_every_target_gets_its_own_random_token(developer, side):
    first = developer.get(url(new_target(developer), "/verification")).json()["token"]
    second = developer.get(url(new_target(developer, name="Second agent"), "/verification")).json()[
        "token"
    ]

    assert first != second


def test_the_well_known_file_verifies_the_target_and_records_who_when_and_how(developer, side, db):
    target_id = new_target(developer)

    check = publish_and_check(developer, target_id, side)

    assert (check["status"], check["checked_by"], check["checked_location"]) == (
        "passed",
        "Maya",
        FILE_URL,
    )
    target = developer.get(url(target_id)).json()
    assert target["status"] == "verified"
    assert (target["verified_by"]["name"], target["verification_method"]) == (
        "Maya",
        "well_known_file",
    )
    assert target["verified_at"] is not None
    assert "target.verified" in audit_actions(db)  # step 5
    # Only the endpoint's own host is asked (quality requirement 4).
    [fetch] = [r for r in side.requests if r.method == "GET"]
    assert (fetch.headers["host"], fetch.url.path) == (HOST, "/.well-known/sentra-verification.txt")


def test_a_dns_txt_record_verifies_the_target(developer, side, no_dns):
    target_id = new_target(developer)
    token = developer.get(url(target_id, "/verification")).json()["token"]
    no_dns[f"_sentra-verify.{HOST}"] = ["v=spf1 -all", f"sentra-verification={token}"]

    check = developer.post(
        url(target_id, "/verification/checks"), json={"method": "dns_txt_record"}
    ).json()

    assert check["status"] == "passed"
    assert developer.get(url(target_id)).json()["verification_method"] == "dns_txt_record"


def test_a_wrong_token_is_explained_and_the_target_stays_unverified(developer, side):  # 4a
    target_id = new_target(developer)
    side.file = "sentra-verification=0000000000000000\n"

    check = developer.post(
        url(target_id, "/verification/checks"), json={"method": "well_known_file"}
    ).json()

    assert check["status"] == "failed"
    assert check["found"] == "sentra-verification=0000000000000000"
    assert "doesn't contain this target's token" in check["message"]
    assert developer.get(url(target_id)).json()["status"] == "unverified"


def test_a_missing_file_is_explained(developer, side):
    target_id = new_target(developer)

    check = developer.post(
        url(target_id, "/verification/checks"), json={"method": "well_known_file"}
    ).json()

    assert check["status"] == "failed"
    assert f"We looked for the file at {FILE_URL} and found nothing" in check["message"]


def test_a_dns_change_that_hasnt_spread_yet_says_to_check_again_later(developer, side, no_dns):
    target_id = new_target(developer)
    no_dns[f"_sentra-verify.{HOST}"] = dns.exception.Timeout()

    timed_out = developer.post(
        url(target_id, "/verification/checks"), json={"method": "dns_txt_record"}
    ).json()
    del no_dns[f"_sentra-verify.{HOST}"]
    not_there = developer.post(
        url(target_id, "/verification/checks"), json={"method": "dns_txt_record"}
    ).json()

    assert "check again in a few minutes; the token stays valid" in timed_out["message"]  # 4b
    assert "wait a few minutes and check again" in not_there["message"]
    assert len(developer.get(url(target_id, "/verification")).json()["recent_checks"]) == 2


def test_an_ip_address_endpoint_can_only_use_the_file(developer, side):
    target_id = new_target(developer, endpoint_url="https://93.184.215.20/v1/chat")

    card = developer.get(url(target_id, "/verification")).json()
    refused = developer.post(
        url(target_id, "/verification/checks"), json={"method": "dns_txt_record"}
    )

    assert (card["ip_endpoint"], card["dns"]) == (True, None)
    assert refused.status_code == 422


def test_only_lab_targets_use_the_lab_method(developer, side):
    target_id = new_target(developer)

    refused = developer.post(url(target_id, "/verification/checks"), json={"method": "lab"})

    assert refused.status_code == 422


def test_no_role_can_mark_a_target_verified_without_a_check(developer, side, client, db):
    target_id = new_target(developer)

    developer.patch(url(target_id), json={"status": "verified"})  # not a field: ignored
    assert developer.get(url(target_id)).json()["status"] == "unverified"
    for email in ("priya@example.com", "tom@example.com"):  # NFR-8.1
        log_in(client, email)
        assert (
            client.post(
                url(target_id, "/verification/checks"), json={"method": "well_known_file"}
            ).status_code
            == 403
        )
    assert stored(db, target_id).status == TargetStatus.UNVERIFIED


def test_a_verified_target_needs_no_second_check(developer, side):
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)

    again = developer.post(
        url(target_id, "/verification/checks"), json={"method": "well_known_file"}
    )

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_verified"


def test_the_token_is_checked_again_before_a_campaign_run(developer, side, db):
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)
    target = stored(db, target_id)

    assert verification.recheck(db, target).status == "passed"  # still there
    side.file = None  # the owner removed the file
    removed = verification.recheck(db, target)

    assert (removed.status, removed.trigger) == ("failed", "campaign_run")
    assert stored(db, target_id).status == TargetStatus.UNVERIFIED
    assert stored(db, target_id).verified_at is None
    entry = db.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "target.verification_lost")
    )
    assert entry.actor_type == "sentra"


def test_a_new_endpoint_must_be_verified_again(developer, side):
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)

    developer.patch(
        url(target_id), json={"endpoint_url": "https://loan-policy.staging.halcyonbank.com/chat"}
    )

    target = developer.get(url(target_id)).json()
    assert (target["status"], target["verified_by"], target["verification_method"]) == (
        "unverified",
        None,
        None,
    )


# ---------------------------------------------------------------- profile (UC-2.4)


def discovery_answers(request: httpx.Request) -> httpx.Response:
    """A target that answers each discovery question differently, with its model's name."""
    question = json.loads(request.content)["messages"][-1]["content"]
    replies = {  # "allowed" first: that question also contains "help"
        "allowed": "I can't change account limits or talk about other customers.",
        "topics": "I answer from the payments operations handbook.",
        "actions": "I can look up a payment.",
        "help": "I help with payments: I can look up and release stopped payments.",
    }
    text = next((r for key, r in replies.items() if key in question), GREETING)
    extra = {}
    if "actions" in question:
        extra["message"] = {
            "tool_calls": [
                {"function": {"name": "lookup_payment", "arguments": '{"payment_id": "P-1"}'}}
            ]
        }
    return httpx.Response(
        200, json=answer(text, model="gpt-5-mini", **extra), headers={"X-RateLimit-Limit": "60"}
    )


def entries(profile: dict) -> dict[str, tuple[str, str]]:
    return {e["key"]: (e["value"], e["source"]) for e in profile["entries"]}


def test_verification_maps_the_profile_with_a_few_harmless_requests(developer, side, db):
    side.chat = discovery_answers
    target_id = new_target(developer)
    sent_before = len(side.messages())

    publish_and_check(developer, target_id, side)  # UC-2.3 step 6 starts the mapping

    profile = developer.get(url(target_id, "/profile")).json()
    assert (profile["status"], profile["version"], profile["discovery_requests"]) == ("ready", 1, 4)
    assert len(side.messages()) - sent_before == 4  # few, and within the budget
    found = entries(profile)
    assert found["model_behaviour"] == (
        "I help with payments: I can look up and release stopped payments.",
        "discovered",
    )
    assert found["underlying_model"] == ("gpt-5-mini", "discovered")
    assert found["authentication"] == ("API key in the X-Api-Key header", "discovered")
    assert found["rate_limits"][0] == "The target announces a limit: x-ratelimit-limit: 60"
    assert profile["tools"] == [
        {
            "name": "lookup_payment",
            "parameters": "payment_id",
            "side_effect": "",
            "source": "discovered",
        }
    ]
    assert developer.get(url(target_id)).json()["profile_status"] == "ready"
    # Step 4: Maya, who verified the target, is told that the profile is ready.
    note = db.scalar(select(Notification).where(Notification.event == "target_profile_ready"))
    maya = db.scalar(select(User).where(User.email == "maya@example.com"))
    assert (note.user_id, note.link) == (maya.id, f"/targets/{target_id}/profile")


def test_what_cant_be_determined_is_marked_unknown(developer, side):  # 3a
    target_id = new_target(developer)

    publish_and_check(developer, target_id, side)  # the default answers have no model field

    found = entries(developer.get(url(target_id, "/profile")).json())
    assert found["underlying_model"] == ("", "unknown")
    assert found["rate_limits"] == (
        "No limit seen in 4 requests at 20 per minute",
        "discovered",
    )


def test_signs_of_overload_stop_the_mapping_and_keep_what_was_found(developer, side):  # 2a
    target_id = new_target(developer)
    calls = {"n": 0}

    def overloaded_on_the_second(request):
        calls["n"] += 1
        if calls["n"] >= 2:
            return httpx.Response(503)
        return httpx.Response(200, json=answer("I help with payments."))

    side.chat = overloaded_on_the_second
    publish_and_check(developer, target_id, side)

    profile = developer.get(url(target_id, "/profile")).json()
    assert (profile["status"], profile["discovery_requests"]) == ("partial", 2)
    assert "signs of overload" in profile["stop_reason"]
    found = entries(profile)
    assert found["model_behaviour"] == ("I help with payments.", "discovered")
    assert found["knowledge_summary"] == ("", "unknown")


def test_a_profile_is_mapped_only_for_a_verified_target(developer, side):
    target_id = new_target(developer)

    assert developer.get(url(target_id, "/profile")).json()["status"] == "not_mapped"
    refused = developer.post(url(target_id, "/profile/mapping"))
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "not_verified")


def test_a_reviewed_profile_marks_changes_as_added_manually_and_keeps_them(
    developer, side, client, db
):
    side.chat = discovery_answers
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)

    log_in(client, "priya@example.com")  # a Security Analyst reviews it (step 5)
    saved = client.put(
        url(target_id, "/profile"),
        json={
            "entries": {
                "refusals": {"value": "Never changes limits; never shows other customers."},
                "underlying_model": {"value": "gpt-5-mini"},  # unchanged
            },
            "tools": [
                {"name": "lookup_payment", "parameters": "payment_id"},
                {"name": "release_payment", "parameters": "payment_id", "side_effect": "write"},
            ],
            "knowledge_sources": [
                {"name": "Payments handbook", "description": "Internal procedures", "access": "all"}
            ],
        },
    )

    assert saved.status_code == 200, saved.text
    profile = saved.json()
    assert (profile["status"], profile["version"], profile["reviewed_by"]) == (
        "reviewed",
        2,
        "Priya",
    )
    found = entries(profile)
    assert found["refusals"][1] == "manual"
    assert found["underlying_model"] == ("gpt-5-mini", "discovered")
    assert [(t["name"], t["source"]) for t in profile["tools"]] == [
        ("lookup_payment", "discovered"),
        ("release_payment", "manual"),
    ]
    assert profile["knowledge_sources"][0]["source"] == "manual"
    assert "target.profile_saved" in audit_actions(db)

    # "Update profile" maps the target again; what people added stays (FR-2.6 history).
    log_in(client, "maya@example.com")
    remapped = client.post(url(target_id, "/profile/mapping")).json()
    assert remapped["version"] == 3
    assert entries(remapped)["refusals"] == (
        "Never changes limits; never shows other customers.",
        "manual",
    )
    assert [t["name"] for t in remapped["tools"]] == ["release_payment", "lookup_payment"]
    kinds = db.scalars(
        select(TargetProfileRevision.kind).order_by(TargetProfileRevision.version)
    ).all()
    assert kinds == ["mapped", "reviewed", "mapped"]


def test_an_unknown_profile_entry_is_refused(developer, side):
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)

    refused = developer.put(
        url(target_id, "/profile"), json={"entries": {"colour": {"value": "x"}}}
    )

    assert refused.status_code == 422


def test_an_administrator_cannot_change_a_profile(developer, side, client):
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)

    log_in(client, "tom@example.com")

    assert client.put(url(target_id, "/profile"), json={}).status_code == 403
    assert client.get(url(target_id, "/profile")).status_code == 200  # every member may read


# ---------------------------------------------------------------- canary tokens


def test_a_target_gets_one_canary_token_per_slot_which_the_owner_plants(developer, side, db):
    target_id = new_target(developer)
    publish_and_check(developer, target_id, side)

    tokens = developer.get(url(target_id, "/profile")).json()["canaries"]
    assert [t["slot"] for t in tokens][:3] == [
        "system_instructions",
        "test_document",
        "restricted_document",
    ]
    assert len(tokens) == 7 and not any(t["planted"] for t in tokens)
    assert tokens[0]["token"].startswith("SENTRA-SYS-")
    assert tokens[4]["token"].endswith("@example.com")  # synthetic personal data (RFC 2606)

    needs_topic = developer.put(
        url(target_id, "/profile/canaries/test_document"), json={"planted": True}
    )
    assert errors(needs_topic) == {"topic": "Enter the document's topic."}
    planted = developer.put(
        url(target_id, "/profile/canaries/test_document"),
        json={"planted": True, "topic": "account fees"},
    ).json()
    assert (planted["planted"], planted["topic"]) == (True, "account fees")
    assert "target.canary_planted" in audit_actions(db)


# ---------------------------------------------------------------- lab targets (UC-11.1)


@pytest.fixture
def lab(monkeypatch, side):
    monkeypatch.setattr(get_settings(), "lab_hosts", [LAB_HOST])
    side.lab_slots = [
        {"slot": "system_instructions", "token": "CANARY-SYS-1", "topic": None},
        {"slot": "test_document", "token": "CANARY-DOC-1", "topic": "account fees"},
    ]
    return side


def priya(db) -> User:
    return db.scalar(select(User).where(User.email == "priya@example.com"))


def test_users_cannot_register_lab_addresses(developer, lab, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_private_targets", True)  # not even on-premises

    refused = register(developer, endpoint_url=f"http://{LAB_HOST}:8080/v1/chat/completions")

    assert "belongs to Sentra's own Security Lab" in errors(refused)["endpoint_url"]


def test_sentra_adds_a_lab_target_and_verifies_it_by_placing_the_token(developer, lab, db):
    organization_id = stored_org(db)

    target, added = registration.register(db, organization_id, priya(db))

    assert added and target.name == "RAG chatbot (lab)"
    assert lab.lab_tokens == [target.verification_token]  # placed by Sentra (report 2.3.2)
    card = developer.get(url(target.id, "/verification")).json()
    assert (card["status"], card["is_lab"], card["method"]) == ("verified", True, "lab")
    assert card["recent_checks"][0]["checked_by"] == "Priya"
    out = developer.get(url(target.id)).json()
    assert (out["is_lab"], out["last_connection_test"]["status"]) == (True, "passed")
    # The lab target's own canary tokens, planted by the lab and not changeable by people.
    tokens = {t["slot"]: t for t in developer.get(url(target.id, "/profile")).json()["canaries"]}
    assert set(tokens) == {"system_instructions", "test_document"}
    assert (tokens["test_document"]["source"], tokens["test_document"]["planted"]) == ("lab", True)
    refused = developer.put(
        url(target.id, "/profile/canaries/test_document"), json={"planted": False}
    )
    assert refused.status_code == 409


def test_a_lab_target_is_added_once_per_organization(developer, lab, db):  # UC-11.1, 1a
    organization_id = stored_org(db)
    first, _ = registration.register(db, organization_id, priya(db))

    again, added = registration.register(db, organization_id, priya(db))

    assert (again.id, added) == (first.id, False)


def test_only_an_active_security_analyst_adds_lab_targets(developer, lab, db):
    from app.core.errors import PermissionDeniedError
    from app.modules.m01_users.models import Membership

    maya = db.scalar(select(User).where(User.email == "maya@example.com"))
    with pytest.raises(PermissionDeniedError):
        registration.register(db, stored_org(db), maya)
    analyst = db.scalar(select(Membership).where(Membership.user_id == priya(db).id))
    analyst.status = "suspended"  # FR-10.1
    db.flush()
    with pytest.raises(PermissionDeniedError):
        registration.register(db, stored_org(db), priya(db))


def test_a_lab_target_whose_tokens_changed_keeps_the_old_ones_recorded(developer, lab, db):
    from app.modules.m02_targets import canaries
    from app.modules.m02_targets.models import TargetCanary

    target, _ = registration.register(db, stored_org(db), priya(db))
    lab.lab_slots[0]["token"] = "CANARY-SYS-2"  # e.g. the lab target was reset (UC-11.2)

    canaries.sync_lab(db, stored(db, target.id), lab.lab_slots)
    db.flush()

    rows = db.scalars(
        select(TargetCanary).where(
            TargetCanary.target_id == target.id, TargetCanary.slot == "system_instructions"
        )
    ).all()
    assert sorted((r.token, r.retired_at is None) for r in rows) == [
        ("CANARY-SYS-1", False),
        ("CANARY-SYS-2", True),
    ]


def stored_org(db) -> uuid.UUID:
    from app.modules.m01_users.models import Membership

    return db.scalar(
        select(Membership.organization_id)
        .join(User, User.id == Membership.user_id)
        .where(User.email == "priya@example.com", Membership.role == Role.SECURITY_ANALYST)
    )
