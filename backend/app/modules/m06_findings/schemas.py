import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


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
    first_run: RunRef  # the run it was found in; "new" in that run, "seen again" in later ones
    last_run: RunRef
    first_seen_at: datetime
    last_seen_at: datetime


class FindingPage(BaseModel):
    items: list[FindingItem]
    total: int
    page: int
    page_size: int
    # The quick views of Screen 38 with the other filters applied: open, requires_confirmation,
    # closed
    counts: dict[str, int]


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
    """One finding (Screen 39): FR-6.2's details, its runs and how it was detected."""

    description: str  # the observed behaviour, masked
    atlas: list[str]  # MITRE ATLAS techniques
    test: FindingTestOut
    runs: list[FindingRunOut]
    detection: FindingDetectionOut | None
    created_at: datetime
    updated_at: datetime


class EvidenceItem(BaseModel):
    """One evidence record of a finding (Screen 40, left column)."""

    number: int  # 1, 2, 3 … within the finding
    kind: str  # attempt, or judge_verdict: the LLM judge's later answer
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
    """What the filters of Screen 38 can offer: the targets, campaign runs and categories of the
    organization's findings."""

    targets: list[TargetRef]
    runs: list[RunRef]
    categories: list[CategoryOut]
