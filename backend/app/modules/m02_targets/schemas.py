import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.m02_targets.formats import RequestFormat
from app.modules.m02_targets.models import CredentialType, Environment, TargetType

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


class TargetListOut(BaseModel):
    items: list[TargetOut]
    total: int
    page: int
    page_size: int
    # Number of targets on each tab of the targets page: {"active": 6, "archived": 2}
    counts: dict[str, int]
