import uuid
from datetime import datetime

from pydantic import BaseModel


class FrameworkRef(BaseModel):
    code: str
    name: str | None  # None for an ATLAS technique Sentra has no name for
    in_scope: bool = True  # False for LLM03 and LLM09, which application testing doesn't cover


class ComponentOut(BaseModel):
    kind: str
    name: str
    note: str
    threats: int  # threats that aren't removed


class ThreatOut(BaseModel):
    number: int
    title: str
    component_kind: str
    component_name: str
    owasp: list[FrameworkRef]
    atlas: FrameworkRef | None
    likelihood: int
    impact: int
    risk: int
    source: str  # baseline, ai_suggested or analyst
    rationale: str | None
    rated_by: str | None  # who set the present rating; None: the rule's or the LLM's
    edited_by: str | None  # who changed it in this version
    change_reason: str | None
    removed: bool
    removal_reason: str | None


class VersionSummary(BaseModel):
    version: int
    status: str  # draft or approved
    origin: str  # generated, edited or restored
    ai_generated: bool  # a draft with AI-suggested threats is labelled AI-generated (NFR-9.4)
    created_at: datetime
    created_by: str | None  # None: Sentra, after a profile review
    approved_at: datetime | None
    approved_by: str | None
    threat_count: int


class VersionOut(VersionSummary):
    based_on_version: int | None
    profile_version: int | None
    trigger: str | None  # profile_review or requested, for generated versions
    model: str | None  # the LLM that suggested threats
    suggested: int
    dropped: int  # suggestions left out (step 5)
    baseline_only: str | None  # why no LLM threats were added (4a, 4b)
    components: list[ComponentOut]
    threats: list[ThreatOut]  # by risk, highest first; removed ones last


class JobOut(BaseModel):
    id: uuid.UUID
    status: str  # queued, running, done or failed
    trigger: str
    requested_by: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    version: int | None
    message: str | None


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    environment: str
    host: str
    status: str


class ThreatModelPage(BaseModel):
    """Screen 26: a version of a target's threat model, and what can be done next."""

    target: TargetRef
    blocker: str | None  # why no threat model can be generated now (UC-3.1 preconditions)
    blocker_code: str | None
    job: JobOut | None  # a generation that waits or runs, or the last one that failed
    versions: list[VersionSummary]  # newest first
    current: VersionOut | None  # the version asked for, else the newest


class ThreatModelRow(BaseModel):
    target: TargetRef
    profile_reviewed: bool
    latest: VersionSummary | None
    approved: VersionSummary | None  # the newest approved version
    job: JobOut | None
    blocker: str | None
    blocker_code: str | None


class ThreatModelList(BaseModel):
    """Screen 25."""

    rows: list[ThreatModelRow]
    drafts_to_review: int  # targets whose newest version is a draft
    approved: int  # targets whose newest version is approved
    without_threat_model: int  # verified targets that have no threat model yet
