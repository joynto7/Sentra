import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.m02_targets.formats import RequestFormat
from app.modules.m02_targets.models import (
    CredentialType,
    Environment,
    TargetType,
    VerificationMethod,
)

# Stored credentials are never shown again, not even in part (FR-2.2).
MASK = "••••••••••••"


class CredentialIn(BaseModel):
    credential_type: CredentialType
    name: str = ""  # the header name; a bearer token always uses Authorization
    value: str = ""


class TargetIn(BaseModel):
    """Registration (UC-2.1). Friendly field errors come from the service, not from here."""

    name: str = ""
    type: TargetType
    endpoint_url: str = ""
    environment: Environment
    max_request_rate: int | None = None
    request_format: RequestFormat = RequestFormat.OPENAI_CHAT
    request_template: str | None = None
    reply_path: str | None = None
    tool_calls_path: str | None = None
    credentials: list[CredentialIn] = Field(default_factory=list)


class TargetPatch(BaseModel):
    """Changes to a target (UC-2.5). Fields that are left out stay as they are."""

    name: str | None = None
    environment: Environment | None = None
    max_request_rate: int | None = None
    endpoint_url: str | None = None
    request_format: RequestFormat | None = None
    request_template: str | None = None
    reply_path: str | None = None
    tool_calls_path: str | None = None


class CredentialsIn(BaseModel):
    """New credentials. They replace all stored ones, which are deleted (UC-2.5 step 4)."""

    credentials: list[CredentialIn]


class EndpointCheckIn(BaseModel):
    endpoint_url: str = ""


class EndpointCheckOut(BaseModel):
    endpoint_url: str


class CredentialOut(BaseModel):
    name: str
    credential_type: CredentialType
    masked_value: str = MASK
    saved_at: datetime


class OwnerOut(BaseModel):
    id: uuid.UUID
    name: str


class ConnectionSummary(BaseModel):
    status: str  # "running", "passed" or "failed"
    finished_at: datetime | None
    status_code: int | None
    duration_ms: int | None


class TargetOut(BaseModel):
    id: uuid.UUID
    name: str
    type: TargetType
    endpoint_url: str
    endpoint_host: str
    environment: Environment
    max_request_rate: int
    request_format: RequestFormat
    request_template: str | None
    reply_path: str
    tool_calls_path: str | None
    status: str
    owner: OwnerOut | None
    credentials: list[CredentialOut]
    created_at: datetime
    updated_at: datetime
    # Sentra's own lab target (FR-11.1): Sentra places its ownership token itself
    is_lab: bool = False
    # Who verified the target, when and how (FR-2.3)
    verified_at: datetime | None = None
    verified_by: OwnerOut | None = None
    verification_method: str | None = None
    last_connection_test: ConnectionSummary | None = None
    profile_status: str | None = None  # None until the first mapping (FR-2.5)


class TargetListOut(BaseModel):
    items: list[TargetOut]
    total: int
    page: int
    page_size: int
    # Number of targets on each tab of the targets page: {"active": 6, "archived": 2}
    counts: dict[str, int]


class ConnectionTestOut(BaseModel):
    """A connection test (UC-2.2) and its result."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    created_at: datetime
    finished_at: datetime | None
    status_code: int | None
    duration_ms: int | None
    reply_path: str | None
    reply_excerpt: str | None  # plain text, masked; never rendered as active content
    error_kind: str | None
    error_message: str | None
    unreadable_excerpt: str | None


class OwnershipCheckIn(BaseModel):
    method: VerificationMethod


class OwnershipCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    method: str
    trigger: str
    status: str
    created_at: datetime
    finished_at: datetime | None
    checked_location: str
    found: str | None
    message: str | None
    checked_by: str | None = None


class DnsInstructions(BaseModel):
    type: str = "TXT"
    name: str
    value: str


class FileInstructions(BaseModel):
    url: str
    content: str


class VerificationOut(BaseModel):
    """Screen 19's ownership card: the token, both methods and the checks so far (UC-2.3)."""

    status: str
    token: str
    is_lab: bool
    ip_endpoint: bool  # an IP address has no DNS records, so only the file can be used
    dns: DnsInstructions | None
    file: FileInstructions
    verified_at: datetime | None
    verified_by: str | None
    method: str | None
    recent_checks: list[OwnershipCheckOut]


class ProfileEntryOut(BaseModel):
    key: str
    label: str
    value: str
    source: str  # "discovered", "manual" or "unknown"
    note: str = ""


class ProfileToolOut(BaseModel):
    name: str
    parameters: str
    side_effect: str
    source: str


class ProfileKnowledgeOut(BaseModel):
    name: str
    description: str
    access: str
    source: str


class CanaryOut(BaseModel):
    slot: str
    label: str
    where: str
    token: str
    topic: str | None
    topic_label: str
    source: str  # "lab" (placed by the lab target) or "generated"
    planted: bool
    planted_at: datetime | None


class ProfileOut(BaseModel):
    status: str
    version: int
    mapped_at: datetime | None
    discovery_requests: int
    stop_reason: str | None
    entries: list[ProfileEntryOut]
    tools: list[ProfileToolOut]
    knowledge_sources: list[ProfileKnowledgeOut]
    reviewed_at: datetime | None
    reviewed_by: str | None
    canaries: list[CanaryOut]


class CanaryIn(BaseModel):
    planted: bool
    topic: str | None = Field(default=None, max_length=300)
