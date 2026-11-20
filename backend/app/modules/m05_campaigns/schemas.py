import uuid
from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ScheduleIn(BaseModel):
    """When the campaign runs (FR-5.3; UC-5.1 step 5). "immediately" saves no schedule: the
    campaign's first run is launched at once instead (step 7)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["immediately", "once", "recurring"]
    frequency: Literal["daily", "weekly", "monthly"] | None = None
    # Once: the moment. Without an offset it is read in the campaign's time zone.
    run_at: datetime | None = None
    at_time: str | None = Field(default=None, max_length=5)  # recurring: "02:00"
    weekday: int | None = Field(default=None, ge=0, le=6)  # weekly: 0 = Monday … 6 = Sunday
    day_of_month: int | None = Field(default=None, ge=1, le=28)  # monthly


class ScheduleOut(BaseModel):
    """The campaign's schedule, with what came of its last moment (Screens 33 and 35)."""

    kind: str
    frequency: str | None
    run_at: datetime | None
    at_time: time | None
    weekday: int | None
    day_of_month: int | None
    status: str  # active, paused, or finished for a schedule that has had its one moment
    summary: str  # in words: "Every Monday at 02:00 (Asia/Dhaka)"
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_result: str | None  # launched, skipped or missed
    last_message: str
    last_run: str | None  # the run it launched, e.g. R-238-2
    created_by: str | None  # whose permissions its runs use (UC-5.3, 1a1)


class CampaignIn(BaseModel):
    """The campaign builder (Screen 34). The service checks it and names each problem."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=200)
    target_id: uuid.UUID | None = None
    suites: list[str] = Field(default_factory=list, max_length=50)
    adaptive_agent: bool = False
    attempt_budget: int | None = None
    request_rate: int | None = None
    repetitions: int | None = 5
    window_start: str | None = Field(default=None, max_length=5)  # "02:00"
    window_end: str | None = Field(default=None, max_length=5)
    time_zone: str = Field(default="UTC", max_length=64)  # the browser's, e.g. Asia/Dhaka
    schedule: ScheduleIn | None = None  # UC-5.1 step 5; without it the campaign waits


class EstimateIn(BaseModel):
    target_id: uuid.UUID | None = None
    suites: list[str] = Field(default_factory=list, max_length=50)
    attempt_budget: int | None = None


class ThreatModelBrief(BaseModel):
    """UC-5.1 step 2: the target's approved threat model (FR-3.4)."""

    version: int
    approved_at: datetime | None
    approved_by: str | None
    default_suites: list[str]  # preselected in the builder
    threats_total: int
    threats_covered: int  # by the tests of the chosen suites


class EstimateOut(BaseModel):
    """UC-5.1 step 6: the tests that will run and the attempts they need."""

    tests: int
    skipped: int
    estimated_attempts: int
    target_safe_rate: int | None
    threat_model: ThreatModelBrief | None  # None: no approved threat model yet (2a)
    warnings: list[str]


class CampaignTargetOut(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    environment: str
    status: str
    max_request_rate: int


class CampaignListItem(BaseModel):
    code: str
    name: str
    target: CampaignTargetOut | None
    suite_count: int
    attempt_budget: int
    request_rate: int
    approval_status: str
    schedule: ScheduleOut | None
    created_by: str | None
    created_at: datetime


class CampaignSuiteOut(BaseModel):
    code: str
    found: bool
    name: str
    version: int
    test_count: int


class CampaignDetail(CampaignListItem):
    adaptive_agent: bool
    repetitions: int
    window_start: time | None
    window_end: time | None
    time_zone: str
    suites: list[CampaignSuiteOut]
    estimate: EstimateOut
    based_on_threat_model: int | None  # the version it was created with (FR-3.3)
    # Only in the answer to "create", and only when the campaign runs immediately (UC-5.1 step 7)
    launched_run: "RunListItem | None" = None
    launch_error: str | None = None


# ---------------------------------------------------------------- campaign runs (FR-5.4, FR-5.6)


class RunListItem(BaseModel):
    id: uuid.UUID  # the findings of a run are asked for by it (GET /findings?run_id=…)
    code: str  # R-238-2: the second run of C-238
    number: int
    status: str
    end_reason: str | None
    trigger: str
    launched_by: str | None
    ended_by: str | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    attempts_sent: int
    attempt_budget: int


class RunOverviewItem(RunListItem):
    """A run with the campaign and target it belongs to, for the lists that cross campaigns."""

    campaign: "RunCampaignOut | None"
    target: "RunTargetOut | None"


class RunCampaignOut(BaseModel):
    code: str
    name: str


class RunTargetOut(BaseModel):
    id: uuid.UUID
    name: str
    type: str


class RunTestOut(BaseModel):
    """A test of the run, "planned" with its attempts or "skipped" with the reason (UC-5.4 step
    2)."""

    code: str
    version: int
    name: str
    suites: list[str]
    template: str | None
    status: str
    reason: str | None
    attempts: int


class SkippedTestOut(BaseModel):
    code: str
    name: str
    reason: str


class RunSummaryOut(BaseModel):
    """UC-5.6 step 5: the attempts by status, the tests that were skipped and the cost."""

    attempts: dict[str, int]
    skipped_tests: list[SkippedTestOut]
    cost_usd: float


class RunDetail(RunListItem):
    campaign: RunCampaignOut
    target: RunTargetOut
    status_message: str
    paused_by: str | None
    paused_at: datetime | None
    pause_kind: str | None
    wake_at: datetime | None  # when the run is looked at again: a retry, its window, its turn
    window_ends_at: datetime | None
    queue_position: int | None  # UC-5.6, 1a1
    request_rate: int
    attempts_planned: int
    attempts_replied: int
    attempts_failed: int
    cost_usd: float
    settings: dict
    versions: dict
    tests: list[RunTestOut]
    summary: RunSummaryOut | None  # once the run has ended
    extension_errors: list[dict]
    last_event_id: str | None  # the monitor follows the live events from here


class AttemptOut(BaseModel):
    """One request of a run. The reply and the tool calls are masked (NFR-8.2)."""

    model_config = ConfigDict(from_attributes=True)

    attempt_no: int
    test_code: str
    suite_code: str | None
    template: str
    variant: int
    status: str
    retry_of_id: uuid.UUID | None
    input: str
    sent_at: datetime | None
    finished_at: datetime | None
    status_code: int | None
    duration_ms: int | None
    reply: str | None
    reply_length: int | None
    tool_calls: str | None
    error_kind: str | None
    error_message: str | None
    hook_errors: list[dict] | None


class AttemptPage(BaseModel):
    items: list[AttemptOut]
    total: int
    page: int
    page_size: int


class StopIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(default="", max_length=500)
