"""Tests of the Target Connector (FR-5.7, FR-2.1, FR-2.2, NFR-3.4). The network is replaced by
httpx's MockTransport, so the tests see every request the connector would send."""

import json
import re

import httpx
import pytest

from app.core import addresses
from app.core.config import get_settings
from app.core.models import Organization
from app.modules.m02_targets.models import CredentialType, Target, TargetCredential
from app.workers.connector import FixedBudget, send
from app.workers.connector import connector as connector_module
from app.workers.connector.errors import (
    AddressRefused,
    BadResponse,
    BudgetExhausted,
    NotVerified,
    TargetHTTPError,
    TargetOverloaded,
    TargetRedirect,
    TargetTimeout,
    TargetUnreachable,
)

PUBLIC_IP = "93.184.216.34"
OPENAI_ANSWER = {"choices": [{"message": {"content": "Hello from the bot", "tool_calls": None}}]}


@pytest.fixture(autouse=True)
def dns(monkeypatch):
    """The tests run without DNS: every host name is a public address unless a test says not."""
    found = {"addresses": [PUBLIC_IP]}
    monkeypatch.setattr(addresses, "resolve", lambda host, port: found["addresses"])
    return found


@pytest.fixture
def waits(monkeypatch):
    """The waits for the target's turn, recorded instead of slept."""
    slept: list[float] = []
    monkeypatch.setattr(connector_module.time, "sleep", slept.append)
    return slept


def make_target(db, **changes) -> Target:
    organization = Organization(name="Halcyon Bank", slug=f"halcyon-{len(changes)}-{id(changes)}")
    db.add(organization)
    db.flush()
    fields = {
        "organization_id": organization.id,
        "name": "Support Assistant",
        "type": "chatbot",
        "endpoint_url": "https://api.halcyonbank.com/v1/chat/completions",
        "environment": "staging",
        "max_request_rate": 60,
        "status": "verified",
        "verification_token": "token",
    } | changes
    target = Target(**fields)
    db.add(target)
    db.flush()
    credential = TargetCredential(
        target_id=target.id, name="Authorization", credential_type=CredentialType.BEARER_TOKEN
    )
    credential.set_value("sk-secret-of-the-target")
    target.credentials.append(credential)
    db.flush()
    return target


