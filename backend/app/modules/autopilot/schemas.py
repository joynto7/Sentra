import uuid
from datetime import datetime

from pydantic import BaseModel


class StartIn(BaseModel):
    target_id: uuid.UUID


class StepOut(BaseModel):
    stage: str
    at: datetime
    text: str


class PlanOut(BaseModel):
    """What an assessment of a target would do, shown before it is started."""

    target_id: uuid.UUID
    target_name: str
    can_start: bool
    reason: str | None  # why it can't be started, in a sentence
    tests: int
    repetitions: int
    attempt_budget: int
    request_rate: int
    estimated_minutes: int
    llm_cost: dict
    requires_scope_approval: bool
    has_approved_threat_model: bool
    has_reviewed_profile: bool
    warnings: list[str]


class AutopilotOut(BaseModel):
    id: uuid.UUID
    code: str
    target_id: uuid.UUID
    target_name: str
    status: str
    stage: str
    waiting_for: str | None
    message: str
    started_by: str | None
    created_at: datetime
    finished_at: datetime | None
    plan: dict
    steps: list[StepOut]
    summary: dict | None
    progress: dict
    campaign_code: str | None
    run_number: int | None
    can_stop: bool
