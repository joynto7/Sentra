import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event: str
    text: str
    subject: str  # shown in bold inside the text
    link: str | None
    count: int
    read_at: datetime | None
    last_event_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int


class UnreadOut(BaseModel):
    unread_count: int


class MarkedOut(BaseModel):
    marked: int


class PreferenceOut(BaseModel):
    event: str
    label: str
    locked: bool  # "Always on for your protection."
    in_app: bool
    email: bool


class PreferenceIn(BaseModel):
    event: str = Field(max_length=40)
    in_app: bool
    email: bool


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str


class ApiKeyOut(BaseModel):
    """One key of the organization (UC-9.6). The key itself is never in it (NFR-3.1)."""

    id: uuid.UUID
    name: str
    purpose: str
    prefix: str  # snt_3f9a2b1c, the only part of the key Sentra keeps
    scopes: list[str]
    scope_labels: list[str]
    targets: list[TargetRef]  # empty: every target of the organization
    created_by: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    revoked_by: str | None
    last_used_at: datetime | None
    state: str  # active, expiring, expired or revoked


class ScopeOut(BaseModel):
    value: str
    label: str
    available: bool  # whether an endpoint accepts it today
    waiting_for: str | None  # what it waits for, when it doesn't


class ApiKeyList(BaseModel):
    rows: list[ApiKeyOut]
    scopes: list[ScopeOut]
    targets: list[TargetRef]


class ApiKeyCreated(ApiKeyOut):
    """Step 4: the key, shown once and never again."""

    key: str


class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    purpose: str = Field(default="", max_length=300)
    scopes: list[str] = Field(min_length=1)
    target_ids: list[uuid.UUID] = Field(default_factory=list)
    expires_at: datetime


class ApiKeyMe(BaseModel):
    """What GET /api-keys/me tells an integration about its own key."""

    name: str
    scopes: list[str]
    scope_labels: list[str]
    targets: list[TargetRef]
    expires_at: datetime
    expires_soon: bool


class ReportOut(BaseModel):
    """One report (FR-9.1) as Screen 52 lists it. The file itself is downloaded separately."""

    id: uuid.UUID
    code: str  # RP-001
    title: str
    type: str
    scope: str
    target: str | None
    campaign_run: str | None
    category: str | None
    period_from: datetime | None
    period_to: datetime | None
    format: str
    status: str  # generating, ready, empty (5a1) or failed
    message: str | None
    summary: dict  # how many findings it counts, and how many await confirmation (2a1)
    checksum: str | None  # SHA-256 of the file, shown beside the download
    size_bytes: int | None
    requested_by: str | None
    schedule: str | None  # the schedule that produced it (FR-9.2)
    created_at: datetime
    finished_at: datetime | None


class RecipientRef(BaseModel):
    id: str
    name: str


class ScheduleOut(BaseModel):
    """A standing order for reports (FR-9.2, UC-9.2)."""

    id: uuid.UUID
    name: str
    type: str
    scope: str
    target: str | None
    category: str | None
    period_days: int | None
    format: str
    frequency: str  # after_each_run, weekly or monthly
    status: str  # active or paused (4a)
    recipients: list[RecipientRef]
    created_by: str | None
    created_at: datetime
    next_run_at: datetime | None
    last_run_at: datetime | None


class ReportList(BaseModel):
    rows: list[ReportOut]
    schedules: list[ScheduleOut]
    members: list[RecipientRef]  # who may be a recipient (UC-9.2 step 3)


class ReportRequestIn(BaseModel):
    type: str
    scope: str
    format: str
    target_id: uuid.UUID | None = None
    campaign_run_id: uuid.UUID | None = None
    period_days: int | None = Field(default=None, ge=1, le=3650)
    category: str | None = None


class ScheduleIn(ReportRequestIn):
    name: str = Field(min_length=1, max_length=120)
    frequency: str
    recipient_ids: list[uuid.UUID]


class ScheduleUpdateIn(BaseModel):
    name: str | None = None
    recipient_ids: list[uuid.UUID] | None = None
    frequency: str | None = None
    status: str | None = None
