"""What the Security Lab page sends and receives (Screen 65, FR-11.2)."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class KnownVulnerability(BaseModel):
    """One documented weakness of a lab target: as the application itself reports it (FR-11.1),
    or as an analyst documented it after a benchmark found it (UC-11.5, 2a1)."""

    id: str
    title: str
    category: str  # the OWASP LLM category, e.g. "LLM01"
    description: str
    slot: str | None = None  # the canary token it is reached through, in Sentra's words
    component: str | None = None
    source: str = "lab"  # "lab" or "analyst"


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


# ---------------------------------------------------------------- benchmark metrics (FR-11.4)


class FigureOut(BaseModel):
    """One metric of one strategy, as a mean over the repetitions with their spread."""

    key: str
    label: str
    unit: str  # percent, count, minutes, usd or tokens
    mean: float | None
    sd: float | None
    repetitions: int
    values: list[float]
    note: str | None


class MeasureOut(BaseModel):
    id: uuid.UUID
    target_name: str
    repetition: int
    status: str
    reason: str | None
    documented: int
    discovered: int
    findings: int
    false_positives: int
    unlabelled: int
    attempts: int
    successful: int
    minutes: float | None
    tokens: int
    cost_usd: Decimal


class StrategyMetricsOut(BaseModel):
    key: str
    name: str
    suites: list[str]
    adaptive_agent: bool
    completed: int
    incomplete: int
    figures: list[FigureOut]
    rows: list[MeasureOut]


class AgreementOut(BaseModel):
    """The LLM judge alone and the combined detection against the analyst's blind labels."""

    key: str
    label: str
    labelled: int
    unsure: int
    without_verdict: int
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int
    precision: float | None
    recall: float | None
    agreement: float | None


class DocumentedOut(BaseModel):
    target_id: uuid.UUID
    target_name: str
    count: int
    version: int
    added_by_analyst: int


class MatchedOut(BaseModel):
    """A finding of the benchmark run: which documented weakness it matched, or none (step 2)."""

    finding_id: uuid.UUID
    finding_number: int
    known_id: str | None
    category: str
    title: str
    component: str
    label: str | None


class BaselineOut(BaseModel):
    code: str
    name: str
    rows: list[dict]
    note: str


class EvaluationOut(BaseModel):
    code: str
    name: str
    status: str
    ended_at: datetime | None
    ready: bool
    judge_every_attempt: bool
    documented: list[DocumentedOut]
    strategies: list[StrategyMetricsOut]
    agreement: list[AgreementOut]
    unmatched: list[MatchedOut]
    sample_total: int
    sample_labelled: int
    incomplete: int
    missing: list[str]
    baseline: BaselineOut | None


class ToLabelOut(BaseModel):
    """One attempt of the blind sample, with nothing of Sentra's own verdict in it (step 3)."""

    attempt_id: uuid.UUID
    place: int
    total: int
    labelled: int
    target_name: str
    category: str
    test_code: str
    objective: str
    message: str
    reply: str | None
    tool_calls: str | None
    note: str | None
    verdict: str | None
    blind: str


class LabelIn(BaseModel):
    verdict: str = Field(max_length=20)
    note: str | None = Field(default=None, max_length=2000)


class ExportIn(BaseModel):
    """UC-11.6 steps 1-2: the format and how much detail (FR-11.5)."""

    format: str = Field(pattern="^(csv|json)$")
    level: str = Field(pattern="^(strategy|repetition|attempt)$")


class ExportSummary(BaseModel):
    """How many rows each level would write, so the dialog can say it before anything is made."""

    strategy: int
    repetition: int
    attempt: int
    labels: int
