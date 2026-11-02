"""FR-10.3 (M10) LLM Provider Configuration: UC-10.4 Configure LLM Provider end to end, with its
alternatives 3a, 4a and 5a, and what the assignment then means for every LLM request (step 6) and
for an organization that uses local models only (UC-10.5).

No request leaves the tests: LiteLLM answers each one with a mock reply, the keys are made-up
strings, and the addresses are example.com and a private address that is never called.
"""

import uuid
from decimal import Decimal

import litellm
import pytest
from sqlalchemy import select

from app.core import addresses, crypto
from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.llm import complete
from app.llm.config import Deployment, LLMTask, model_for
from app.llm.models import LLMProvider, LLMProviderModel, LLMUsage
from app.modules.m01_users.models import User
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import organization_with

URL = "/api/v1/admin/platform/llm"
KEY = "sk-not-a-real-key-0000"
CLOUD = {
    "kind": "anthropic",
    "name": "Anthropic",
    "api_key": KEY,
    "models": [{"name": "claude-sonnet-5-5", "label": "Claude Sonnet"}],
}
PLATFORM = {
    "kind": "ollama",
    "name": "Ollama",
    "base_url": "http://10.0.0.8:11434",
    "models": [{"name": "llama3.1:8b", "label": "Llama 3.1 8B"}],
}


@pytest.fixture
def answers(monkeypatch):
    """What a provider replies. `answers("ready")` returns the requests LiteLLM received; an
    answer of None makes the provider unreachable, as a wrong key would."""
    real = litellm.completion
    sent: list[dict] = []

    def configure(*replies: str | None) -> list[dict]:
        def fake(**kwargs):
            sent.append(kwargs)
            reply = replies[min(len(sent), len(replies)) - 1]
            if reply is None:
                raise RuntimeError("401 Unauthorized")
            return real(**kwargs, mock_response=reply)

        monkeypatch.setattr(litellm, "completion", fake)
        return sent

    return configure


@pytest.fixture(autouse=True)
def _dns(monkeypatch):
    """The tests resolve no host themselves: models.example.com is a public address, every other
    name is one inside the platform's own network."""

    def fake_resolve(host: str, port: int) -> list[str]:
        return ["93.184.215.15"] if host.endswith("example.com") else ["10.0.0.9"]

    monkeypatch.setattr(addresses, "resolve", fake_resolve)


@pytest.fixture(autouse=True)
def _no_settings_model(monkeypatch):
    """The settings name no model, so every test says itself where its model comes from."""
    monkeypatch.setattr(get_settings(), "llm_model", "")
    monkeypatch.setattr(get_settings(), "llm_task_models", {})


@pytest.fixture
def lena(client, db):
    """Lena is a Platform Administrator and has confirmed her password (UC-10.4 step 2)."""
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    log_in(client, "lena@example.com")
    confirm(client)
    return client


def confirm(client) -> None:
    assert (
        client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD}).status_code == 204
    )


def add(client, provider: dict | None = None, **changes):
    return client.post(f"{URL}/providers", json={**(provider or CLOUD), **changes})


def configuration(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200
    return response.json()


def assignment(client, task: str) -> dict:
    return next(row for row in configuration(client)["assignments"] if row["task"] == task)


def model_id(client, provider_name: str, model_name: str) -> str:
    provider = next(p for p in configuration(client)["providers"] if p["name"] == provider_name)
    return next(m["id"] for m in provider["models"] if m["name"] == model_name)


def assign(client, task: str, model: str):
    return client.put(f"{URL}/tasks/{task}", json={"provider_model_id": model})


def field_of(response) -> str:
    return response.json()["error"]["details"][0]["field"]


def actions(db) -> list[str]:
    return list(
        db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.chain == "platform")
            .order_by(AuditLogEntry.seq)
        )
    )


# ---------------------------------------------------------------- adding a provider (steps 1-3, 5)


