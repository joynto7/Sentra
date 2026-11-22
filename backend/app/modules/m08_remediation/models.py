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
    requests_blocked: Mapped[int] = mapped_column(default=0)  # what its policy held back (FR-8.3)
    requests_changed: Mapped[int] = mapped_column(default=0)  # what a masking rule changed
    # The restricted knowledge sources its retrieval rules have seen: {"HR handbook": 12}. The
    # gateway reports what it saw in its window and Sentra adds it up (FR-8.3).
    retrieval_sightings: Mapped[dict] = mapped_column(JSONB, default=dict)
    # The policy version the gateway says it is enforcing. A gateway that reports the version it
    # was offered has activated it, which is step 4's confirmation even if its own call was lost.
    reported_policy_version: Mapped[int] = mapped_column(default=0)
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


class PolicyState(StrEnum):
    """The life of one Shield Policy version (UC-8.4)."""

    SCHEDULED = "scheduled"  # 1a: it waits for the time that was chosen
    PENDING = "pending"  # offered to the gateway, which has not confirmed it yet (step 3)
    ACTIVE = "active"  # the gateway confirmed it (step 4)
    SUPERSEDED = "superseded"  # a later version took over; kept, so FR-8.6 can roll back to it
    ROLLED_BACK = "rolled_back"  # UC-8.8: a rollback took this version out of the traffic
    FAILED = "failed"  # 4a1: the gateway never confirmed it, and the version before stays active


class PolicySource(StrEnum):
    """Why a version exists. FR-8.6 writes the other two in UC-8.8."""

    REMEDIATION = "remediation"  # the fixes of an approved remediation (UC-8.3 step 6)
    ROLLBACK = "rollback"  # the document of an earlier version, deployed again (FR-8.6)
    DISABLED = "disabled"  # the policy switched off: a version with no rules (FR-8.6)


class RuleKind(StrEnum):
    """What a rule of a policy does. Each one comes from one approved fix, and a gateway can only
    carry the kinds its position lets it see (FR-8.3)."""

    TEXT_GUARDRAIL = "text_guardrail"  # terms a person gave, blocked or masked in or out
    TOOL_APPROVAL = "tool_approval"  # a named tool call is held back until a person approves it
    RETRIEVAL_REPORT = "retrieval_report"  # a restricted knowledge source is reported where seen
    SYSTEM_PROMPT = "system_prompt"  # the approved sentences are added to the system prompt


class ShieldPolicy(UUIDPrimaryKey, OrganizationScoped, Base):
    """One version of the Shield Policy of one target (FR-8.3, UC-8.4).

    Every deployment writes a new version and no version is ever changed, so any of them can be
    rolled back to (quality requirement 1, FR-8.6). The document is what the gateway downloads:
    `{"rules": [...]}`, each rule built from one fix of a remediation a person approved.
    """

    __tablename__ = "shield_policies"
    __table_args__ = (UniqueConstraint("target_id", "version"),)

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int]
    state: Mapped[str] = mapped_column(String(12), default=PolicyState.PENDING)
    source: Mapped[str] = mapped_column(String(12), default=PolicySource.REMEDIATION)
    document: Mapped[dict] = mapped_column(JSONB, default=dict)
    rule_count: Mapped[int] = mapped_column(default=0)
    carried_over: Mapped[int] = mapped_column(default=0)  # rules kept from the version before
    # Where its rules come from: [{"finding", "version", "fixes": [position, …]}]
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    based_on_version: Mapped[int | None]  # the version it was built on top of
    # The finding whose approved remediation this version was deployed for. A rollback (FR-8.6)
    # has none: it deploys the document of an earlier version again.
    trigger_finding: Mapped[str | None] = mapped_column(String(20))
    trigger_version: Mapped[int | None]
    # UC-8.4 step 5: the deployment is recorded with the approver of the remediation behind it
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    deployed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    deploy_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 1a
    offered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    offers: Mapped[int] = mapped_column(default=0)  # how often the gateway was told about it (4a)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(String(300))
    # UC-8.8: why somebody rolled back to this version or switched the policy off, in their own
    # words, and the version this one took out of the traffic.
    reason: Mapped[str | None] = mapped_column(String(300))
    rolled_back_from: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


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


class ChangeStatus(StrEnum):
    """An application change of an approved proposal (UC-8.5)."""

    OPEN = "open"  # the developer still has to make it in the application
    IMPLEMENTED = "implemented"  # they say it is done; only the retest proves it (FR-8.5)


class ApplicationChange(UUIDPrimaryKey, OrganizationScoped, Base):
    """One fix of an approved proposal that no gateway can carry, as a task on its finding
    (UC-8.5 step 1, FR-8.4).

    It is opened when the version is approved, one per fix with `enforcement = application`, and
    stays visible on the finding until the developer marks it as implemented (quality
    requirement 1). What they write about it is kept with their name and the time (quality
    requirement 4), and it counts for nothing until the retest confirms it (quality
    requirement 5).
    """

    __tablename__ = "application_changes"
    __table_args__ = (UniqueConstraint("fix_id"),)

    finding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"), index=True
    )
    remediation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("remediations.id", ondelete="CASCADE"), index=True
    )
    fix_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("remediation_fixes.id", ondelete="CASCADE")
    )
    position: Mapped[int]  # the fix's position in the proposal
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(15), default=ChangeStatus.OPEN)
    # Step 3: what the developer changed, and where the change can be seen
    note: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(2048))
    implemented_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    implemented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class RetestStatus(StrEnum):
    """How far the retest of UC-8.6 has come."""

    TESTING = "testing"  # its run is repeating the attempts that found the weakness (steps 2-3)
    CHECKING = "checking"  # the benign requests of step 1 are being sent
    COMPLETED = "completed"  # step 4 to 6: the comparison is there
    FAILED = "failed"  # failed end condition: it can be started again
    CANCELLED = "cancelled"  # a rollback took the fixes out of the traffic again (UC-8.8)


