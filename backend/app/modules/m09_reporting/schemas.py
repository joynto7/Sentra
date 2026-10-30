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