def test_a_provider_is_added_after_its_test_request_answered(lena, db, answers):
    sent = answers("ready")

    response = add(lena)

    assert response.status_code == 201
    provider = response.json()
    assert (provider["name"], provider["deployment"], provider["kind_label"]) == (
        "Anthropic",
        "external",
        "Anthropic",
    )
    assert [model["label"] for model in provider["models"]] == ["Claude Sonnet"]
    assert provider["test_reply"] == "ready" and provider["tested_at"] is not None
    # Saving tests the provider itself, so nothing untested is ever kept (3a1).
    assert [request["model"] for request in sent] == ["anthropic/claude-sonnet-5-5"]
    assert actions(db) == ["platform.llm_provider_added"]


def test_the_test_request_carries_the_key_and_the_address_of_the_provider(lena, answers):
    sent = answers("ready")

    assert add(lena, PLATFORM).status_code == 201

    assert sent[-1]["api_base"] == "http://10.0.0.8:11434"
    assert "api_key" not in sent[-1]  # Ollama on the platform needs none
    sent.clear()
    assert add(lena).status_code == 201
    assert sent[-1]["api_key"] == KEY


def test_the_key_is_stored_encrypted_and_never_sent_back(lena, db, answers):
    answers("ready")

    body = add(lena).json()

    stored = db.get(LLMProvider, uuid.UUID(body["id"]))
    assert stored.api_key_encrypted and KEY not in stored.api_key_encrypted
    assert crypto.decrypt(stored.api_key_encrypted, f"llm-provider-key:{stored.id}") == KEY
    assert body["has_api_key"] is True
    assert KEY not in lena.get(URL).text
    entry = db.scalar(select(AuditLogEntry).where(AuditLogEntry.chain == "platform"))
    assert KEY not in str(entry.details)


def test_a_provider_whose_test_request_fails_is_not_saved(lena, db, answers):
    answers(None)

    response = add(lena)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "connection_test_failed"
    assert "401" in error["message"] and "was not saved" in error["message"]
    assert configuration(lena)["providers"] == []
    assert actions(db) == []


def test_the_panel_can_test_a_connection_without_saving_anything(lena, answers):
    answers("ready")

    response = lena.post(f"{URL}/test", json=CLOUD)

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert configuration(lena)["providers"] == []


def test_a_test_request_is_recorded_without_an_organization(lena, db, answers):
    answers("ready")

    lena.post(f"{URL}/test", json=CLOUD)

    usage = db.scalars(select(LLMUsage)).all()
    assert [(row.task, row.organization_id, row.succeeded) for row in usage] == [
        ("connection_test", None, True)
    ]


def test_a_provider_needs_what_it_is_reached_with(lena, answers):
    answers("ready")

    no_key = add(lena, api_key="")
    no_address = add(lena, PLATFORM, base_url="")
    no_model = add(lena, models=[])
    key_for_the_platform = add(lena, PLATFORM, api_key=KEY)

    assert [response.status_code for response in (no_key, no_address, no_model)] == [422] * 3
    assert field_of(no_key) == "api_key"
    assert field_of(no_address) == "base_url"
    assert field_of(no_model) == "models"
    assert key_for_the_platform.status_code == 422


def test_a_provider_on_the_platform_is_local_and_the_same_kind_outside_it_is_not(lena, answers):
    answers("ready")

    inside = add(lena, PLATFORM).json()
    outside = add(
        lena, PLATFORM, name="Ollama in the cloud", base_url="https://models.example.com"
    ).json()

    assert inside["deployment"] == "local"
    assert outside["deployment"] == "external"  # its data leaves the platform after all


def test_an_openai_compatible_server_is_local_only_inside_the_platform(lena, answers):
    answers("ready")

    inside = add(
        lena,
        {
            "kind": "openai_compatible",
            "name": "vLLM",
            "base_url": "http://192.168.10.4:8000/v1",
            "api_key": KEY,
            "models": [{"name": "qwen2.5-14b", "label": "Qwen 2.5 14B"}],
        },
    ).json()
    outside = add(
        lena,
        {
            "kind": "openai_compatible",
            "name": "A hosted service",
            "base_url": "https://models.example.com/v1",
            "api_key": KEY,
            "models": [{"name": "qwen2.5-14b", "label": "Qwen 2.5 14B"}],
        },
    ).json()

    assert (inside["deployment"], outside["deployment"]) == ("local", "external")


# ---------------------------------------------------------------- the models of a provider


