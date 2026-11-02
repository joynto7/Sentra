"""LLM providers and the model of each task (FR-10.3, UC-10.4, Screen 62), for Platform
Administrators. Module 10's operations part (Joynto); the governance part is in
`governance_routes.py` and `user_admin.py` (Azizul).

The providers themselves live in the LLM layer (`app/llm/models.py`), which is where their keys
are stored and where every request reads the assignment, so no module can reach a model another
way (NFR-7.3). This file is what the page does with them: add a provider after a connection test,
test one again, add a model, remove a provider, and assign a model to a task.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import audit, crypto
from app.core.addresses import AddressNotAllowed, check_url
from app.core.errors import AppError, ConflictError, FieldValidationError, NotFoundError
from app.llm import layer
from app.llm.config import (
    NEEDS_API_KEY,
    NEEDS_BASE_URL,
    PREFIXES,
    Deployment,
    LLMTask,
    ModelChoice,
    ProviderKind,
    assigned,
    deployment_for,
)
from app.llm.models import LLMProvider, LLMProviderModel, LLMTaskModel, key_context
from app.modules.m01_users.models import User

# The tasks as the page names them, in the order of Screen 62's assignment table.
FUNCTIONS = {
    LLMTask.ADAPTIVE_TESTING: "Adaptive testing agent",
    LLMTask.LLM_JUDGE: "LLM judge",
    LLMTask.THREAT_MODELING: "Threat Model generation",
    LLMTask.REMEDIATION: "Remediation generation",
}
KINDS = {
    ProviderKind.ANTHROPIC: "Anthropic",
    ProviderKind.OPENAI: "OpenAI",
    ProviderKind.OLLAMA: "Ollama",
    ProviderKind.OPENAI_COMPATIBLE: "OpenAI-compatible",
}
# UC-10.4 step 6 and the note of Screen 62.
RECORDED = "Every campaign run records the provider and model used for each task."
# UC-10.4, 4a1 (NFR-9.5): a new judge decides what counts as a finding, so it is checked first.
CHECK_THE_JUDGE = (
    "Check the new judge on the lab targets (Security Lab) before campaigns rely on it."
)
NO_KEY = "Enter the provider's API key."
NO_BASE_URL = "Enter the address of the server, for example http://ollama:11434."
NO_MODELS = "Add at least one model, for example llama3.1:8b."
DUPLICATE_MODEL = "This provider already has a model with that name."
KEY_NOT_NEEDED = "A server on the platform needs no API key."


class TestFailed(AppError):
    """UC-10.4, 3a1: the test request failed, so nothing was saved and the previous
    configuration stays in use."""

    status_code = 422
    code = "connection_test_failed"

    def __init__(self, error: str, kept: str) -> None:
        super().__init__(f"Test failed: {error.rstrip('.')}. The {kept} was not saved.")


@dataclass
class ModelRow:
    id: uuid.UUID
    name: str
    label: str
    tasks: list[str] = field(default_factory=list)  # the functions this model serves


@dataclass
class ProviderRow:
    id: uuid.UUID
    name: str
    kind: str
    kind_label: str
    prefix: str
    base_url: str | None
    deployment: str
    has_api_key: bool
    models: list[ModelRow]
    tested_at: datetime | None
    test_reply: str | None
    test_duration_ms: int | None
    test_cost_usd: Decimal | None
    tasks: list[str]  # the functions this provider serves, for 5a1 and the cards


@dataclass
class AssignmentRow:
    task: str
    function: str
    model_id: uuid.UUID | None
    model: str | None  # as a person calls it, e.g. "Claude Sonnet"
    provider: str | None
    deployment: str | None
    since: datetime | None
    note: str  # what the row warns about, e.g. the judge's recommendation


@dataclass
class TestResult:
    ok: bool
    model: str
    reply: str | None
    duration_ms: int
    cost_usd: Decimal
    error: str | None


@dataclass
class Configuration:
    providers: list[ProviderRow]
    assignments: list[AssignmentRow]
    recorded: str = RECORDED


@dataclass
class NewModel:
    name: str
    label: str = ""


@dataclass
class NewProvider:
    kind: ProviderKind
    name: str = ""
    base_url: str = ""
    api_key: str = ""
    models: list[NewModel] = field(default_factory=list)


# ---------------------------------------------------------------- reading


def _providers(db: Session) -> list[LLMProvider]:
    return list(
        db.scalars(
            select(LLMProvider)
            .options(selectinload(LLMProvider.models))
            .order_by(LLMProvider.created_at)
        )
    )


def _in_use(db: Session) -> dict[uuid.UUID, list[str]]:
    """The functions each configured model serves, so a card can show them and a removal can be
    refused (UC-10.4, 5a1)."""
    rows = db.execute(select(LLMTaskModel.provider_model_id, LLMTaskModel.task)).all()
    found: dict[uuid.UUID, list[str]] = {}
    for model_id, task in rows:
        found.setdefault(model_id, []).append(FUNCTIONS[LLMTask(task)])
    return found


def _provider_row(provider: LLMProvider, in_use: dict[uuid.UUID, list[str]]) -> ProviderRow:
    models = [
        ModelRow(id=m.id, name=m.name, label=m.label, tasks=in_use.get(m.id, []))
        for m in provider.models
    ]
    return ProviderRow(
        id=provider.id,
        name=provider.name,
        kind=provider.kind,
        kind_label=KINDS[ProviderKind(provider.kind)],
        prefix=provider.prefix,
        base_url=provider.base_url,
        deployment=provider.deployment,
        has_api_key=provider.has_api_key,
        models=models,
        tested_at=provider.tested_at,
        test_reply=provider.test_reply,
        test_duration_ms=provider.test_duration_ms,
        test_cost_usd=provider.test_cost_usd,
        tasks=[function for model in models for function in model.tasks],
    )


def row_of(db: Session, provider: LLMProvider) -> ProviderRow:
    """One provider as the page shows it."""
    return _provider_row(provider, _in_use(db))


def configuration(db: Session) -> Configuration:
    """Screen 62: every provider with its models and last test, and the model of each task."""
    in_use = _in_use(db)
    return Configuration(
        providers=[_provider_row(provider, in_use) for provider in _providers(db)],
        assignments=assignments(db),
    )


def assignments(db: Session) -> list[AssignmentRow]:
    """UC-10.4 step 4: one row per task of Sentra's own AI, in the order of the screen."""
    rows = []
    for task in LLMTask:
        model = assigned(db, task)
        row = db.get(LLMTaskModel, task)
        rows.append(
            AssignmentRow(
                task=task,
                function=FUNCTIONS[task],
                model_id=model.id if model else None,
                model=model.label if model else None,
                provider=model.provider.name if model else None,
                deployment=model.provider.deployment if model else None,
                since=row.since if row else None,
                note=CHECK_THE_JUDGE if task == LLMTask.LLM_JUDGE else "",
            )
        )
    return rows


