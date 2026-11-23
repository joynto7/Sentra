import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.m04_tests.schema import Severity


class CheckOut(BaseModel):
    """One check a method evaluated: its sentence, its result (met, not_met or unknown) and why."""

    check: str
    value: str
    sentence: str
    result: str
    detail: str


class DetectionResultOut(BaseModel):
    """The result of one detection method (Screen 40, "Detection results"). For the LLM judge also
    its confidence, its reasoning (masked) and the model and instructions that gave it (NFR-9.4,
    NFR-9.5)."""

    model_config = ConfigDict(from_attributes=True)

    method: str
    method_label: str
    role: str
    outcome: str
    summary: str
    checks: list[CheckOut]
    duration_ms: int | None
    confidence: Decimal | None
    reasoning: str | None
    judge_model: str | None
    judge_deployment: str | None
    instructions_version: str | None
    tries: int
    evaluated_at: datetime | None


class VerdictOut(BaseModel):
    """The combined verdict of an attempt (UC-6.1 step 5)."""

    model_config = ConfigDict(from_attributes=True)

    outcome: str
    decided_by: str | None
    requires_confirmation: bool
    disagreement: bool
    summary: str
    updated_at: datetime


class AttemptDetectionOut(BaseModel):
    attempt_no: int
    test_code: str
    verdict: VerdictOut | None  # None: the attempt got no reply, so nothing was evaluated
    results: list[DetectionResultOut]


class RunDetectionItem(BaseModel):
    """One attempt's verdict in a run, with the outcome of each method: "Met (Canary token ✓, LLM
    judge ✓)" on the live campaign monitor (UC-5.6 step 3)."""

    attempt_no: int
    test_code: str
    outcome: str
    decided_by: str | None
    requires_confirmation: bool
    disagreement: bool
    methods: dict[str, str]


class RunDetectionPage(BaseModel):
    items: list[RunDetectionItem]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]  # the run's attempts by verdict: met, not_met, pending, not_evaluated


# ---------------------------------------------------------------- findings (FR-6.2, FR-6.3)


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str


class RunRef(BaseModel):
    id: uuid.UUID
    code: str  # R-001-2: the second run of campaign C-001


class ComponentOut(BaseModel):
    """The affected component: with the test, the finding's root cause (UC-6.2 step 1)."""

    kind: str  # model, system_prompt, knowledge_source, tool or output
    name: str
    label: str  # e.g. "Tool: issue_refund"


class PersonRef(BaseModel):
    id: uuid.UUID
    name: str


class RepetitionsOut(BaseModel):
    """What a finding's reproducibility is based on (FR-6.4; UC-6.3): the last measurement, its
    attempts and how it ended."""

    attempts: int
    successes: int
    wanted: int  # the repetitions the campaign asked for
    status: str  # measuring, complete, or incomplete with the reason
    reason: str
    label: str  # "4 of 5 attempts"


class FindingItem(BaseModel):
    """One finding in the list (Screen 38)."""

    code: str  # F-001
    title: str
    severity: str
    status: str
    category: str  # OWASP Top 10 for LLM Applications, e.g. LLM07
    category_name: str
    target: TargetRef
    component: ComponentOut
    evidence_count: int
    owner: PersonRef | None  # who will fix it (FR-6.5)
    reproducibility: str | None  # None until the finding has been rated (FR-7.1)
    repetitions: RepetitionsOut | None  # what the score is based on (FR-6.4)
    first_run: RunRef  # the run it was found in; "new" in that run, "seen again" in later ones
    last_run: RunRef
    first_seen_at: datetime
    last_seen_at: datetime
    # Only when the list is asked for one campaign run: new, seen_again or reopened (Screen 37)
    in_run: str | None = None


class InRunCounts(BaseModel):
    """Of one campaign run's findings (Screen 37): how many it found for the first time, how many
    it saw again with the same root cause (FR-6.6) and how many it reopened as a regression."""

    new: int
    seen_again: int
    reopened: int


class FindingPage(BaseModel):
    items: list[FindingItem]
    total: int
    page: int
    page_size: int
    # The quick views of Screen 38 with the other filters applied: open, assigned,
    # requires_confirmation, closed
    counts: dict[str, int]
    # Screen 38's severity strip: the view and the filters but the severity, by severity
    severity_counts: dict[str, int] = Field(default_factory=dict)
    sort: str = "severity"
    direction: str = "desc"
    mine_first: bool = False  # UC-6.4, 2a1: an AI Application Developer's own findings first
    in_run_counts: InRunCounts | None = None


class FindingTestOut(BaseModel):
    """The version of the test that found it: what it checks and how to fix what it finds."""

    code: str
    version: int
    name: str
    objective: str
    success_condition: str
    recommended_mitigation: str


class FindingRunOut(BaseModel):
    id: uuid.UUID
    code: str
    attempts: int  # the attempts of the run that support the finding
    first_seen_at: datetime
    new: bool  # the finding was found first in this run (UC-6.2 step 2), else seen again (2a)


class MethodOut(BaseModel):
    method: str
    method_label: str
    role: str
    outcome: str
    confidence: Decimal | None  # of the LLM judge