def test_one_more_model_is_tested_before_it_is_kept(lena, db, answers):
    answers("ready")
    provider = add(lena, PLATFORM).json()

    answers("ready")
    added = lena.post(
        f"{URL}/providers/{provider['id']}/models",
        json={"name": "qwen2.5:14b", "label": "Qwen 2.5 14B"},
    )
    answers(None)
    refused = lena.post(
        f"{URL}/providers/{provider['id']}/models", json={"name": "not-pulled", "label": ""}
    )

    assert added.status_code == 201 and added.json()["label"] == "Qwen 2.5 14B"
    assert refused.status_code == 422
    assert refused.json()["error"]["message"].endswith("The model was not saved.")
    names = [model["name"] for model in configuration(lena)["providers"][0]["models"]]
    assert names == ["llama3.1:8b", "qwen2.5:14b"]
    assert actions(db) == ["platform.llm_provider_added", "platform.llm_model_added"]


def test_the_same_model_is_not_added_twice(lena, answers):
    answers("ready")
    provider = add(lena, PLATFORM).json()

    again = lena.post(
        f"{URL}/providers/{provider['id']}/models", json={"name": "llama3.1:8b", "label": ""}
    )

    assert again.status_code == 422
    assert field_of(again) == "name"


def test_a_provider_can_be_tested_again_and_the_card_keeps_the_result(lena, answers):
    answers("ready")
    provider = add(lena, PLATFORM).json()

    answers("ready")
    response = lena.post(f"{URL}/providers/{provider['id']}/test")

    assert response.status_code == 200
    card = configuration(lena)["providers"][0]
    assert card["test_reply"] == "ready" and card["tested_at"] is not None
    assert card["test_duration_ms"] is not None and Decimal(card["test_cost_usd"]) == 0


# ---------------------------------------------------------------- assigning a model (step 4, 4a)


def test_a_task_uses_the_assigned_model_from_the_next_request_on(lena, db, answers):
    answers("ready")
    add(lena, PLATFORM)
    model = model_id(lena, "Ollama", "llama3.1:8b")

    response = assign(lena, "llm_judge", model)

    assert response.status_code == 200
    row = response.json()
    assert (row["model"], row["provider"], row["deployment"]) == (
        "Llama 3.1 8B",
        "Ollama",
        "local",
    )
    assert row["since"] is not None
    choice = model_for(db, LLMTask.LLM_JUDGE)
    assert (choice.model, choice.deployment) == ("ollama_chat/llama3.1:8b", Deployment.LOCAL)
    assert model_for(db, LLMTask.REMEDIATION) is None  # one task at a time
    assert actions(db)[-1] == "platform.llm_model_assigned"


def test_the_judge_comes_with_the_recommendation_to_check_it_on_the_lab_targets(lena, answers):
    answers("ready")
    add(lena, PLATFORM)

    row = assign(lena, "llm_judge", model_id(lena, "Ollama", "llama3.1:8b")).json()

    assert "lab targets" in row["note"]
    assert assignment(lena, "remediation")["note"] == ""


def test_an_assignment_replaces_the_one_before_it(lena, db, answers):
    answers("ready")
    add(lena, PLATFORM)
    add(lena)
    assign(lena, "threat_modeling", model_id(lena, "Ollama", "llama3.1:8b"))

    assign(lena, "threat_modeling", model_id(lena, "Anthropic", "claude-sonnet-5-5"))

    assert assignment(lena, "threat_modeling")["model"] == "Claude Sonnet"
    assert model_for(db, LLMTask.THREAT_MODELING).model == "anthropic/claude-sonnet-5-5"
    entry = db.scalars(select(AuditLogEntry).where(AuditLogEntry.chain == "platform")).all()[-1]
    assert (entry.details["before"], entry.details["after"]) == ("Llama 3.1 8B", "Claude Sonnet")


