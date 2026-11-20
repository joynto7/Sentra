"""Which model does which task (NFR-7.3).

A model is named the LiteLLM way, "provider/model": "anthropic/claude-sonnet-5-5",
"openai/gpt-5" or "ollama/llama3.1". Changing it is a change of settings only, never of code.
For now the settings hold the choice; FR-10.3 (Sprint 4) moves it into the database with a page
for Platform Administrators, and the rest of the layer stays as it is.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.core.config import get_settings


class LLMTask(StrEnum):
    """The tasks of Sentra's own AI (report: class diagram of Audit & Administration)."""

    ADAPTIVE_TESTING = "adaptive_testing"  # FR-5.5
    LLM_JUDGE = "llm_judge"  # FR-6.1
    THREAT_MODELING = "threat_modeling"  # FR-3.1
    REMEDIATION = "remediation"  # FR-8.1


TASK_LABELS = {
    LLMTask.ADAPTIVE_TESTING: "the adaptive testing agent",
    LLMTask.LLM_JUDGE: "the LLM judge",
    LLMTask.THREAT_MODELING: "threat model generation",
    LLMTask.REMEDIATION: "remediation proposals",
}


class Deployment(StrEnum):
    EXTERNAL = "external"  # a commercial API: the data leaves the platform
    LOCAL = "local"  # a model running on the platform, e.g. through Ollama


# LiteLLM providers that run on the platform itself.
LOCAL_PROVIDERS = {"ollama", "ollama_chat", "hosted_vllm", "lm_studio", "llamafile"}


@dataclass(frozen=True)
class ModelChoice:
    model: str  # the LiteLLM name
    provider: str
    deployment: Deployment


def model_for(task: LLMTask) -> ModelChoice | None:
    """The model configured for a task, or None when there is none."""
    settings = get_settings()
    name = (settings.llm_task_models.get(task) or settings.llm_model).strip()
    if not name:
        return None
    provider = name.split("/", 1)[0] if "/" in name else ""
    deployment = Deployment.LOCAL if provider in LOCAL_PROVIDERS else Deployment.EXTERNAL
    return ModelChoice(model=name, provider=provider or "unknown", deployment=deployment)
