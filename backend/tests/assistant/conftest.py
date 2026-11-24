"""Helpers of the assistant's tests: a scripted model, and a reader of the event stream."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.llm import layer
from app.modules.assistant.service import limiter
from app.modules.m01_users.models import Role
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import organization_with


def call(tool: str, /, **arguments) -> dict:
    return {"name": tool, "arguments": arguments}


class Script:
    """The model of a test. Each reply is a text, or a list of tool calls (`call(...)`); the model
    gives them in order. `sent` holds what it was given, request by request."""

    def __init__(self) -> None:
        self.replies: list = []
        self.sent: list[dict] = []

    def then(self, *replies) -> "Script":
        self.replies.extend(replies)
        return self

    def __call__(self, choice, messages, max_tokens, temperature, tools=None):
        self.sent.append({"messages": messages, "tools": tools or []})
        reply = self.replies.pop(0) if self.replies else "Done."
        calls = None
        if isinstance(reply, list):
            calls = [
                SimpleNamespace(
                    id=f"call_{i}",
                    function=SimpleNamespace(name=c["name"], arguments=json.dumps(c["arguments"])),
                )
                for i, c in enumerate(reply)
            ]
            reply = None
        message = SimpleNamespace(content=reply, tool_calls=calls)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message)],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        )


@pytest.fixture
def model(monkeypatch) -> Script:
    """An assistant model that answers as the test says."""
    monkeypatch.setattr(get_settings(), "llm_model", "ollama_chat/test-model")
    monkeypatch.setattr(get_settings(), "llm_task_models", {})
    script = Script()
    monkeypatch.setattr(layer, "_send", script)
    return script


@pytest.fixture
def no_model(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_model", "")
    monkeypatch.setattr(get_settings(), "llm_task_models", {})


@pytest.fixture(autouse=True)
def _fresh_limit():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def team(client: TestClient, db):
    """Halcyon Bank: Tom (administrator), Maya (developer), Priya (analyst), Sam (manager)."""
    organization_with(
        db,
        client,
        {
            "maya@example.com": Role.TARGET_OWNER,
            "priya@example.com": Role.SECURITY_ANALYST,
            "sam@example.com": Role.SECURITY_MANAGER,
        },
    )
    return client


def as_user(client: TestClient, email: str) -> TestClient:
    log_in(client, email)
    return client


def events(response) -> list[dict]:
    """The events of a streamed answer, in order."""
    assert response.status_code == 200, response.text
    return [
        json.loads(line[len("data: ") :])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def of_kind(items: list[dict], kind: str) -> list[dict]:
    return [e for e in items if e["event"] == kind]


def say(client: TestClient, text: str, conversation_id=None, page: str = ""):
    body = {"message": text, "page": page}
    if conversation_id:
        body["conversation_id"] = conversation_id
    return events(client.post("/api/v1/assistant/chat", json=body))


def decide(client: TestClient, action_id: str, decision: str):
    return client.post(f"/api/v1/assistant/actions/{action_id}", json={"decision": decision})