def test_the_settings_still_decide_for_a_task_without_an_assignment(lena, db, answers, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_model", "anthropic/claude-sonnet-5-5")
    answers("ready")
    add(lena, PLATFORM)
    assign(lena, "llm_judge", model_id(lena, "Ollama", "llama3.1:8b"))

    assert model_for(db, LLMTask.LLM_JUDGE).model == "ollama_chat/llama3.1:8b"
    assert model_for(db, LLMTask.REMEDIATION).model == "anthropic/claude-sonnet-5-5"


def test_an_unknown_task_or_model_is_not_assigned(lena, answers):
    answers("ready")
    add(lena, PLATFORM)

    unknown_task = assign(lena, "writing_poems", model_id(lena, "Ollama", "llama3.1:8b"))
    unknown_model = assign(lena, "llm_judge", str(uuid.uuid4()))

    assert (unknown_task.status_code, unknown_model.status_code) == (404, 404)


# ---------------------------------------------------------------- removing a provider (5a)


def test_a_provider_a_task_still_uses_is_not_removed(lena, db, answers):
    answers("ready")
    provider = add(lena, PLATFORM).json()
    assign(lena, "llm_judge", model_id(lena, "Ollama", "llama3.1:8b"))

    refused = lena.delete(f"{URL}/providers/{provider['id']}")

    assert refused.status_code == 409
    assert "LLM judge" in refused.json()["error"]["message"]
    assert db.get(LLMProvider, uuid.UUID(provider["id"])) is not None


def test_a_provider_is_removed_once_no_task_uses_it(lena, db, answers):
    answers("ready")
    provider = add(lena, PLATFORM).json()
    add(lena)
    assign(lena, "llm_judge", model_id(lena, "Ollama", "llama3.1:8b"))
    assign(lena, "llm_judge", model_id(lena, "Anthropic", "claude-sonnet-5-5"))

    removed = lena.delete(f"{URL}/providers/{provider['id']}")

    assert removed.status_code == 204
    assert db.get(LLMProvider, uuid.UUID(provider["id"])) is None
    assert db.scalars(select(LLMProviderModel)).all()  # the other provider's model stayed
    assert actions(db)[-1] == "platform.llm_provider_removed"


# ---------------------------------------------------------------- who may configure a provider


def test_only_platform_administrators_see_or_change_the_providers(client, db, answers):
    organization_with(db, client, {})  # Tom, an Organization Administrator
    confirm(client)

    assert client.get(URL).status_code == 403
    assert add(client).status_code == 403
    assert client.post(f"{URL}/test", json=CLOUD).status_code == 403


def test_changing_the_configuration_needs_the_password_again(client, db, answers):
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    log_in(client, "lena@example.com")
    answers("ready")

    unconfirmed = add(client)

    assert unconfirmed.status_code == 403
    assert unconfirmed.json()["error"]["code"] == "password_confirmation_required"
    assert client.get(URL).status_code == 200  # reading the page does not
    confirm(client)
    assert add(client).status_code == 201


# ---------------------------------------------------------------- what the assignment means


def test_every_request_records_the_provider_and_model_of_its_task(lena, db, answers):
    answers("ready")
    add(lena, PLATFORM)
    assign(lena, "remediation", model_id(lena, "Ollama", "llama3.1:8b"))
    organization_id = organization_with(db, lena, {})

    sent = answers("a proposal")

    reply = complete(
        db,
        LLMTask.REMEDIATION,
        instructions="Write a fix.",
        data="(no data)",
        organization_id=organization_id,
    )

    assert reply.model == "ollama_chat/llama3.1:8b" and reply.deployment == "local"
    assert sent[-1]["api_base"] == "http://10.0.0.8:11434"
    recorded = db.scalars(select(LLMUsage).where(LLMUsage.organization_id == organization_id)).all()
    assert [(row.task, row.model, row.provider, row.deployment) for row in recorded] == [
        ("remediation", "ollama_chat/llama3.1:8b", "ollama_chat", "local")
    ]


def test_local_models_only_uses_the_assigned_local_model_and_refuses_the_external_one(
    lena, db, answers
):
    answers("ready")
    add(lena, PLATFORM)
    add(lena)
    assign(lena, "llm_judge", model_id(lena, "Ollama", "llama3.1:8b"))
    assign(lena, "remediation", model_id(lena, "Anthropic", "claude-sonnet-5-5"))

    assert model_for(db, LLMTask.LLM_JUDGE, local_only=True) is not None
    assert model_for(db, LLMTask.REMEDIATION, local_only=True) is None


def test_the_page_says_that_every_run_records_its_models(lena):
    assert "records the provider and model" in configuration(lena)["recorded"]
