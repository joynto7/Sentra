"""The gateway of FR-8.3 (UC-8.1): it forwards the traffic, measures what it adds, reports the
markers of Sentra's test requests, and keeps its policy when Sentra cannot be reached.

Nothing here talks to a real Sentra or a real application: the upstream is a stub and Sentra is a
stub too, so the tests say what the gateway does, not what a network does.
"""

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main, policy, sentra
from app.config import Settings


def settings(tmp_path, **changes) -> Settings:
    return Settings(
        sentra_url="https://sentra.example.com",
        token="sgw_" + "a" * 32,
        upstream_url="http://application.example",
        position="in_front",
        policy_file=str(tmp_path / "policy.json"),
        heartbeat_seconds=30,
        request_timeout=5,
        **changes,
    )


# ---------------------------------------------------------------- the traffic


@pytest.fixture
def upstream(monkeypatch):
    """The application behind the gateway: it answers and records what it was sent."""
    seen = []

    class Transport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if request.url.path.endswith("/down"):
                raise httpx.ConnectError("no route")
            return httpx.Response(200, json={"reply": "Hello from the application."})

    real = httpx.AsyncClient

    def client(*args, **kwargs):
        kwargs["transport"] = Transport()
        return real(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    return seen


def test_the_gateway_forwards_the_request_and_the_answer(tmp_path, upstream, monkeypatch):
    monkeypatch.setattr(main, "settings", settings(tmp_path))
    monkeypatch.setattr(main, "link", sentra.Link(settings(tmp_path)))

    answer = TestClient(main.app).post("/chat", json={"message": "Hello"})

    assert answer.status_code == 200
    assert answer.json() == {"reply": "Hello from the application."}
    sent = upstream[-1]
    assert sent.method == "POST" and sent.url.path == "/chat"
    assert json.loads(sent.content) == {"message": "Hello"}
    # one request passed through, and the gateway measured what it added
    requests, latency, markers = main.link._take_window()
    assert (requests, markers) == (1, [])
    assert latency is not None and latency >= 0


def test_sentras_test_request_is_reported_back(tmp_path, upstream, monkeypatch):
    """UC-8.1 step 5: the marker of the harmless request is what proves the gateway is in the
    traffic path."""
    monkeypatch.setattr(main, "settings", settings(tmp_path))
    monkeypatch.setattr(main, "link", sentra.Link(settings(tmp_path)))

    TestClient(main.app).post("/chat", json={}, headers={"X-Sentra-Check": "7f3a9c"})

    requests, _, markers = main.link._take_window()
    assert (requests, markers) == (1, ["7f3a9c"])


def test_an_application_that_cannot_be_reached_answers_502(tmp_path, upstream, monkeypatch):
    monkeypatch.setattr(main, "settings", settings(tmp_path))
    monkeypatch.setattr(main, "link", sentra.Link(settings(tmp_path)))

    answer = TestClient(main.app).get("/down")

    assert answer.status_code == 502
    assert "could not be reached" in answer.json()["error"]
    assert main.link._take_window()[0] == 1  # it still counts as a request that passed through


def test_health_says_what_the_gateway_knows(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "settings", settings(tmp_path))
    monkeypatch.setattr(main, "link", sentra.Link(settings(tmp_path)))

    body = TestClient(main.app).get("/_shield/health").json()

    assert body["policy_version"] == 0 and body["rules"] == 0
    assert body["connected_to_sentra"] is False
    assert body["position"] == "in_front"


# ---------------------------------------------------------------- the conversation with Sentra


class SentraStub:
    """Sentra as the gateway sees it: it answers connect, heartbeat and policy."""

    def __init__(self, policy_version=0, document=None, fails=False):
        self.policy_version = policy_version
        self.document = document or {"rules": []}
        self.fails = fails
        self.heartbeats = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.fails:
            raise httpx.ConnectError("Sentra is down")
        if request.url.path.endswith("/heartbeat"):
            self.heartbeats.append(json.loads(request.content))
        if request.url.path.endswith("/policy"):
            return httpx.Response(
                200, json={"version": self.policy_version, "document": self.document}
            )
        return httpx.Response(
            200,
            json={
                "gateway_id": "11111111-1111-1111-1111-111111111111",
                "policy_version": self.policy_version,
                "heartbeat_seconds": 30,
            },
        )


@pytest.fixture
def sentra_stub(monkeypatch):
    def use(stub: SentraStub) -> SentraStub:
        real = httpx.Client

        def client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(stub.handler)
            return real(*args, **kwargs)

        monkeypatch.setattr(httpx, "Client", client)
        return stub

    return use


def test_the_gateway_reports_its_window_and_takes_a_new_policy(tmp_path, sentra_stub):
    stub = sentra_stub(SentraStub(policy_version=3, document={"rules": [{"id": "r1"}]}))
    link = sentra.Link(settings(tmp_path))
    link.saw_request(12.0, "marker-1")
    link.saw_request(8.0, None)

    assert link.connect() is True

    assert link.policy.version == 3 and link.policy.rule_count == 1
    assert link.heartbeat() is True
    assert stub.heartbeats[-1]["requests"] == 2
    assert stub.heartbeats[-1]["markers"] == ["marker-1"]
    assert stub.heartbeats[-1]["added_latency_ms"] == 10  # the median of the window
    # and the policy is on disk, for the next start
    assert policy.load(str(tmp_path / "policy.json")).version == 3


def test_a_gateway_keeps_its_policy_when_sentra_cannot_be_reached(tmp_path, sentra_stub):
    policy.save(str(tmp_path / "policy.json"), policy.Policy(version=5, document={"rules": [1, 2]}))
    sentra_stub(SentraStub(fails=True))

    link = sentra.Link(settings(tmp_path))

    assert link.policy.version == 5 and link.policy.rule_count == 2
    assert link.connect() is False
    assert link.last_error and "can't be reached" in link.last_error
    assert link.policy.version == 5  # unchanged: the gateway goes on enforcing what it has


def test_a_policy_file_that_is_damaged_is_ignored(tmp_path):
    path = tmp_path / "policy.json"
    path.write_text("{not json")

    assert policy.load(str(path)).version == 0


def test_the_app_is_a_fastapi_app():
    assert isinstance(main.app, FastAPI)
