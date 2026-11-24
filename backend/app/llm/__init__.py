"""The LLM layer (NFR-7.3): every request of Sentra's own AI to a model goes through complete()."""

from app.llm.config import Deployment, LLMTask, ModelChoice, model_for
from app.llm.layer import (
    Completion,
    LLMError,
    LLMOutputError,
    LLMUnavailable,
    ToolCall,
    complete,
    connection_test,
    converse,
)

__all__ = [
    "Completion",
    "Deployment",
    "LLMError",
    "LLMOutputError",
    "LLMTask",
    "LLMUnavailable",
    "ModelChoice",
    "ToolCall",
    "complete",
    "connection_test",
    "converse",
    "model_for",
]