class FindingDetectionOut(BaseModel):
    """How the attempt that found it was detected (Screens 38-39; NFR-9.3, NFR-9.4): which
    methods, and whether only the LLM judge supports it."""

    attempt_no: int
    run: RunRef
    outcome: str
    decided_by: str | None
    requires_confirmation: bool
    disagreement: bool
    summary: str
    methods: list[MethodOut]


class FindingOut(FindingItem):
    """One finding (Screen 39): FR-6.2's details, its triage (FR-6.5), its runs and how it was
    detected. Its evidence counts the evidence of every duplicate merged into it (FR-6.6)."""

    description: str  # the observed behaviour, masked
    atlas: list[str]  # MITRE ATLAS techniques
    # The triage of FR-6.5 (UC-6.6)
    confirmed_by: str | None
    confirmed_at: datetime | None
    assigned_at: datetime | None
    closed_by: str | None
    closed_at: datetime | None
    close_reason: str  # a false positive's reason (2a1), or which finding it was merged into
    merged_into: str | None  # the finding it duplicates (2b1), e.g. F-012
    merged_in: list[str]  # the duplicates merged into this one, whose evidence counts as its own
    calculated_severity: str | None  # what the matrix gave (FR-7.1), beside the one in force
    severity_provisional: bool
    severity_adjusted: bool  # an analyst set it, so the rating never changes it again (UC-7.1 4a)
    severity_justification: str
    test: FindingTestOut
    runs: list[FindingRunOut]
    detection: FindingDetectionOut | None
    created_at: datetime
    updated_at: datetime


class EvidenceItem(BaseModel):
    """One evidence record of a finding (Screen 40, left column)."""

    number: int  # 1, 2, 3 … within the finding
    kind: str  # attempt, or judge_verdict: the LLM judge's later answer
    finding: str  # whose evidence it is: this finding, or a duplicate merged into it (FR-6.6)
    attempt_no: int
    run: RunRef
    recorded_at: datetime
    checksum: str  # SHA-256 of the stored document
    size: int  # bytes
    stored_in: str  # database or object_storage


class IntegrityOut(BaseModel):
    """NFR-2.4: whether the stored document is exactly what was recorded."""

    status: str  # unchanged, modified or missing
    checksum: str  # recorded with the evidence
    computed: str | None  # of what is stored now


class EvidenceOut(EvidenceItem):
    integrity: IntegrityOut
    content: dict | None  # the masked document; target content is plain text only (NFR-3.6)


class CategoryOut(BaseModel):
    code: str
    name: str


class FindingFiltersOut(BaseModel):
    """What the filters of Screen 38 can offer: the targets, campaign runs, categories and owners
    of the organization's findings."""

    targets: list[TargetRef]
    runs: list[RunRef]
    categories: list[CategoryOut]
    owners: list[PersonRef]


# ---------------------------------------------------------------- triage (FR-6.5, FR-6.6)


class TriageIn(BaseModel):
    """One save of Screen 41 (UC-6.6 steps 2-4). Everything is optional: an analyst may change
    only the owner, or only add a comment, and the finding then keeps its status."""

    model_config = ConfigDict(extra="forbid")

    decision: Literal["confirm", "false_positive", "merge"] | None = None
    reason: str = Field(default="", max_length=2000)  # a false positive needs one (2a1)
    merge_into: str = Field(default="", max_length=20)  # the code of the finding it duplicates
    severity: Severity | None = None  # only when the analyst changes it
    justification: str = Field(default="", max_length=2000)  # needed when the severity changes
    owner_id: uuid.UUID | None = None
    comment: str = Field(default="", max_length=2000)


class HistoryItem(BaseModel):
    """One entry of a finding's history (FR-6.5; UC-6.6 step 5), append-only."""

    number: int
    kind: str  # detected, reopened, confirmed, false_positive, severity_adjusted, assigned …
    finding: str  # whose entry it is: a merged duplicate's history is shown with its own (FR-6.6)
    actor: str  # the member who did it, or "Sentra"
    by_sentra: bool
    text: str  # the comment, the reason or the justification
    was: str | None
    became: str | None
    run: str | None  # the campaign run it happened in, e.g. R-001-2
    finding_related: str | None  # the other finding of a merge
    user: str | None  # the owner of an assignment
    at: datetime


class SuggestedOwner(PersonRef):
    reason: str  # why Sentra suggests them, e.g. "owner of Loan Policy Q&A"


class MemberRef(PersonRef):
    role: str


class DuplicateOut(BaseModel):
    code: str
    title: str
    severity: str
    status: str


class TriageOptionsOut(BaseModel):
    """What Screen 41 needs: the severity the matrix calculated beside the one in force, who the
    finding can be assigned to, and the target's other open findings (2b)."""

    code: str
    title: str
    status: str
    open: bool  # only an open finding can be triaged
    requires_confirmation: bool  # only the LLM judge supports it (NFR-9.3)
    severity: str
    calculated_severity: str | None
    severity_provisional: bool
    severity_adjusted: bool
    severity_justification: str
    owner: PersonRef | None
    suggested_owner: SuggestedOwner | None
    members: list[MemberRef]
    duplicates: list[DuplicateOut]