# ---------------------------------------------------------------- the connection test


def _checked(data: NewProvider) -> tuple[str, str | None]:
    """The LiteLLM provider and the base URL of a new provider, with what the panel must still
    fill in (UC-10.4 step 2)."""
    kind = ProviderKind(data.kind)
    prefix = PREFIXES[kind]
    url = data.base_url.strip()
    if kind in NEEDS_BASE_URL and not url:
        raise FieldValidationError("base_url", NO_BASE_URL)
    if kind in NEEDS_API_KEY and not data.api_key.strip():
        raise FieldValidationError("api_key", NO_KEY)
    if url:
        try:
            # A model server usually runs inside the platform's own network, so a private address
            # is what this check normally sees; the connector's rule for targets is the opposite.
            url = check_url(url, allow_private=True)
        except AddressNotAllowed as exc:
            raise FieldValidationError("base_url", str(exc)) from exc
    return prefix, url or None


def _choice(data: NewProvider, model: NewModel) -> ModelChoice:
    prefix, url = _checked(data)
    return ModelChoice(
        model=f"{prefix}/{model.name.strip()}",
        provider=prefix,
        deployment=deployment_for(prefix, url),
        label=model.label.strip() or model.name.strip(),
        provider_label=data.name.strip() or KINDS[ProviderKind(data.kind)],
        base_url=url,
        api_key=data.api_key.strip() or None,
    )


