"""Tests for Screen 59 Data and AI: UC-10.5 Restrict LLM Data Sharing (alternatives 3a and 4a),
and the restriction in the LLM layer (UC-10.5, quality requirement 6)."""

from datetime import UTC, datetime, timedelta

import litellm
import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.core.email import outbox
from app.core.models import Organization
from app.llm import LLMTask, LLMUnavailable, complete
from app.llm.models import LLMUsage
from app.modules.m01_users.models import Role, User
from tests.m01_users.test_organizations import PASSWORD, create, log_in, new_user
from tests.m01_users.test_permissions import organization_with

URL = "/api/v1/admin/data-and-ai"
EXTERNAL, LOCAL = "anthropic/claude-sonnet-5-5", "ollama/llama3.1:8b"


@pytest.fixture
def models(monkeypatch):
    """The platform's models: the judge runs locally through Ollama, every other task uses an
    external provider. No request leaves the tests: LiteLLM answers with a mock reply."""
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_model", EXTERNAL)
    monkeypatch.setattr(settings, "llm_task_models", {"llm_judge": LOCAL})
    real = litellm.completion
    monkeypatch.setattr(litellm, "completion", lambda **kw: real(**kw, mock_response="ok"))


@pytest.fixture
def halcyon(client, db, models):
    """Tom, the Organization Administrator of Halcyon Bank, is logged in; Priya is an analyst."""
    organization_id = organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})
    return db.get(Organization, organization_id)


def usage(db, organization_id, task, when=None):
    db.add(
        LLMUsage(
            organization_id=organization_id,
            task=task,
            model=EXTERNAL,
            provider="anthropic",
            deployment="external",
            succeeded=True,
            created_at=when or datetime.now(UTC),
        )
    )
    db.flush()


def judge(db, organization_id):
    return complete(
        db,
        LLMTask.LLM_JUDGE,
        instructions="Rate it.",
        data="hello",
        organization_id=organization_id,
    )


def agent(db, organization_id):
    return complete(
        db,
        LLMTask.ADAPTIVE_TESTING,
        instructions="Refine it.",
        data="hello",
        organization_id=organization_id,
    )


def restrict(client, on=True, password=PASSWORD):
    return client.put(URL, json={"local_models_only": on, "password": password})


def test_the_page_shows_where_each_task_sends_the_data(client, db, halcyon):
    for _ in range(3):
        usage(db, halcyon.id, "adaptive_testing")
    usage(db, halcyon.id, "llm_judge")
    month_start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    usage(db, halcyon.id, "llm_judge", when=month_start - timedelta(days=2))  # last month
    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    other = create(client, "Kestrel Logistics").json()["id"]
    usage(db, other, "adaptive_testing")  # another organization's request
    log_in(client, "tom@example.com")

    body = client.get(URL).json()

    rows = {row["task"]: row for row in body["tasks"]}
    assert list(rows) == [
        "adaptive_testing",
        "llm_judge",
        "threat_modeling",
        "remediation",
        "assistant",
    ]
    assert (rows["adaptive_testing"]["provider"], rows["adaptive_testing"]["model"]) == (
        "Anthropic",
        "claude-sonnet-5-5",
    )
    assert rows["adaptive_testing"]["deployment"] == "external"
    assert (rows["llm_judge"]["provider"], rows["llm_judge"]["deployment"]) == ("Ollama", "local")
    assert rows["llm_judge"]["receives"] == "Masked attempts and replies"
    assert {t: r["requests_this_month"] for t, r in rows.items()} == {
        "adaptive_testing": 3,
        "llm_judge": 1,
        "threat_modeling": 0,
        "remediation": 0,
        "assistant": 0,
    }
    assert body["local_models_only"] is False
    assert all(row["available"] for row in rows.values())
    assert [t for t, r in rows.items() if not r["local_model"]] == [
        "adaptive_testing",
        "threat_modeling",
        "remediation",
        "assistant",
    ]
    assert (
        body["masking"] == "Secrets and personal data are masked before any request leaves Sentra."
    )


def test_only_organization_administrators_open_the_page(client, db, halcyon):
    log_in(client, "priya@example.com")

    assert client.get(URL).status_code == 403
    assert restrict(client).status_code == 403


def test_restricting_needs_the_password(client, db, halcyon):
    response = restrict(client, password="not-my-password")

    assert response.status_code == 422
    assert response.json()["error"]["details"] == [
        {"field": "password", "message": "That password is incorrect."}
    ]
    db.refresh(halcyon)
    assert halcyon.local_models_only is False


def test_local_models_only_applies_to_the_next_request(client, db, halcyon):
    agent(db, halcyon.id)  # works before the change

    body = restrict(client).json()

    assert body["local_models_only"] is True
    available = {row["task"]: row["available"] for row in body["tasks"]}
    assert available == {
        "adaptive_testing": False,
        "llm_judge": True,
        "threat_modeling": False,
        "remediation": False,
        "assistant": False,
    }
    with pytest.raises(LLMUnavailable, match="uses local models only"):
        agent(db, halcyon.id)  # the external model is refused in the LLM layer itself
    assert judge(db, halcyon.id).deployment == "local"  # the local model still serves
    sent = db.scalars(select(LLMUsage.task).where(LLMUsage.organization_id == halcyon.id)).all()
    assert sorted(sent) == ["adaptive_testing", "llm_judge"]  # the refused request never left


def test_another_organization_keeps_its_providers(client, db, halcyon):
    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    other = create(client, "Kestrel Logistics").json()["id"]
    log_in(client, "tom@example.com")

    restrict(client)

    assert agent(db, other).deployment == "external"


def test_the_change_is_recorded_and_the_platform_administrators_are_told(client, db, halcyon):
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()

    restrict(client)

    entry = db.scalars(
        select(AuditLogEntry)
        .where(AuditLogEntry.chain == str(halcyon.id))
        .order_by(AuditLogEntry.seq.desc())
    ).first()
    assert (entry.action, entry.summary) == (
        "data.llm_sharing_changed",
        "Restricted Sentra's AI to local models only",
    )
    assert entry.details["unavailable"] == [
        "Adaptive testing agent",
        "Threat Model generation",
        "Remediation generation",
        "Assistant",
    ]
    assert client.get(URL).json()["changed_by"] == "Tom"
    message = outbox[-1]
    assert (message["To"], message["Subject"]) == (
        "lena@example.com",
        "Sentra: Halcyon Bank uses local models only",
    )


def test_removing_the_restriction_uses_the_providers_again(client, db, halcyon):
    restrict(client)

    body = restrict(client, on=False).json()

    assert body["local_models_only"] is False
    assert agent(db, halcyon.id).deployment == "external"
    summaries = db.scalars(
        select(AuditLogEntry.summary)
        .where(
            AuditLogEntry.chain == str(halcyon.id),
            AuditLogEntry.action == "data.llm_sharing_changed",
        )
        .order_by(AuditLogEntry.seq)
    ).all()
    assert summaries == [
        "Restricted Sentra's AI to local models only",
        "Allowed external LLM providers again",
    ]


def test_saving_the_same_setting_again_records_nothing(client, db, halcyon):
    restrict(client)
    restrict(client)

    count = len(
        db.scalars(
            select(AuditLogEntry).where(
                AuditLogEntry.chain == str(halcyon.id),
                AuditLogEntry.action == "data.llm_sharing_changed",
            )
        ).all()
    )
    assert count == 1
