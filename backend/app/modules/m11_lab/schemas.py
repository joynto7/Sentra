"""What the Security Lab page sends and receives (Screen 65, FR-11.2)."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class KnownVulnerability(BaseModel):
    """One documented weakness of a lab target, as the application itself reports it (FR-11.1)."""

    id: str
    title: str
    category: str  # the OWASP LLM category, e.g. "LLM01"
    description: str


class LabCardOut(BaseModel):
    key: str
    name: str
    about: str
    type: str
    memory_mb: int
    minutes: int  # roughly how long deploying takes
    deployed: bool
    target_id: uuid.UUID | None
    state: str | None  # "ready", "resetting" or "not_ready"
    state_label: str
    status: str | None  # the target's own status (UC-2.3)
    vulnerabilities: int
    categories: list[str]
    canaries: int
    last_reset_at: datetime | None
    resets: int
    last_error: str | None
    active_run: str | None  # the campaign run that is using it (UC-11.2, 1a)


class LabOut(BaseModel):
    cards: list[LabCardOut]
    isolation: str
