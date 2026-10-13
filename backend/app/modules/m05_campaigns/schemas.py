import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field


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


class EstimateIn(BaseModel):
    target_id: uuid.UUID | None = None
    suites: list[str] = Field(default_factory=list, max_length=50)
    attempt_budget: int | None = None


class EstimateOut(BaseModel):
    """UC-5.1 step 6: the tests that will run and the attempts they need."""

    tests: int
    skipped: int
    estimated_attempts: int
    target_safe_rate: int | None
    threat_model: bool
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
