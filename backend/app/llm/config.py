"""Which model does which task (FR-10.3, NFR-7.3).

A model is named the LiteLLM way, "provider/model": "anthropic/claude-sonnet-5-5",
"openai/gpt-5" or "ollama_chat/llama3.1". Changing it is a change of configuration only, never of
code.

A Platform Administrator configures the providers and assigns a model to each task on Screen 62
(UC-10.4), and `model_for()` reads that assignment at every request. When a task has none — a
fresh installation, or a deployment that configures Sentra through its environment only — the
settings `LLM_MODEL` and `LLM_TASK_MODELS` still decide, as they did before FR-10.3.
"""

import ipaddress
import uuid
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core import addresses, crypto
from app.core.config import get_settings
from app.llm.models import LLMProviderModel, LLMTaskModel, key_context


class LLMTask(StrEnum):
    """The tasks of Sentra's own AI (report: class diagram of Audit & Administration)."""

    ADAPTIVE_TESTING = "adaptive_testing"  # FR-5.5
    LLM_JUDGE = "llm_judge"  # FR-6.1
    THREAT_MODELING = "threat_modeling"  # FR-3.1
    REMEDIATION = "remediation"  # FR-8.1
    ASSISTANT = "assistant"  # the chat assistant that guides people and does their work for them


TASK_LABELS = {
    LLMTask.ASSISTANT: "the assistant",
    LLMTask.ADAPTIVE_TESTING: "the adaptive testing agent",
    LLMTask.LLM_JUDGE: "the LLM judge",
    LLMTask.THREAT_MODELING: "threat model generation",
    LLMTask.REMEDIATION: "remediation proposals",
}
CONNECTION_TEST = "connection_test"  # the task name a test request is recorded under


class Deployment(StrEnum):
    EXTERNAL = "external"  # a commercial API: the data leaves the platform
    LOCAL = "local"  # a model running on the platform, e.g. through Ollama


class ProviderKind(StrEnum):
    """What Screen 62's "Add provider" panel offers. The LiteLLM provider of each is `PREFIXES`."""

    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    OLLAMA = "ollama"
    OPENAI_COMPATIBLE = "openai_compatible"  # any server that speaks the OpenAI API


# The LiteLLM provider a kind is called through. Ollama's chat endpoint, because the layer only
# ever sends chat messages; an OpenAI-compatible server is reached as "openai" plus its base URL.
PREFIXES = {
    ProviderKind.ANTHROPIC: "anthropic",
    ProviderKind.OPENAI: "openai",
    ProviderKind.OLLAMA: "ollama_chat",
    ProviderKind.OPENAI_COMPATIBLE: "openai",
}
# LiteLLM providers that run on the platform itself.
LOCAL_PROVIDERS = {"ollama", "ollama_chat", "hosted_vllm", "lm_studio", "llamafile"}
# A kind that reaches a server the platform operator runs, so it needs its address.
NEEDS_BASE_URL = {ProviderKind.OLLAMA, ProviderKind.OPENAI_COMPATIBLE}
# A kind that reaches a commercial API, so it needs a key.
NEEDS_API_KEY = {ProviderKind.ANTHROPIC, ProviderKind.OPENAI}


@dataclass(frozen=True)
class ModelChoice:
    model: str  # the LiteLLM name, "<prefix>/<model>"
    provider: str  # the LiteLLM provider, e.g. "anthropic"
    deployment: Deployment
    label: str = ""  # the model as a person calls it, e.g. "Claude Sonnet"
    provider_label: str = ""  # the provider as the page shows it, e.g. "Anthropic"
    base_url: str | None = None
    api_key: str | None = None  # never logged, never recorded, never sent to the browser
    provider_id: uuid.UUID | None = None  # None when the settings decided


def deployment_for(prefix: str, base_url: str | None) -> Deployment:
    """Local only when the requests stay on the platform, decided once, when a provider is saved
    (UC-10.4 step 5), so no request has to resolve a host name afterwards.

    The address decides when there is one: a loopback or private address is on the platform, a
    public one is not — an "Ollama" that someone points at a public host is external, because the
    organization's data does leave the platform. Without an address, the LiteLLM provider decides,
    as it did before FR-10.3. A host that cannot be resolved counts as external, the safer
    assumption of the two.
    """
    parts = urlsplit(base_url or "")
    if not parts.hostname:
        return Deployment.LOCAL if prefix in LOCAL_PROVIDERS else Deployment.EXTERNAL
    try:
        ipaddress.ip_address(parts.hostname)
        found = [parts.hostname]
    except ValueError:
        try:
            found = addresses.resolve(parts.hostname, parts.port or 443)
        except OSError:
            return Deployment.EXTERNAL
    return Deployment.EXTERNAL if all(map(addresses.is_public, found)) else Deployment.LOCAL


def choice_of(model: LLMProviderModel) -> ModelChoice:
    """The configured model as the layer uses it, with its provider's address and key."""
    provider = model.provider
    return ModelChoice(
        model=f"{provider.prefix}/{model.name}",
        provider=provider.prefix,
        deployment=Deployment(provider.deployment),
        label=model.label,
        provider_label=provider.name,
        base_url=provider.base_url,
        api_key=(
            crypto.decrypt(provider.api_key_encrypted, key_context(provider.id))
            if provider.api_key_encrypted
            else None
        ),
        provider_id=provider.id,
    )


def assigned(db: Session, task: LLMTask) -> LLMProviderModel | None:
    """The model a Platform Administrator assigned to the task, if any (UC-10.4 step 4)."""
    return db.scalar(
        select(LLMProviderModel)
        .join(LLMTaskModel, LLMTaskModel.provider_model_id == LLMProviderModel.id)
        .options(joinedload(LLMProviderModel.provider))
        .where(LLMTaskModel.task == task)
    )


def from_settings(task: LLMTask) -> ModelChoice | None:
    """The model the environment names for the task, used while no provider is configured."""
    settings = get_settings()
    name = (settings.llm_task_models.get(task) or settings.llm_model).strip()
    if not name:
        return None
    prefix = name.split("/", 1)[0] if "/" in name else ""
    return ModelChoice(
        model=name,
        provider=prefix or "unknown",
        deployment=Deployment.LOCAL if prefix in LOCAL_PROVIDERS else Deployment.EXTERNAL,
        base_url=settings.llm_api_base or None,
    )


def model_for(db: Session, task: LLMTask, *, local_only: bool = False) -> ModelChoice | None:
    """The model configured for a task, or None when there is none. With `local_only` (an
    organization that uses local models only, UC-10.5), only a model on the platform counts."""
    model = assigned(db, task)
    choice = choice_of(model) if model is not None else from_settings(task)
    if choice is None or (local_only and choice.deployment != Deployment.LOCAL):
        return None
    return choice
