import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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
    runs: int  # campaign runs that were based on this version (UC-3.4 step 2)


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
    without_test: int | None  # threats of the newest version that no test covers (FR-3.4)


class ThreatModelList(BaseModel):
    """Screen 25."""

    rows: list[ThreatModelRow]
    drafts_to_review: int  # targets whose newest version is a draft
    approved: int  # targets whose newest version is approved
    without_threat_model: int  # targets (not archived) that have no threat model yet


# ---------------------------------------------------------------- reviewing (UC-3.2)


class ThreatEdit(BaseModel):
    """An existing threat as the analyst left it; only what differs counts as a change."""

    number: int
    title: str = Field(min_length=5, max_length=200)
    owasp: list[str] = Field(default_factory=list, max_length=4)
    atlas: str | None = None
    likelihood: int = Field(ge=1, le=5)
    impact: int = Field(ge=1, le=5)
    reason: str = Field(default="", max_length=300)  # why the rating changed, if it did


class ThreatNew(BaseModel):
    title: str = Field(min_length=5, max_length=200)
    component_kind: str
    component_name: str = Field(min_length=1, max_length=120)
    owasp: list[str] = Field(default_factory=list, max_length=4)
    atlas: str | None = None
    likelihood: int = Field(ge=1, le=5)
    impact: int = Field(ge=1, le=5)
    reason: str = Field(default="", max_length=300)


class ThreatRemoval(BaseModel):
    number: int
    reason: str = Field(default="", max_length=300)


class VersionIn(BaseModel):
    """UC-3.2 steps 3-4: the changes to the version the analyst started from (`base_version`)."""

    base_version: int
    edit: list[ThreatEdit] = Field(default_factory=list, max_length=200)
    add: list[ThreatNew] = Field(default_factory=list, max_length=50)
    remove: list[ThreatRemoval] = Field(default_factory=list, max_length=200)
    restore: list[int] = Field(default_factory=list, max_length=200)  # removed threats back


class RunRef(BaseModel):
    id: uuid.UUID
    code: str  # e.g. R-212-1
    started_at: datetime | None


class FieldChange(BaseModel):
    field: str  # title, owasp, atlas, likelihood or impact
    before: str
    after: str


class ComparedThreat(BaseModel):
    number: int
    title: str
    component_name: str
    owasp: list[str]
    atlas: str | None
    likelihood: int
    impact: int
    reason: str | None


class ChangedThreat(BaseModel):
    number: int
    title: str
    component_name: str
    changes: list[FieldChange]
    reason: str | None


class CompareOut(BaseModel):
    """UC-3.4: what was added, removed and changed between two versions, with the reasons."""

    base: VersionSummary
    compare: VersionSummary
    added: list[ComparedThreat]
    removed: list[ComparedThreat]
    changed: list[ChangedThreat]
    identical: bool
    base_runs: list[RunRef]
    compare_runs: list[RunRef]


# ---------------------------------------------------------------- recommendations (UC-3.3)


class ThreatRef(BaseModel):
    number: int
    title: str
    risk: int


class SuiteRecommendation(BaseModel):
    code: str
    name: str
    purpose: str
    version: int
    origin: str  # built_in or custom
    tests: int  # tests of the suite that apply to the target's type
    attempts: int  # about this many attempts per run
    threats: list[ThreatRef]  # the threats it addresses, highest risk first
    top_risk: int  # the highest risk among them; 0 when it addresses none
    recommended: bool  # it addresses at least one threat
    selected: bool  # in the saved selection, or else in Sentra's proposal


class GapAcceptanceOut(BaseModel):
    reason: str
    accepted_by: str | None
    accepted_at: datetime
    version: int  # the version it was accepted in


class GapOut(BaseModel):
    """A threat that no available test covers (UC-3.3 step 3)."""

    number: int
    title: str
    component_name: str
    owasp: list[FrameworkRef]
    risk: int
    out_of_scope: bool  # only LLM03 or LLM09, which no test of the library can cover
    accepted: GapAcceptanceOut | None


class SelectionOut(BaseModel):
    version: int  # the approved version it was saved for
    suites: list[str]
    uncovered: list[int]
    saved_by: str | None
    saved_at: datetime
    current: bool  # saved for the newest approved version


class Recommendations(BaseModel):
    """Screen 27."""

    target: TargetRef
    version: VersionSummary  # the newest approved version
    threats_total: int
    threats_covered: int  # by some available test
    suites: list[SuiteRecommendation]  # recommended ones first, by risk
    gaps: list[GapOut]
    selection: SelectionOut | None


class SelectionIn(BaseModel):
    version: int
    suites: list[str] = Field(max_length=50)


class GapIn(BaseModel):
    version: int
    threat: int
    reason: str = Field(default="", max_length=300)
