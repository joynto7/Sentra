import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ActorOut(BaseModel):
    type: str  # "user", "sentra", "api_key" or "person" (someone without an account yet)
    id: uuid.UUID | None
    name: str


class ItemOut(BaseModel):
    type: str
    id: str | None
    label: str


class AuditEntryOut(BaseModel):
    id: uuid.UUID
    seq: int
    occurred_at: datetime
    actor: ActorOut
    action: str
    summary: str
    item: ItemOut | None
    source_address: str | None


class AuditEntryDetail(AuditEntryOut):
    details: dict
    prev_hash: str
    entry_hash: str
    hash_matches: bool  # the stored hash matches the entry's content


class IntegrityOut(BaseModel):
    verified: bool
    checked_at: datetime
    entries: int
    broken_seq: int | None


class AuditLogPage(BaseModel):
    items: list[AuditEntryOut]
    total: int
    page: int
    page_size: int
    integrity: IntegrityOut | None
    retention: str = "Entries are kept for at least 1 year."


class AuditFilterOption(BaseModel):
    key: str
    label: str


class AuditActorOption(BaseModel):
    id: uuid.UUID
    name: str


class AuditFiltersOut(BaseModel):
    actors: list[AuditActorOption]
    groups: list[AuditFilterOption]
    item_types: list[str]


class AuditExportIn(BaseModel):
    format: Literal["csv", "json"] = "csv"
    start: datetime | None = None
    end: datetime | None = None
    actor_id: uuid.UUID | None = None
    group: str = Field(default="", max_length=40)
    item_type: str = Field(default="", max_length=30)
    item_id: str = Field(default="", max_length=64)
    search: str = Field(default="", max_length=200)


class SuspendIn(BaseModel):
    reason: str = Field(default="", max_length=1000)
    password: str = Field(min_length=1, max_length=256)  # UC-10.2 step 3 (NFR-3.5)


class PasswordConfirmIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class SuspensionImpactOut(BaseModel):
    """UC-10.2 step 2: the consequences, shown before the administrator confirms."""

    member: str
    sessions: int
    other_administrators: list[str]


class MembershipStatusOut(BaseModel):
    membership_id: uuid.UUID
    status: str
    suspended_at: datetime | None
    suspension_reason: str | None


class AccountOrganizationOut(BaseModel):
    name: str
    status: str  # the membership's status in it


class AccountOut(BaseModel):
    """One account on the Accounts page (Screen 64): account data only, never an organization's
    content (NFR-3.3)."""

    id: uuid.UUID
    name: str
    email: str
    organizations: list[AccountOrganizationOut]
    mfa_enabled: bool
    last_login_at: datetime | None
    last_login_new_address: bool
    status: str  # "active" or "suspended"
    suspended_at: datetime | None
    suspension_reason: str | None
    platform_admin: bool


class AccountPage(BaseModel):
    items: list[AccountOut]
    total: int
    page: int
    page_size: int


class LLMTaskOut(BaseModel):
    """One row of Screen 59: a task of Sentra's AI and where the organization's data goes for it
    (UC-10.5 steps 1-2)."""

    task: str
    function: str
    model: str | None
    provider: str | None
    deployment: str | None  # "external" (the data leaves the platform) or "local"
    receives: str
    requests_this_month: int
    local_model: bool  # it stays available with local models only
    available: bool  # with the organization's current setting
    without_model: str  # what the function does without a model (UC-10.5, 4a1)


class DataSharingOut(BaseModel):
    local_models_only: bool
    changed_by: str | None
    changed_at: datetime | None
    tasks: list[LLMTaskOut]
    masking: str


class DataSharingIn(BaseModel):
    local_models_only: bool
    password: str = Field(min_length=1, max_length=256)  # UC-10.5 step 5 (NFR-3.5)


# ---------------------------------------------------------------- data retention (FR-10.5)


class RetentionKindOut(BaseModel):
    """One of the three kinds of data on Screen 60: how long it is kept, what the platform
    allows, and how much of it the organization stores now (UC-10.7 step 1)."""

    days: int
    minimum: int
    maximum: int
    items: int
    bytes: int


class RetentionRunOut(BaseModel):
    """What the last clean-up did (UC-10.8 step 6)."""

    started_at: datetime
    finished_at: datetime | None
    evidence_deleted: int
    evidence_bytes: int
    attempts_deleted: int
    reports_deleted: int
    postponed: int
    failures: int


class RetentionOut(BaseModel):
    evidence: RetentionKindOut
    campaign: RetentionKindOut
    reports: RetentionKindOut
    using_defaults: bool  # the organization has never set its own periods
    changed_by: str | None
    changed_at: datetime | None
    clean_up_at: str  # when the daily clean-up runs, as Screen 60 writes it, e.g. "01:00 UTC"
    last_run: RetentionRunOut | None
    audit_log_days: int  # not covered by these periods (NFR-8.3)


class RetentionIn(BaseModel):
    evidence_days: int = Field(ge=1, le=36500)
    campaign_days: int = Field(ge=1, le=36500)
    report_days: int = Field(ge=1, le=36500)
    password: str = Field(min_length=1, max_length=256)  # UC-10.7 step 5 (NFR-3.5)


class RetentionPreviewOut(BaseModel):
    """Step 4: what the next clean-up would delete with the periods the administrator typed, and
    4a's open findings whose evidence is among it."""

    evidence_items: int
    evidence_bytes: int
    attempts: int
    reports: int
    postponed: int
    open_findings: list[str]