def answering(answer=OPENAI_ANSWER, status=200, seen=None, headers=None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        body = answer if isinstance(answer, bytes | str) else json.dumps(answer)
        return httpx.Response(status, content=body, headers=headers or {})

    return httpx.MockTransport(handler)


def test_an_openai_compatible_target_gets_the_message_and_the_reply_is_read(db, waits):
    target = make_target(db)
    seen: list[httpx.Request] = []

    reply = send(db, target, "What are your opening hours?", transport=answering(seen=seen))

    request = seen[0]
    assert json.loads(request.content) == {
        "messages": [{"role": "user", "content": "What are your opening hours?"}]
    }
    assert request.headers["authorization"] == "Bearer sk-secret-of-the-target"  # FR-2.2
    assert request.headers["user-agent"].startswith("Sentra-Target-Connector/")
    assert (reply.text, reply.status_code) == ("Hello from the bot", 200)


def test_the_request_goes_to_the_address_that_was_checked(db, waits):
    """NFR-3.4: connected to the checked IP, with the real host name for HTTP and TLS."""
    target = make_target(db)
    seen: list[httpx.Request] = []

    send(db, target, "hi", transport=answering(seen=seen))

    assert seen[0].url.host == PUBLIC_IP
    assert seen[0].headers["host"] == "api.halcyonbank.com"
    assert seen[0].extensions["sni_hostname"] == "api.halcyonbank.com"


def test_a_custom_json_target_gets_its_template(db, waits):
    target = make_target(
        db,
        request_template='{"session": "{{session_id}}", "input": "{{message}}"}',
        response_template={"reply": "$.output.text", "tool_calls": "$.output.tools"},
    )
    seen: list[httpx.Request] = []
    answer = {"output": {"text": "Refund issued", "tools": [{"name": "issue_refund"}]}}

    reply = send(
        db, target, 'Say "yes"\nnow', session_id="s-1", transport=answering(answer, seen=seen)
    )

    assert json.loads(seen[0].content) == {"session": "s-1", "input": 'Say "yes"\nnow'}
    assert (reply.text, reply.tool_calls) == ("Refund issued", [{"name": "issue_refund"}])


def test_only_a_verified_target_gets_attempts(db, waits):
    target = make_target(db, status="unverified")
    seen: list[httpx.Request] = []

    with pytest.raises(NotVerified):
        send(db, target, "hi", transport=answering(seen=seen))
    assert seen == []


def test_nothing_is_sent_beyond_the_budget(db, waits):
    target = make_target(db)
    seen: list[httpx.Request] = []
    budget = FixedBudget(2)

    send(db, target, "one", budget=budget, transport=answering(seen=seen))
    send(db, target, "two", budget=budget, transport=answering(seen=seen))
    with pytest.raises(BudgetExhausted):
        send(db, target, "three", budget=budget, transport=answering(seen=seen))
    assert len(seen) == 2


def test_requests_are_spaced_to_the_rate(db, waits):
    target = make_target(db, max_request_rate=60)  # one a second

    for _ in range(3):
        send(db, target, "hi", transport=answering())

    # The test doesn't really sleep, so each wait counts from the same moment: 1 s, then 2 s.
    assert len(waits) == 2
    assert 0.8 < waits[0] <= 1.0 and 1.8 < waits[1] <= 2.0


def test_a_campaign_may_go_slower_but_never_faster(db, waits):
    slower, faster = make_target(db, max_request_rate=60), make_target(db, max_request_rate=60)

    for _ in range(2):
        send(db, slower, "hi", rate_per_minute=30, transport=answering())
    for _ in range(2):
        send(db, faster, "hi", rate_per_minute=600, transport=answering())

    assert 1.8 < waits[0] <= 2.0  # 30 a minute: every 2 seconds
    assert 0.8 < waits[1] <= 1.0  # 600 asked, but the target's 60 a minute kept


def test_a_private_address_is_refused_before_anything_is_sent(db, waits, dns):
    target = make_target(db)
    dns["addresses"] = ["10.0.0.5"]  # e.g. the host name was changed after the check
    seen: list[httpx.Request] = []

    with pytest.raises(AddressRefused, match="Private network"):
        send(db, target, "hi", transport=answering(seen=seen))
    assert seen == []


def test_sentras_own_lab_targets_may_be_private(db, waits, dns, monkeypatch):
    monkeypatch.setattr(get_settings(), "lab_hosts", ["lab-rag-chatbot"])
    dns["addresses"] = ["172.18.0.4"]
    target = make_target(db, endpoint_url="http://lab-rag-chatbot:8080/v1/chat/completions")
    seen: list[httpx.Request] = []

    send(db, target, "hi", transport=answering(seen=seen))

    assert seen[0].url.host == "lab-rag-chatbot"


@pytest.mark.parametrize(
    ("status", "headers", "error", "message"),
    [
        (429, {"Retry-After": "30"}, TargetOverloaded, "overloaded (HTTP 429). It asks to wait 30"),
        (503, {}, TargetOverloaded, "overloaded (HTTP 503)"),
        (500, {}, TargetHTTPError, "answered with HTTP 500"),
        (302, {"Location": "http://10.0.0.5/"}, TargetRedirect, "doesn't follow redirects"),
    ],
)
def test_error_answers_are_named(db, waits, status, headers, error, message):
    target = make_target(db)

    with pytest.raises(error, match=re.escape(message)):
        send(db, target, "hi", transport=answering({"error": "x"}, status=status, headers=headers))


@pytest.mark.parametrize(
    ("answer", "message"),
    [
        (b"<html>Gateway</html>", "isn't JSON"),
        ({"choices": []}, r"no reply at \$\.choices\[0\]\.message\.content"),
        (b"{" + b" " * 1_000_001 + b"}", "larger than 1 MB"),
    ],
)
def test_answers_in_another_form_are_named(db, waits, answer, message):
    target = make_target(db)

    with pytest.raises(BadResponse, match=message):
        send(db, target, "hi", transport=answering(answer))


def test_timeouts_and_refused_connections_are_named(db, waits):
    target = make_target(db)

    def slow(request):
        raise httpx.ReadTimeout("timed out", request=request)

    def closed(request):
        raise httpx.ConnectError("[Errno 111] Connection refused", request=request)

    with pytest.raises(TargetTimeout, match="within 60 seconds"):
        send(db, target, "hi", transport=httpx.MockTransport(slow))
    with pytest.raises(TargetUnreachable, match="the connection was refused"):
        send(db, target, "hi", transport=httpx.MockTransport(closed))
