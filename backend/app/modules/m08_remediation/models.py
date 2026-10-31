"""The tables of Module 8 (ER diagram 5, class diagram 5): the remediation proposals of a
finding, the fixes of each proposal, and the jobs that generate them (UC-8.2).

Each Remediation row is one version of the proposal for one finding (FR-8.2): the first proposal
and every revision. A version starts as a draft, and nothing it proposes takes effect before a
person approves it (NFR-9.3). Reviewing, approving, deploying and retesting come with FR-8.2 to
FR-8.6. FR-8.2 added what a person does with a version: adapting it writes the next version,
and a version can be sent for approval, approved or rejected with a reason.
"""

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.models import OrganizationScoped, UUIDPrimaryKey


def _now() -> datetime:
    return datetime.now(UTC)


class RemediationStatus(StrEnum):
    """The lifecycle of a remediation (report, Figure 2.7). A generated proposal is a draft; the
    states after it come with FR-8.2 (review and approval), FR-8.3 (deployment) and FR-8.5
    (the retest that decides between effective and ineffective)."""

    DRAFT = "draft"
    AWAITING_APPROVAL = "awaiting_approval"
    REJECTED = "rejected"  # revised as a new draft version (UC-8.3, 5a)
    APPROVED = "approved"
    APPLYING = "applying"  # a policy is being deployed or a change implemented (UC-8.4, UC-8.5)
    EFFECTIVE = "effective"  # the retest found nothing (UC-8.6, FR-8.5)
    INEFFECTIVE = "ineffective"


class Origin(StrEnum):
    """How a version came about."""

    GENERATED = "generated"  # the first proposal for the finding (UC-8.2)
    REVISED = "revised"  # asked for again after a rejection or a failed retest (UC-8.2, 1b)
    EDITED = "edited"  # a person adapted the version before it (UC-8.3 steps 2-3)


class FixKind(StrEnum):
    """The kinds of fix a proposal may recommend (FR-8.1)."""

    SYSTEM_PROMPT = "system_prompt"  # a hardened system prompt
    GUARDRAIL = "guardrail"  # an input or output guardrail policy
    TOOL_POLICY = "tool_policy"  # a tool permission and approval policy
    RETRIEVAL_ISOLATION = "retrieval_isolation"  # a retrieval isolation rule
    CODE_CHANGE = "code_change"  # a code change recommendation for developers


class Enforcement(StrEnum):
    """Where a fix takes effect (UC-8.2 step 6)."""

    GATEWAY = "gateway"  # a Sentra Shield policy can carry it (FR-8.3)
    APPLICATION = "application"  # it has to be changed inside the application (6a, UC-8.5)


class JobStatus(StrEnum):
    QUEUED = "queued"  # waits until the finding's running job has finished
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobTrigger(StrEnum):
    REQUESTED = "requested"  # a person selected "Request remediation" (UC-8.2 trigger)
    REVISION = "revision"  # a revision was asked for (1b)


class Remediation(UUIDPrimaryKey, OrganizationScoped, Base):
    """One version of the remediation proposal for a finding."""

    __tablename__ = "remediations"
    __table_args__ = (UniqueConstraint("finding_id", "version"),)

    finding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default=RemediationStatus.DRAFT)
    origin: Mapped[str] = mapped_column(String(10))
    based_on_version: Mapped[int | None]  # the version it revises (1b)
    # The root cause in plain language, and one sentence on what the fixes do together (FR-8.1)
    root_cause: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    # Its fixes come from the LLM, so it is labelled AI-generated until a person approves it
    # (NFR-9.4). A proposal built from the test's recommended mitigation alone is not.
    ai_generated: Mapped[bool] = mapped_column(default=False)
    # How it was generated: {"trigger", "model", "fixes", "dropped", "mitigation_only"}
    generation: Mapped[dict] = mapped_column(JSONB, default=dict)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Who adapted this version (UC-8.3 step 2). They may not approve it themselves (4a).
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The approval or the rejection of UC-8.3 steps 5-6, with its reason (5a1)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )

    fixes: Mapped[list["RemediationFix"]] = relationship(
        back_populates="remediation",
        cascade="all, delete-orphan",
        order_by="RemediationFix.position",
    )