class RetestVerdict(StrEnum):
    """What the repeated attempts showed (UC-8.6 step 5 and 5a)."""

    CLOSED = "closed"  # every repeated attempt was evaluated and none succeeded
    STILL_OPEN = "still_open"  # 5a: at least one succeeded
    # The measurement is incomplete — the run ended early, or a reply could not be evaluated — so
    # nothing is closed on it (quality requirement 5)
    INCONCLUSIVE = "inconclusive"


class Retest(UUIDPrimaryKey, OrganizationScoped, Base):
    """The verification of one remediation version (FR-8.4, FR-8.5; UC-8.6, UC-8.7).

    The report's ER diagram 5 has a remediation *retested in* the campaign runs of type retest
    that verify it: this is that relationship, with everything the comparison of UC-8.7 needs.
    The figures before the fix and the target's risk score before it are stored when the retest
    starts, so that the comparison a person reads never moves under them; the figures after it are
    the run's own attempts, and the benign checks are the rows of `retest_benign_checks`.
    """

    __tablename__ = "retests"
    __table_args__ = (UniqueConstraint("finding_id", "number"),)

    finding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"), index=True
    )
    remediation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("remediations.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int]  # the first, second … retest of this finding
    campaign_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(12), default=RetestStatus.TESTING)
    verdict: Mapped[str | None] = mapped_column(String(15))
    # What was verified (UC-8.7 step 4): the policy version that carries the gateway fixes, and
    # how many changes inside the application the developer had marked.
    policy_version: Mapped[int | None]
    changes_marked: Mapped[int] = mapped_column(default=0)
    test_code: Mapped[str] = mapped_column(String(40))
    repetitions: Mapped[int]  # as in the reproducibility measurement (UC-8.6 step 3)
    # The attempts it repeats: the evidence of the finding, by id, as the run replays them
    replayed: Mapped[list] = mapped_column(JSONB, default=list)
    # Before the fix, frozen when the retest starts: the evaluated attempts of this weakness in
    # the campaign runs up to that moment, and how many of them succeeded
    before_attempts: Mapped[int] = mapped_column(default=0)
    before_successes: Mapped[int] = mapped_column(default=0)
    after_attempts: Mapped[int] = mapped_column(default=0)
    after_successes: Mapped[int] = mapped_column(default=0)
    # Attempts of the run that could not be evaluated, e.g. the LLM judge never answered
    after_unevaluated: Mapped[int] = mapped_column(default=0)
    risk_before: Mapped[int | None]
    risk_band_before: Mapped[str | None] = mapped_column(String(15))
    risk_after: Mapped[int | None]
    risk_band_after: Mapped[str | None] = mapped_column(String(15))
    benign_total: Mapped[int] = mapped_column(default=0)
    benign_blocked: Mapped[int] = mapped_column(default=0)
    benign_changed: Mapped[int] = mapped_column(default=0)
    benign_failed: Mapped[int] = mapped_column(default=0)  # no answer at all, for another reason
    # 1a1: the target has no Benign Request Set of its own, so a generic one was sent and the
    # comparison is less reliable
    benign_generic: Mapped[bool] = mapped_column(default=False)
    # What the comparison says in plain language (NFR-4.2), written when the retest completes
    conclusion: Mapped[str | None] = mapped_column(Text)
    # Whose action was the last fix in effect; None when a gateway confirmed a policy version
    started_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    message: Mapped[str | None] = mapped_column(Text)  # why it failed or was cancelled
    # A comparison the rollback of UC-8.8 has made out of date: what it proved is not in the
    # traffic any more
    out_of_date: Mapped[bool] = mapped_column(default=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BenignOutcome(StrEnum):
    """What became of one benign request in a retest (UC-8.6 step 4)."""

    ANSWERED = "answered"  # the fix left it alone
    BLOCKED = "blocked"  # the policy refused it with the message of the approved fix
    CHANGED = "changed"  # a rule of the policy masked something or held a tool call back
    FAILED = "failed"  # it got no answer, for a reason that is not the policy's


class BenignReview(StrEnum):
    """What a person says about a request the fix affected (Screen 51)."""

    PENDING = "pending"
    FINE = "fine"  # "Looks fine": the answer still does its job
    NEEDS_REVISION = "needs_revision"  # 5a1: the remediation should be revised


class RetestBenignCheck(UUIDPrimaryKey, OrganizationScoped, Base):
    """One example of normal use, sent during a retest and judged by what came back (FR-8.4,
    FR-8.5).

    The examples come from the target's Benign Request Set (Screen 22) or, without one, from the
    generic set (UC-8.6, 1a1). What the policy did with a request is read from the answer itself:
    the gateway's refusal carries the message of the approved fix, and a masked answer carries the
    mask. The reply is stored masked, like an attempt's (NFR-8.2), so that the examples of
    UC-8.7 step 3 can be shown.
    """

    __tablename__ = "retest_benign_checks"
    __table_args__ = (UniqueConstraint("retest_id", "position"),)

    retest_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("retests.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]
    text: Mapped[str] = mapped_column(Text)  # the request as it was sent
    outcome: Mapped[str] = mapped_column(String(10))
    # What the policy did, in the words of its own rule kinds, or why there was no answer
    what_happened: Mapped[str | None] = mapped_column(String(300))
    reply: Mapped[str | None] = mapped_column(Text)  # masked, at most 4 KB
    reply_length: Mapped[int | None]
    status_code: Mapped[int | None]
    duration_ms: Mapped[int | None]
    review: Mapped[str] = mapped_column(String(15), default=BenignReview.PENDING)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
