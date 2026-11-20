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
