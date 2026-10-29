import json
import uuid
from datetime import UTC, datetime

import litellm
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.modules.m01_users.models import Role
from app.modules.m02_targets.models import ProfileStatus, Target, TargetProfile, TargetStatus
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import organization_with

HR_SOURCES = [
    {
        "name": "HR policy index",
        "description": "Policies on leave, travel and conduct",
        "access": "All employees",
        "source": "discovered",
    },
    {
        "name": "Payroll FAQ",
        "description": "Questions about pay dates and payslips",
        "access": "Public",
        "source": "manual",
    },
]
HR_ENTRIES = {
    "model_behaviour": {
        "value": "Answers HR questions for employees of Halcyon Bank.",
        "source": "discovered",
    },
    "refusals": {"value": "Won't discuss other employees' pay.", "source": "discovered"},
}


@pytest.fixture
def halcyon(client: TestClient, db) -> uuid.UUID:
    """Halcyon Bank (administrator Tom) with Arif, a Security Analyst, Maya, an AI Application
    Developer, and Nadia, a Security Manager. Arif is logged in."""
    organization_id = organization_with(
        db,
        client,
        {
            "arif@example.com": Role.SECURITY_ANALYST,
            "maya@example.com": Role.TARGET_OWNER,
            "nadia@example.com": Role.SECURITY_MANAGER,
        },
    )
    log_in(client, "arif@example.com")
    return organization_id


def add_target(
    db,
    organization_id: uuid.UUID,
    name: str = "Internal HR Helpdesk",
    *,
    type: str = "rag_application",
    environment: str = "production",
    status: str = TargetStatus.VERIFIED,
    profile: str | None = ProfileStatus.REVIEWED,
    knowledge_sources: list | None = None,
    tools: list | None = None,
    entries: dict | None = None,
) -> Target:
    """A target with a Target Profile, written straight to the database."""
    slug = "-".join(name.lower().split())
    target = Target(
        organization_id=organization_id,
        name=name,
        type=type,
        endpoint_url=f"https://{slug}.halcyonbank.com/api/chat",
        environment=environment,
        max_request_rate=60,
        status=status,
        verification_token=uuid.uuid4().hex,
    )
    db.add(target)
    db.flush()
    if profile is not None:
        db.add(
            TargetProfile(
                target_id=target.id,
                status=profile,
                version=1,
                entries=HR_ENTRIES if entries is None else entries,
                knowledge_sources=HR_SOURCES if knowledge_sources is None else knowledge_sources,
                tools=tools or [],
                reviewed_at=datetime.now(UTC) if profile == ProfileStatus.REVIEWED else None,
            )
        )
        db.flush()
    return target


def suggestions(*threats: dict) -> str:
    return json.dumps({"threats": list(threats)})


@pytest.fixture
def llm(monkeypatch):
    """Gives threat model generation a model whose answers are the given replies, one per call
    (the last one repeats). Returns the messages the model was sent, call by call."""
    settings = get_settings()
    sent: list[list[dict]] = []
    real = litellm.completion

    def configure(*replies: str) -> list[list[dict]]:
        monkeypatch.setattr(settings, "llm_model", "anthropic/claude-sonnet-5-5")
        monkeypatch.setattr(settings, "llm_task_models", {})
        queue = list(replies)

        def fake(**kwargs):
            sent.append(kwargs["messages"])
            reply = queue.pop(0) if len(queue) > 1 else queue[0]
            return real(**kwargs, mock_response=reply)

        monkeypatch.setattr(litellm, "completion", fake)
        return sent

    return configure


@pytest.fixture(autouse=True)
def _no_model(monkeypatch):
    """No model is configured unless a test asks for one with `llm`."""
    monkeypatch.setattr(get_settings(), "llm_model", "")
    monkeypatch.setattr(get_settings(), "llm_task_models", {})
