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


# ---------------------------------------------------------------- lifecycle (FR-2.6)


class ArchiveIn(BaseModel):
    """UC-2.6 step 3: archiving is confirmed with the user's password (NFR-3.5)."""

    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=200)


class ScheduleToCancel(BaseModel):
    """A campaign that runs by itself against the target and would stop doing so (FR-5.3)."""

    id: uuid.UUID
    campaign: str  # C-001
    name: str
    schedule: str  # in words, e.g. "Every Monday at 02:00 (Asia/Dhaka)"
    next_run_at: datetime | None
    created_by: str | None


class ArchiveConsequencesOut(BaseModel):
    """UC-2.6 step 2 (Screen 24): what archiving would do, before it is confirmed."""

    target: "TargetRef"
    running: str  # 2a1: why it can't be archived now; empty when nothing runs
    schedules: list[ScheduleToCancel]
    credentials: list[str]  # the header names whose secrets would be deleted (NFR-3.1)
    runs_kept: int
    findings_kept: int


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str
    status: str


class HistoryRunRef(BaseModel):
    id: uuid.UUID
    code: str  # R-001-2
    number: int


class HistoryEvent(BaseModel):
    """One entry of a target's history (UC-2.7 step 2). The kinds are registration,
    verification, configuration, profile and campaign_run; retests and Shield Policies join them
    with FR-8.4 and FR-8.3."""

    at: datetime
    kind: str
    action: str
    summary: str
    actor: str
    by_sentra: bool
    details: dict
    run: HistoryRunRef | None  # the campaign run this entry is about (step 5)
    details_deleted: bool  # 5a1: its details were deleted at the end of their retention period


class HistoryScore(BaseModel):
    """The risk score of the target at one moment, with the open findings it counted (step 3)."""

    at: datetime
    score: int
    band: str
    trigger: str
    open_by_severity: dict[str, int]
    open_total: int


class TargetHistoryOut(BaseModel):
    target: TargetRef
    period_days: int
    kinds: list[str]
    has_runs: bool  # 2a1: without a campaign run the page suggests creating one
    events: list[HistoryEvent]
    scores: list[HistoryScore]
