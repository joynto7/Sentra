"""The detection results of the attempts of campaign runs (FR-6.1), and the findings with their
evidence (FR-6.2, FR-6.3). Report, ER diagram 4: every attempt is EVALUATED_BY one detection result
for each detection method of its test; a test definition RAISES findings, every finding AFFECTS
one target and is SUPPORTED_BY evidence that CAPTURES an attempt. The Detection Engine
(app/workers/detection) writes them all."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    DDL,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class Outcome(StrEnum):
    """The result of one detection method, and the combined verdict of an attempt (UC-6.1)."""

    MET = "met"  # the success condition of the test is met: the attempt revealed a weakness
    NOT_MET = "not_met"
    PENDING = "pending"  # the LLM judge hasn't answered yet
    NOT_EVALUATED = "not_evaluated"  # it couldn't be evaluated; the summary says why


class DecidedBy(StrEnum):
    DETERMINISTIC = "deterministic"  # a decisive canary-token, rule or tool-call method
    LLM_JUDGE = "llm_judge"


class DetectionResult(UUIDPrimaryKey, OrganizationScoped, Base):
    """What one detection method of the test found for one attempt, stored apart from the other
    methods (FR-6.1; UC-6.1 step 4)."""

    __tablename__ = "detection_results"
    __table_args__ = (UniqueConstraint("attempt_id", "method"),)

    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"))
    method: Mapped[str] = mapped_column(String(30))  # m04_tests.schema.DetectionMethod
    role: Mapped[str] = mapped_column(String(15))  # as the test defines it: decisive, supporting …
    outcome: Mapped[str] = mapped_column(String(15))
    summary: Mapped[str] = mapped_column(Text)  # what it found, in words (Screen 40)
    # Each check the method evaluated: check, value, sentence, result (met, not_met or unknown)
    # and detail
    checks: Mapped[list] = mapped_column(JSONB, default=list)
    duration_ms: Mapped[int | None]  # of a deterministic method: at most 100 ms (NFR-1.4)
    # The LLM judge (NFR-9.4, NFR-9.5): its confidence and its reasoning (masked), and the model and
    # the version and SHA-256 of the instructions that gave the verdict
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    reasoning: Mapped[str | None] = mapped_column(Text)
    judge_model: Mapped[str | None] = mapped_column(String(200))
    judge_deployment: Mapped[str | None] = mapped_column(String(10))  # local or external
    instructions_version: Mapped[str | None] = mapped_column(String(20))
    instructions_sha256: Mapped[str | None] = mapped_column(String(64))
    tries: Mapped[int] = mapped_column(SmallInteger, default=0)  # of the judge (UC-6.1, 3a)
    error: Mapped[str | None] = mapped_column(Text)  # the judge's last problem
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DetectionVerdict(Timestamps, OrganizationScoped, Base):
    """The combined verdict of one attempt (UC-6.1 step 5): whether it meets the success condition
    of its test, which kind of method decided, whether an analyst must confirm it because only the
    LLM judge supports it (NFR-9.3), and whether the judge disagreed with the deterministic methods
    that decided (NFR-9.5)."""

    __tablename__ = "detection_verdicts"
    __table_args__ = (Index("ix_detection_verdicts_run_outcome", "campaign_run_id", "outcome"),)

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attempts.id", ondelete="CASCADE"), primary_key=True
    )
    campaign_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="CASCADE")
    )
    outcome: Mapped[str] = mapped_column(String(15))
    decided_by: Mapped[str | None] = mapped_column(String(15))
    requires_confirmation: Mapped[bool] = mapped_column(default=False)
    disagreement: Mapped[bool] = mapped_column(default=False)
    summary: Mapped[str] = mapped_column(Text)


class FindingStatus(StrEnum):
    """The lifecycle of a finding (report, Figure 2.6). Open: new, requires confirmation,
    confirmed, reopened. Closed: false positive, merged, fixed and verified. A new finding starts
    as new when deterministic evidence supports it, else as requires confirmation (NFR-9.3);
    triage (FR-6.5), merging (FR-6.6) and retests (FR-8.5) change it later."""

    NEW = "new"
    REQUIRES_CONFIRMATION = "requires_confirmation"
    CONFIRMED = "confirmed"
    FALSE_POSITIVE = "false_positive"
    MERGED = "merged"
    FIXED_AND_VERIFIED = "fixed_and_verified"
    REOPENED = "reopened"


OPEN = (
    FindingStatus.NEW,
    FindingStatus.REQUIRES_CONFIRMATION,
    FindingStatus.CONFIRMED,
    FindingStatus.REOPENED,
)
CLOSED = (FindingStatus.FALSE_POSITIVE, FindingStatus.MERGED, FindingStatus.FIXED_AND_VERIFIED)


class ComponentKind(StrEnum):
    """The kinds of component of a target, as the threat model names them (FR-3.1): where a
    finding's weakness is (UC-6.2 step 1)."""

    MODEL = "model"
    SYSTEM_PROMPT = "system_prompt"
    KNOWLEDGE_SOURCE = "knowledge_source"
    TOOL = "tool"
    OUTPUT = "output"


KIND_LABELS = {
    ComponentKind.MODEL: "Model",
    ComponentKind.SYSTEM_PROMPT: "System prompt",
    ComponentKind.KNOWLEDGE_SOURCE: "Knowledge source",
    ComponentKind.TOOL: "Tool",
    ComponentKind.OUTPUT: "Output",
}