class RemediationFix(UUIDPrimaryKey, Base):
    """One recommended fix of a proposal (a weak entity of its remediation): what to change, and
    whether a gateway can carry it or the application has to change (UC-8.2 step 6)."""

    __tablename__ = "remediation_fixes"
    __table_args__ = (UniqueConstraint("remediation_id", "position"),)

    remediation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("remediations.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]  # 1, 2, 3 … the order the proposal recommends them in
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)  # what it changes and why, in plain language
    # The fix itself, by kind: {"prompt"}, {"rules"}, {"tools"}, {"sources"} or {"steps"}. A
    # shield policy is built from these when FR-8.3 deploys them.
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    enforcement: Mapped[str] = mapped_column(String(15))
    # Why it is a change inside the application, when a gateway could have carried it (6a)
    enforcement_note: Mapped[str | None] = mapped_column(String(200))

    remediation: Mapped[Remediation] = relationship(back_populates="fixes")


class GatewayPosition(StrEnum):
    """Where the gateway sits in the target's traffic (UC-8.1 step 1)."""

    IN_FRONT = "in_front"  # users → Sentra Shield → the application
    BEFORE_MODEL = "before_model"  # the application → Sentra Shield → its LLM provider


class GatewayStatus(StrEnum):
    """What Sentra knows about a gateway (UC-8.1 steps 4-6 with 4a and 5a)."""

    PENDING = "pending"  # the credential is issued; the gateway has never connected
    NOT_IN_PATH = "not_in_path"  # it connected, but the test request didn't pass through it (5a)
    ACTIVE = "active"
    NOT_REPORTING = "not_reporting"  # no heartbeat for three windows (FR-10.6)
    REVOKED = "revoked"


class ShieldGateway(UUIDPrimaryKey, OrganizationScoped, Base):
    """A Sentra Shield gateway in front of one target (FR-8.3, UC-8.1).

    The gateway runs in the target owner's own environment and connects outbound to Sentra: it
    announces itself, reports what it sees and reads its policy. Sentra never opens a connection
    into that environment. Of the credential only the first characters and a SHA-256 are kept, as
    for an API key (NFR-3.1).
    """

    __tablename__ = "shield_gateways"
    __table_args__ = (UniqueConstraint("target_id"),)

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[str] = mapped_column(String(15))
    status: Mapped[str] = mapped_column(String(15), default=GatewayStatus.PENDING)
    credential_prefix: Mapped[str] = mapped_column(String(16))  # sgw_ and six characters
    credential_hash: Mapped[str] = mapped_column(String(64))
    gateway_version: Mapped[str | None] = mapped_column(String(20))  # what it reports (step 4)
    # What it adds to a request, as the gateway measures it (NFR-1.5, median of its window)
    added_latency_ms: Mapped[int | None]
    requests_seen: Mapped[int] = mapped_column(default=0)
    # Step 5: the marker of the harmless test request, and when the gateway reported it
    check_marker: Mapped[str | None] = mapped_column(String(32))
    check_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RemediationComment(UUIDPrimaryKey, OrganizationScoped, Base):
    """One message of the thread a proposal is discussed in (UC-8.3). It belongs to the finding,
    not to one version, and records the version it was written on, so the thread reads in order
    and a reader sees what each comment was about."""

    __tablename__ = "remediation_comments"

    finding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int]
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class RemediationJob(UUIDPrimaryKey, OrganizationScoped, Base):
    """One request for a proposal (UC-8.2 steps 1-2). The page follows it until the draft is
    there, and a finding has at most one running job."""

    __tablename__ = "remediation_jobs"

    finding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"), index=True
    )
    trigger: Mapped[str] = mapped_column(String(20))
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int | None]  # the version it made
    message: Mapped[str | None] = mapped_column(Text)  # why it failed, or used no LLM