def _test(db: Session, choice: ModelChoice) -> TestResult:
    """UC-10.4 step 3 and 3a: the harmless request and what it answered, or why it failed."""
    try:
        reply = layer.connection_test(db, choice)
    except layer.LLMError as exc:
        return TestResult(
            ok=False,
            model=choice.model,
            reply=None,
            duration_ms=0,
            cost_usd=Decimal(0),
            error=str(exc),
        )
    return TestResult(
        ok=True,
        model=choice.model,
        reply=reply.text.strip()[:500],
        duration_ms=reply.duration_ms,
        cost_usd=reply.cost_usd,
        error=None,
    )


def test_new(db: Session, data: NewProvider) -> TestResult:
    """ "Test connection" of the "Add provider" panel: the first model is what it asks with."""
    if not data.models:
        raise FieldValidationError("models", NO_MODELS)
    return _test(db, _choice(data, data.models[0]))


def test_saved(db: Session, provider_id: uuid.UUID, model_id: uuid.UUID | None) -> TestResult:
    """The test panel of a provider that is already configured. The stored key is used, and the
    result is kept on the provider, so the card can show "Last test: OK · 412 ms"."""
    provider = _provider(db, provider_id)
    model = _model_of(provider, model_id)
    result = _test(db, _saved_choice(provider, model.name, model.label))
    _remember(db, provider, result)
    db.commit()
    return result


def _saved_choice(provider: LLMProvider, name: str, label: str) -> ModelChoice:
    """How the layer reaches one model of a configured provider, with its stored key."""
    return ModelChoice(
        model=f"{provider.prefix}/{name}",
        provider=provider.prefix,
        deployment=Deployment(provider.deployment),
        label=label,
        provider_label=provider.name,
        base_url=provider.base_url,
        api_key=(
            crypto.decrypt(provider.api_key_encrypted, key_context(provider.id))
            if provider.api_key_encrypted
            else None
        ),
        provider_id=provider.id,
    )


def _remember(db: Session, provider: LLMProvider, result: TestResult) -> None:
    provider.tested_at = datetime.now(UTC)
    provider.test_reply = result.reply if result.ok else result.error
    provider.test_duration_ms = result.duration_ms if result.ok else None
    provider.test_cost_usd = result.cost_usd if result.ok else None


# ---------------------------------------------------------------- changing the configuration


def add(db: Session, admin: User, data: NewProvider) -> LLMProvider:
    """UC-10.4 steps 1-3 and 5, and 3a1: the provider is saved only after its test request
    succeeded, so nothing untested can serve a task. The key is encrypted with the new row's own
    id as its context, never written to the audit log and never sent to a browser again."""
    if not data.models:
        raise FieldValidationError("models", NO_MODELS)
    names = [model.name.strip() for model in data.models]
    if not all(names):
        raise FieldValidationError("models", NO_MODELS)
    if len(set(names)) != len(names):
        raise FieldValidationError("models", DUPLICATE_MODEL)
    kind = ProviderKind(data.kind)
    if kind == ProviderKind.OLLAMA and data.api_key.strip():
        raise FieldValidationError("api_key", KEY_NOT_NEEDED)

    result = test_new(db, data)
    if not result.ok:
        raise TestFailed(result.error or "", "provider")

    prefix, url = _checked(data)
    provider = LLMProvider(
        id=uuid.uuid4(),
        name=data.name.strip() or KINDS[kind],
        kind=kind,
        prefix=prefix,
        base_url=url,
        deployment=deployment_for(prefix, url),
        added_by_id=admin.id,
    )
    if data.api_key.strip():
        provider.api_key_encrypted = crypto.encrypt(data.api_key.strip(), key_context(provider.id))
    _remember(db, provider, result)
    provider.models = [
        LLMProviderModel(name=model.name.strip(), label=model.label.strip() or model.name.strip())
        for model in data.models
    ]
    db.add(provider)
    audit.record(
        db,
        organization_id=None,
        actor=admin,
        action="platform.llm_provider_added",
        summary=f"Added the LLM provider {provider.name}",
        item=audit.Item("llm_provider", provider.id, provider.name),
        details={
            "kind": provider.kind,
            "deployment": provider.deployment,
            "base_url": provider.base_url,
            "models": names,
        },
    )
    db.commit()
    return provider


