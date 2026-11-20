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


# ---------------------------------------------------------------- usage and cost limits (UC-10.6)


class LimitsIn(BaseModel):
    """The "Edit limits" panel of Screen 61 (UC-10.6 steps 2-3)."""

    campaign_runs: int = Field(ge=0, le=100_000)
    attempts: int = Field(ge=0, le=100_000_000)
    llm_cost_usd: Decimal = Field(ge=0, le=1_000_000, decimal_places=2)
    warn_percent: int = Field(ge=50, le=99)
    # UC-10.6, 2a1: the administrator has read what a limit below this month's usage means
    confirmed: bool = False


class LimitOut(BaseModel):
    kind: str  # "campaign_runs", "attempts" or "llm_cost"
    label: str
    used: Decimal
    limit: Decimal
    percent: int
    reached: bool
    warning: bool
    custom: bool  # set for this organization; otherwise the platform's default
    warned_at: datetime | None


class OrganizationUsageOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    members: int
    warn_percent: int
    warn_percent_custom: bool
    limits: list[LimitOut]
    status: str  # "active" or "limited"
    next_month: str


class UsageOverviewOut(BaseModel):
    organizations: list[OrganizationUsageOut]
    defaults: dict[str, Decimal]
    warn_percent_default: int
    notice: str
    warn_at: str


# ---------------------------------------------------------------- system health (UC-10.9)


class ThresholdsIn(BaseModel):
    """The "Alert thresholds" card of Screen 63 (UC-10.9 step 3)."""

    queue_length: int = Field(ge=1, le=1_000_000)
    error_rate_percent: float = Field(ge=1, le=100)
    worker_load_percent: int = Field(ge=1, le=100)
    storage_percent: int = Field(ge=1, le=100)
    gateway_silence_minutes: int = Field(ge=1, le=1_440)


class ComponentOut(BaseModel):
    key: str
    label: str
    status: str  # "operational", "warning", "alert" or "unknown"
    lines: list[str]  # what the card says about it


class AlertOut(BaseModel):
    id: uuid.UUID
    component: str
    component_label: str
    kind: str
    summary: str
    effect: str
    opened_at: datetime
    last_seen_at: datetime
    repeats: int
    closed_at: datetime | None
    closed_automatically: bool


class ThresholdsOut(BaseModel):
    queue_length: int
    error_rate_percent: float
    worker_load_percent: int
    storage_percent: int
    gateway_silence_minutes: int
    custom: bool  # set by a Platform Administrator, instead of the platform's defaults
    updated_at: datetime | None
    set_by: str | None


class HealthOut(BaseModel):
    status: str
    headline: str
    components: list[ComponentOut]
    open_alerts: list[AlertOut]
    history: list[AlertOut]
    thresholds: ThresholdsOut
    grafana_url: str  # empty when the operator has configured none
    logs_url: str
    notice: str
