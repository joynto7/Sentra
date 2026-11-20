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
