"""What the Platform Administrator's operations pages send and receive (Screens 61-63). Module 10
has two owners, so these schemas are separate from the governance ones in `schemas.py`."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.llm.config import ProviderKind

MODEL_NAME = Field(min_length=1, max_length=120)


class NewModelIn(BaseModel):
    """A model of a provider, named the provider's own way, e.g. "llama3.1:8b"."""

    name: str = MODEL_NAME
    label: str = Field(default="", max_length=120)  # e.g. "Llama 3.1 8B"


class ProviderIn(BaseModel):
    """The "Add provider" panel of Screen 62 (UC-10.4 steps 1-2)."""

    kind: ProviderKind
    name: str = Field(default="", max_length=80)
    base_url: str = Field(default="", max_length=300)
    api_key: str = Field(default="", max_length=400)  # stored encrypted, never sent back
    models: list[NewModelIn] = Field(default_factory=list, max_length=20)


class AssignmentIn(BaseModel):
    provider_model_id: uuid.UUID


class ModelOut(BaseModel):
    id: uuid.UUID
    name: str
    label: str
    tasks: list[str]  # the functions this model serves


class ProviderOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    kind_label: str
    prefix: str
    base_url: str | None
    deployment: str  # "external" or "local"
    has_api_key: bool  # the key itself is never sent (UC-10.4 quality requirement 2)
    models: list[ModelOut]
    tested_at: datetime | None
    test_reply: str | None
    test_duration_ms: int | None
    test_cost_usd: Decimal | None
    tasks: list[str]


class AssignmentOut(BaseModel):
    task: str
    function: str
    model_id: uuid.UUID | None
    model: str | None
    provider: str | None
    deployment: str | None
    since: datetime | None
    note: str


class TestResultOut(BaseModel):
    ok: bool
    model: str
    reply: str | None
    duration_ms: int
    cost_usd: Decimal
    error: str | None


class LLMConfigurationOut(BaseModel):
    providers: list[ProviderOut]
    assignments: list[AssignmentOut]
    recorded: str  # UC-10.4 step 6, the note on the page
