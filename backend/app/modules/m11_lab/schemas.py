"""What the Security Lab page sends and receives (Screen 65, FR-11.2)."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class KnownVulnerability(BaseModel):
    """One documented weakness of a lab target, as the application itself reports it (FR-11.1)."""

    id: str
    title: str
    category: str  # the OWASP LLM category, e.g. "LLM01"
    description: str


class LabCardOut(BaseModel):
    key: str
    name: str
    about: str
    type: str
    memory_mb: int
    minutes: int  # roughly how long deploying takes
    deployed: bool
    target_id: uuid.UUID | None
    state: str | None  # "ready", "resetting" or "not_ready"
    state_label: str
    status: str | None  # the target's own status (UC-2.3)
    vulnerabilities: int
    categories: list[str]
    canaries: int
    last_reset_at: datetime | None
    resets: int
    last_error: str | None
    active_run: str | None  # the campaign run that is using it (UC-11.2, 1a)


class LabOut(BaseModel):
    cards: list[LabCardOut]
    isolation: str


# ---------------------------------------------------------------- benchmark runs (FR-11.3)


class StrategyIn(BaseModel):
    """One testing strategy of UC-11.3 step 2: test suites, with or without the adaptive agent."""

    key: str = Field(min_length=1, max_length=20)
    name: str = Field(default="", max_length=120)
    suites: list[str] = Field(min_length=1, max_length=30)
    adaptive_agent: bool = False


class BenchmarkIn(BaseModel):
    name: str = Field(default="", max_length=200)
    target_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
    strategies: list[StrategyIn] = Field(min_length=2, max_length=6)
    attempt_budget: int = Field(ge=10, le=20_000)
    repetitions: int = Field(ge=1, le=20)
    judge_every_attempt: bool = False
    # UC-11.3, 1a: this run repeats an earlier one after remediations were deployed
    baseline_code: str | None = Field(default=None, max_length=20)


class EstimateOut(BaseModel):
    runs: int
    attempts: int
    llm_cost_low_usd: Decimal | None
    llm_cost_high_usd: Decimal | None
    minutes: int
    # UC-11.3, 5a1: the monthly limits this experiment would pass (FR-10.4)
    warnings: list[str]


class StrategyOut(BaseModel):
    key: str
    name: str
    suites: list[str]
    adaptive_agent: bool


class RepetitionOut(BaseModel):
    id: uuid.UUID
    target_id: uuid.UUID
    target_name: str
    strategy_key: str
    repetition: int
    order_no: int
    status: str
    reason: str | None
    campaign_run_id: uuid.UUID | None
    started_at: datetime | None
    ended_at: datetime | None
    attempts_sent: int
    cost_usd: Decimal


class BenchmarkItem(BaseModel):
    code: str
    name: str
    status: str
    status_message: str
    strategies: list[StrategyOut]
    attempt_budget: int
    repetitions: int
    judge_every_attempt: bool
    baseline_code: str | None
    lab_targets: list[str]
    runs_total: int
    runs_done: int
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None


class BenchmarkDetail(BenchmarkItem):
    estimate: dict
    versions: dict
    order_seed: int | None
    repetition_rows: list[RepetitionOut]
