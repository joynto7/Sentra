"""The LLM layer (NFR-7.3): every request of Sentra's own AI to a model goes through complete()."""

from app.llm.config import Deployment, LLMTask, ModelChoice, model_for
from app.llm.layer import (
    Completion,
    LLMError,
    LLMOutputError,
    LLMUnavailable,
    complete,
    connection_test,
)

__all__ = [
    "Completion",
    "Deployment",
    "LLMError",
    "LLMOutputError",
    "LLMTask",
    "LLMUnavailable",
    "ModelChoice",
    "complete",
    "connection_test",
    "model_for",
]