def component_label(kind: str, name: str) -> str:
    """How a component is named on the pages, e.g. "Tool: issue_refund" (Screen 39). A name
    that already says its kind, such as "System prompt" or "Knowledge sources", stays as it is."""
    label = KIND_LABELS[ComponentKind(kind)]
    return name if name.lower().startswith(label.lower()) else f"{label}: {name}"


class Finding(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """A weakness of one target (FR-6.2): one finding per root cause, which is the test together
    with the affected component (UC-6.2 step 1). A later attempt with the same root cause, in the
    same or another campaign run, adds its evidence instead of a second finding (2a)."""

    __tablename__ = "findings"
    __table_args__ = (
        UniqueConstraint("organization_id", "number"),
        # UC-6.2 step 1: one finding per root cause, even when two workers record one at once
        UniqueConstraint(
            "target_id",
            "test_code",
            "component_kind",
            "component_name",
            name="uq_findings_root_cause",
        ),
        Index("ix_findings_organization_status", "organization_id", "status"),
    )

    number: Mapped[int]  # shown as F-001; counted per organization
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("targets.id", ondelete="RESTRICT"))
    test_code: Mapped[str] = mapped_column(String(40))
    # The version of the test that found it first ("Test definition SID-XACC-005 v2", Screen 39)
    test_definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_definitions.id", ondelete="RESTRICT")
    )
    component_kind: Mapped[str] = mapped_column(String(20))
    component_name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(5))  # OWASP Top 10 for LLM Applications
    atlas: Mapped[list[str]] = mapped_column(JSONB, default=list)  # MITRE ATLAS techniques
    # The severity in force: the initial one of the test definition (FR-4.2) until FR-7.1 rates
    # the finding, and an analyst's adjustment once there is one (UC-7.1, 4a).
    severity: Mapped[str] = mapped_column(String(15))
    # What the rating matrix gave, and the factors it used (FR-7.1; m07_risk/rating.py). They are
    # shown with every severity, so that users can see why it was assigned (NFR-4.2).
    calculated_severity: Mapped[str | None] = mapped_column(String(15))
    severity_factors: Mapped[dict] = mapped_column(JSONB, default=dict)
    # UC-7.1, 3a1: rated on fewer attempts than the campaign's repetitions (FR-6.4)
    severity_provisional: Mapped[bool] = mapped_column(default=False)
    severity_rated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # UC-7.1, 4a: an analyst set the severity, so the rating never overwrites it again; FR-6.5
    # records who did it and why
    severity_adjusted: Mapped[bool] = mapped_column(default=False)
    # Successful attempts divided by the attempts that tried this weakness (FR-6.4 measures it
    # with the campaign's repetitions; until then the attempts the runs have sent count)
    reproducibility: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    status: Mapped[str] = mapped_column(String(25))
    description: Mapped[str] = mapped_column(Text)  # the observed behaviour, masked
    first_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="RESTRICT")
    )
    last_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="RESTRICT")
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    evidence_count: Mapped[int] = mapped_column(default=0)  # numbers its evidence 1, 2, 3 …

    @property
    def code(self) -> str:
        return f"F-{self.number:03d}"


class EvidenceKind(StrEnum):
    ATTEMPT = "attempt"  # the attempt, the reply, the tool calls and the detection results
    # The LLM judge's answer to an attempt whose evidence was stored before it came
    JUDGE_VERDICT = "judge_verdict"


class Evidence(UUIDPrimaryKey, OrganizationScoped, Base):
    """What proves a finding (FR-6.3): one JSON document, masked, written once with its SHA-256
    checksum (NFR-2.4). A document of up to 64 KB is kept here; a larger one is kept in the
    object storage and `content_ref` names it (NFR-6.2). A trigger refuses every change."""

    __tablename__ = "evidence"
    __table_args__ = (
        UniqueConstraint("finding_id", "evidence_no"),
        UniqueConstraint("attempt_id", "kind"),  # each attempt's evidence is stored once
        Index("ix_evidence_campaign_run_id", "campaign_run_id"),
    )

    finding_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("findings.id", ondelete="RESTRICT"))
    evidence_no: Mapped[int]  # 1, 2, 3 … within the finding
    kind: Mapped[str] = mapped_column(String(20))
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="RESTRICT"))
    campaign_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="RESTRICT")
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    checksum: Mapped[str] = mapped_column(String(64))  # SHA-256 of the document's bytes
    size: Mapped[int]  # bytes
    content: Mapped[str | None] = mapped_column(Text)  # the document, as the exact text hashed
    content_ref: Mapped[str | None] = mapped_column(String(300))  # its key in the object storage


# NFR-2.4: stored evidence is never modified. Attached to the table, so the tests' create_all()
# makes the trigger as well as the migration does. Even an administrator can only bypass it by
# disabling the trigger, and the checksum then shows the change.
READ_ONLY_FUNCTION = DDL(
    """
CREATE OR REPLACE FUNCTION sentra_evidence_read_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Evidence can''t be changed or deleted.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""
)
READ_ONLY_TRIGGER = DDL(
    "CREATE TRIGGER evidence_read_only BEFORE UPDATE OR DELETE ON evidence "
    "FOR EACH ROW EXECUTE FUNCTION sentra_evidence_read_only()"
)
event.listen(Evidence.__table__, "after_create", READ_ONLY_FUNCTION)
event.listen(Evidence.__table__, "after_create", READ_ONLY_TRIGGER)
