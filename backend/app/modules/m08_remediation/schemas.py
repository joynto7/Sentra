import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class FindingRef(BaseModel):
    """The finding a proposal is for, as the pages of Screens 45 and 46 name it."""

    id: uuid.UUID
    code: str  # F-001
    title: str
    severity: str
    status: str
    category: str  # the OWASP Top 10 for LLM Applications category of its test
    component: str  # "Tool: issue_refund", as Screen 39 writes it
    test_code: str
    target_id: uuid.UUID
    target_name: str


class FixOut(BaseModel):
    position: int
    kind: str  # one of the five kinds of FR-8.1
    kind_label: str  # "Guardrail policy"
    title: str
    description: str
    details: dict  # the fix itself: the prompt, the rules, the tools, the sources or the steps
    enforcement: str  # gateway or application (UC-8.2 step 6)
    enforcement_note: str | None  # why it has to be made in the application (6a)


class FixSummary(BaseModel):
    """A fix as Screen 45 lists it: its kind and where it takes effect, nothing of its content."""

    kind: str
    kind_label: str
    enforcement: str


class VersionSummary(BaseModel):
    version: int
    status: str  # draft, awaiting approval, approved or rejected (UC-8.3)
    origin: str  # generated, revised or edited by a person (UC-8.3 steps 2-3)
    based_on_version: int | None
    ai_generated: bool  # labelled as such even after a person adapted it (NFR-9.4)
    created_at: datetime
    requested_by: str | None
    edited_by: str | None  # who adapted it; they may not approve it (4a)
    decided_by: str | None
    decided_at: datetime | None
    decision_reason: str | None  # why it was rejected (5a1)
    fix_count: int
    fixes_in_short: list[FixSummary]


class VersionOut(VersionSummary):
    root_cause: str
    summary: str
    model: str | None  # the LLM that wrote it
    dropped: int  # fixes the model proposed that Sentra left out
    mitigation_only: str | None  # why it holds the test's mitigation only (4a, 4b)
    fixes: list[FixOut]


class JobOut(BaseModel):
    id: uuid.UUID
    status: str  # queued, running, done or failed
    trigger: str  # requested or revision
    requested_by: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    version: int | None  # the version it made
    message: str | None


class CommentOut(BaseModel):
    """One message of the review thread (UC-8.3), with the version it was written on."""

    id: uuid.UUID
    version: int
    author: str | None
    text: str
    created_at: datetime


class ReviewOut(BaseModel):
    """What the person reading Screen 46 may do with the newest version, and what an approval
    starts (UC-8.3 step 6)."""

    can_edit: bool
    can_submit: bool  # a draft nobody has changed can go to the approvers as it is
    can_approve: bool
    cannot_approve: str | None  # the rule of 4a, or the reader's role, in one sentence
    approvers: list[str]  # the Security Analysts and Managers of the organization
    on_approval: list[str]


class RemediationPage(BaseModel):
    """Screen 46: the newest version of a finding's proposal, with its earlier versions."""

    finding: FindingRef
    blocker: str | None  # why no proposal can be asked for now (UC-8.2, 1a)
    blocker_code: str | None
    job: JobOut | None  # the generation the page follows
    versions: list[VersionSummary]  # newest first
    current: VersionOut | None
    review: ReviewOut
    comments: list[CommentOut]


class FixIn(BaseModel):
    """A fix the person keeps, with what they changed about it (UC-8.3 step 2). Its kind and where
    it is enforced are Sentra's and are not taken from the request."""

    position: int  # its position in the version being adapted
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)
    details: dict


class EditIn(BaseModel):
    root_cause: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    fixes: list[FixIn] = Field(min_length=1)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class CommentIn(BaseModel):
    version: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=2000)


class RemediationRow(BaseModel):
    finding: FindingRef
    latest: VersionSummary | None
    job: JobOut | None
    blocker: str | None
    blocker_code: str | None


class RemediationList(BaseModel):
    """Screen 45: the confirmed findings of the organization and their proposals."""

    rows: list[RemediationRow]
    drafts: int  # proposals that await a person
    without_proposal: int  # confirmed findings with no proposal yet
