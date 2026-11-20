from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CheckOut(BaseModel):
    """One check a method evaluated: its sentence, its result (met, not_met or unknown) and why."""

    check: str
    value: str
    sentence: str
    result: str
    detail: str


class DetectionResultOut(BaseModel):
    """The result of one detection method (Screen 40, "Detection results"). For the LLM judge also
    its confidence, its reasoning (masked) and the model and instructions that gave it (NFR-9.4,
    NFR-9.5)."""

    model_config = ConfigDict(from_attributes=True)

    method: str
    method_label: str
    role: str
    outcome: str
    summary: str
    checks: list[CheckOut]
    duration_ms: int | None
    confidence: Decimal | None
    reasoning: str | None
    judge_model: str | None
    judge_deployment: str | None
    instructions_version: str | None
    tries: int
    evaluated_at: datetime | None


class VerdictOut(BaseModel):
    """The combined verdict of an attempt (UC-6.1 step 5)."""

    model_config = ConfigDict(from_attributes=True)

    outcome: str
    decided_by: str | None
    requires_confirmation: bool
    disagreement: bool
    summary: str
    updated_at: datetime


class AttemptDetectionOut(BaseModel):
    attempt_no: int
    test_code: str
    verdict: VerdictOut | None  # None: the attempt got no reply, so nothing was evaluated
    results: list[DetectionResultOut]


class RunDetectionItem(BaseModel):
    """One attempt's verdict in a run, with the outcome of each method: "Met (Canary token ✓, LLM
    judge ✓)" on the live campaign monitor (UC-5.6 step 3)."""

    attempt_no: int
    test_code: str
    outcome: str
    decided_by: str | None
    requires_confirmation: bool
    disagreement: bool
    methods: dict[str, str]


class RunDetectionPage(BaseModel):
    items: list[RunDetectionItem]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]  # the run's attempts by verdict: met, not_met, pending, not_evaluated