def add_model(
    db: Session, admin: User, provider_id: uuid.UUID, model: NewModel
) -> LLMProviderModel:
    """A model of a provider that is already configured, kept only when a request to it works."""
    provider = _provider(db, provider_id)
    name = model.name.strip()
    if not name:
        raise FieldValidationError("name", NO_MODELS)
    if any(existing.name == name for existing in provider.models):
        raise FieldValidationError("name", DUPLICATE_MODEL)

    result = _test(db, _saved_choice(provider, name, model.label.strip() or name))
    _remember(db, provider, result)
    db.commit()
    if not result.ok:
        raise TestFailed(result.error or "", "model")

    added = LLMProviderModel(provider_id=provider.id, name=name, label=model.label.strip() or name)
    db.add(added)
    audit.record(
        db,
        organization_id=None,
        actor=admin,
        action="platform.llm_model_added",
        summary=f"Added the model {added.label} to {provider.name}",
        item=audit.Item("llm_provider", provider.id, provider.name),
        details={"model": name},
    )
    db.commit()
    return added


def remove(db: Session, admin: User, provider_id: uuid.UUID) -> None:
    """UC-10.4, 5a1: a provider a task still uses is not removed; another model must be assigned
    to that task first. Its key goes with it."""
    provider = _provider(db, provider_id)
    in_use = _in_use(db)
    tasks = [function for model in provider.models for function in in_use.get(model.id, [])]
    if tasks:
        raise ConflictError(
            f"{provider.name} still serves {', '.join(tasks)}. Assign another model to "
            f"{'them' if len(tasks) > 1 else 'it'} first.",
            code="provider_in_use",
        )
    audit.record(
        db,
        organization_id=None,
        actor=admin,
        action="platform.llm_provider_removed",
        summary=f"Removed the LLM provider {provider.name}",
        item=audit.Item("llm_provider", provider.id, provider.name),
        details={"kind": provider.kind, "deployment": provider.deployment},
    )
    db.delete(provider)
    db.commit()


def assign(db: Session, admin: User, task: LLMTask, model_id: uuid.UUID) -> AssignmentRow:
    """UC-10.4 step 4 and 4a1: the model of one task, from now on. New requests use it at once,
    because the layer reads the assignment at every request."""
    model = db.get(LLMProviderModel, model_id)
    if model is None:
        raise NotFoundError("This model is not configured.")
    row = db.get(LLMTaskModel, task)
    before = row.model.label if row else None
    if row is None:
        db.add(LLMTaskModel(task=task, provider_model_id=model.id, assigned_by_id=admin.id))
    elif row.provider_model_id != model.id:
        row.provider_model_id = model.id
        row.assigned_by_id = admin.id
        row.since = datetime.now(UTC)
    audit.record(
        db,
        organization_id=None,
        actor=admin,
        action="platform.llm_model_assigned",
        summary=f"{FUNCTIONS[task]} now uses {model.label} ({model.provider.name})",
        item=audit.Item("llm_provider", model.provider_id, model.provider.name),
        details={
            "task": task,
            "before": before,
            "after": model.label,
            "deployment": model.provider.deployment,
        },
    )
    db.commit()
    return next(row for row in assignments(db) if row.task == task)


def _provider(db: Session, provider_id: uuid.UUID) -> LLMProvider:
    provider = db.get(LLMProvider, provider_id)
    if provider is None:
        raise NotFoundError("This provider is not configured.")
    return provider


def _model_of(provider: LLMProvider, model_id: uuid.UUID | None) -> LLMProviderModel:
    if model_id is None:
        if not provider.models:
            raise NotFoundError("This provider has no model to test with.")
        return provider.models[0]
    found = next((model for model in provider.models if model.id == model_id), None)
    if found is None:
        raise NotFoundError("This provider has no such model.")
    return found


def task_of(name: str) -> LLMTask:
    try:
        return LLMTask(name)
    except ValueError as exc:
        raise NotFoundError(f"Sentra has no task called {name}.") from exc
