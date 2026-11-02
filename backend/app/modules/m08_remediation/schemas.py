import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


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


# ---------------------------------------------------------------- verification (FR-8.4, FR-8.5)


class ChangeOut(BaseModel):
    """One change inside the application, as Screen 50 lists it (UC-8.5)."""

    id: uuid.UUID
    finding: FindingRef
    version: int  # the version of the proposal it belongs to
    position: int  # the fix's position in that version
    title: str
    description: str  # what to change, from the approved fix
    status: str  # open or implemented
    note: str | None  # what the developer changed (step 3)
    link: str | None
    implemented_by: str | None
    implemented_at: datetime | None
    approved_by: str | None  # who approved the proposal, and when (step 1)
    approved_at: datetime | None
    progress: str  # "1 of 2 fixes in effect (Shield Policy v5 active)"


class ChangeList(BaseModel):
    """Screen 50: the open changes of the organization, oldest first."""

    rows: list[ChangeOut]
    open_changes: int


class ImplementedIn(BaseModel):
    """Step 3: "Mark as implemented"."""

    note: str = Field(min_length=1, max_length=2000)
    link: str | None = Field(default=None, max_length=2048)


class BenignCheckOut(BaseModel):
    """One request of normal use and what the fix did to it (UC-8.7 step 3)."""

    id: uuid.UUID
    position: int
    text: str
    outcome: str  # answered, blocked, changed or failed
    outcome_label: str
    what_happened: str | None
    reply: str | None  # masked, and only as far as it is needed as an example
    status_code: int | None
    review: str  # pending, fine or needs_revision
    review_label: str
    reviewed_by: str | None
    reviewed_at: datetime | None


class BenignReviewIn(BaseModel):
    """Screen 51: "Looks fine" or "Needs revision" on a request the fix affected."""

    judgement: str  # fine or needs_revision


class RetestSummary(BaseModel):
    """A retest as Screens 45 and 46 mention it."""

    id: uuid.UUID
    number: int
    version: int  # the version of the proposal it verifies
    status: str  # testing, checking, completed, failed or cancelled
    status_label: str
    verdict: str | None  # closed, still_open or inconclusive
    verdict_label: str | None
    running: bool
    out_of_date: bool  # a rollback took what it proved out of the traffic (UC-8.8)
    started_at: datetime
    finished_at: datetime | None


class RetestOut(RetestSummary):
    """Screen 51: the whole comparison of one retest (FR-8.5; UC-8.6, UC-8.7)."""

    finding: FindingRef
    conclusion: str | None  # what it means, in plain language (NFR-4.2)
    message: str | None  # why it couldn't run, or what a rollback did to it
    run_code: str | None  # the retest run it was measured in
    run_status: str | None
    test_code: str
    repetitions: int  # as in the reproducibility measurement (UC-8.6 step 3)
    attempts_repeated: int  # the messages it repeated, each `repetitions` times
    policy_version: int | None  # the Shield Policy version it verified (UC-8.7 step 4)
    changes_marked: int
    figures: dict  # the three comparison cards, each with its figures in words (NFR-4.3)
    benign_checks: list[BenignCheckOut]
    benign_generic: bool  # 1a1: a generic set was used, so it is less reliable


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
    # UC-8.5 and UC-8.6 for the version being shown: what the developer still has to do, and what
    # the retests of this finding found
    changes: list[ChangeOut]
    retests: list[RetestSummary]
    in_effect: str | None  # what the proposal is still waiting for, in one sentence


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
    open_changes: int  # of the newest version (UC-8.5)
    retest: RetestSummary | None  # the newest retest of the finding (UC-8.6)


class RemediationList(BaseModel):
    """Screen 45: the confirmed findings of the organization and their proposals."""

    rows: list[RemediationRow]
    drafts: int  # proposals that await a person
    without_proposal: int  # confirmed findings with no proposal yet
    open_changes: int  # Screen 45's "Application changes (3 open)" tab (UC-8.5)
    retesting: int  # its "Retesting (1)" tab (UC-8.6)


# ---------------------------------------------------------------- Sentra Shield (FR-8.3)


class GatewayOut(BaseModel):
    """One gateway as Screen 47 lists it. The credential itself is never in an answer."""

    id: uuid.UUID
    target_id: uuid.UUID
    target_name: str
    target_environment: str
    position: str  # in_front or before_model (UC-8.1 step 1)
    position_label: str
    status: str  # pending, not_in_path, active, not_reporting or revoked
    status_label: str
    credential_prefix: str  # sgw_ and six characters, so one gateway can be told from another
    gateway_version: str | None
    added_latency_ms: int | None  # what it adds to a request, as it measures itself (NFR-1.5)
    requests_seen: int
    requests_blocked: int  # what its policy held back (FR-8.3)
    requests_changed: int  # what a masking rule of its policy took something out of
    # A restricted knowledge source its policy watches, and how often it has seen one
    retrieval_sightings: dict[str, int]
    policy_version: int  # the version it says it is enforcing
    active_policy_version: int | None  # what Sentra says is active for this target (Screen 47)
    active_policy_since: datetime | None
    in_traffic_path: bool  # the test request of step 5 passed through it
    connected_at: datetime | None
    last_contact_at: datetime | None
    created_at: datetime


class GatewayList(BaseModel):
    rows: list[GatewayOut]
    targets_without_gateway: list[dict]  # "No gateway · Connect" on Screen 47
    heartbeat_seconds: int


class GatewaySecretOut(BaseModel):
    """The answer of UC-8.1 step 2: the credential is here once and nowhere else."""

    gateway: GatewayOut
    credential: str


class GatewayCheckOut(BaseModel):
    gateway: GatewayOut
    seen: bool  # the gateway reported the test request (step 5)
    waiting: bool  # it has not reported yet, and the window has not passed
    message: str | None


class GatewayRegisterIn(BaseModel):
    position: str


class GatewayConnectIn(BaseModel):
    """What the gateway says about itself when it connects (step 4)."""

    version: str = Field(max_length=20)
    position: str = ""


class GatewayHeartbeatIn(BaseModel):
    requests: int = Field(default=0, ge=0)
    blocked: int = Field(default=0, ge=0)  # what its policy held back in the window (FR-8.3)
    changed: int = Field(default=0, ge=0)  # what a masking rule took something out of
    added_latency_ms: int | None = Field(default=None, ge=0)
    markers: list[str] = Field(default_factory=list, max_length=50)
    # The restricted sources its retrieval rules saw, and how often (FR-8.3)
    sightings: dict[str, int] = Field(default_factory=dict)
    # The policy version it is enforcing. A gateway that reports the version it was offered has
    # activated it, which confirms the deployment even if its own confirmation was lost (UC-8.4).
    policy_version: int = Field(default=0, ge=0)

    @field_validator("sightings")
    @classmethod
    def _the_ones_it_watches(cls, value: dict[str, int]) -> dict[str, int]:
        """A gateway reports the sources of its own policy, which holds at most 50 rules, so
        anything beyond that is not something this gateway could have been told to watch."""
        return {str(source)[:120]: max(0, int(count)) for source, count in list(value.items())[:50]}


class GatewayStateOut(BaseModel):
    gateway_id: uuid.UUID
    policy_version: int
    heartbeat_seconds: int


class GatewayPolicyOut(BaseModel):
    version: int
    document: dict


# ---------------------------------------------------------------- Shield Policy versions (UC-8.4)


class PolicyRuleOut(BaseModel):
    """One rule of a version, as a person reads it. The rule itself is in the document the
    gateway downloads; this is what the pages show."""

    id: str
    kind: str
    label: str
    title: str  # the title of the fix a person approved
    says: str  # what the gateway does with it, in one line
    note: str | None = None  # the sentence of the approved fix behind it
    finding: str | None = None
    fix: int | None = None


class PolicyVersionOut(BaseModel):
    version: int
    state: str  # scheduled, pending, active, superseded or failed
    state_label: str
    source: str  # remediation, rollback or disabled
    rule_count: int
    carried_over: int  # rules kept from the version before it
    rules: list[PolicyRuleOut]
    trigger_finding: str | None
    trigger_version: int | None
    based_on_version: int | None
    approved_by: str | None
    deployed_by: str | None
    deploy_at: datetime | None  # 1a: the maintenance window it waits for
    offered_at: datetime | None
    confirmed_at: datetime | None
    failure_reason: str | None
    # UC-8.8: why this version was rolled back to or the policy switched off, and the version it
    # took out of the traffic; `rolled_back_reason` is the sentence written about **this** version
    # when a later rollback removed it.
    reason: str | None
    rolled_back_from: int | None
    rolled_back_reason: str | None
    rule_counts: list[dict]  # Screen 49's card: the five kinds and how many of each
    remediations: list[dict]  # the remediations it carries, as "included remediations"
    created_at: datetime


class PolicyList(BaseModel):
    """What Screens 48 and 49 read: the target's policy, its history, and what could go in next."""

    target_id: uuid.UUID
    target_name: str
    gateway: GatewayOut | None
    active: PolicyVersionOut | None
    waiting: PolicyVersionOut | None  # offered to the gateway, not confirmed yet
    versions: list[PolicyVersionOut]  # newest first
    deployable: list[dict]  # the approved remediations that are not in the policy yet


class GuardrailTermsIn(BaseModel):
    """The terms a guardrail matches, which a person writes (UC-8.4 step 1). Sentra never writes
    them: the approved fix says in words what should be filtered, and this is the exact list."""

    fix: int  # the position of the fix in the approved remediation version
    applies_to: str = "output"
    action: str = "block"
    terms: list[str] = Field(default_factory=list, max_length=20)
    message: str | None = Field(default=None, max_length=300)


class DeployIn(BaseModel):
    finding_code: str = Field(max_length=20)
    version: int | None = None  # the remediation version; the newest approved one by default
    guardrails: list[GuardrailTermsIn] = Field(default_factory=list, max_length=20)
    at: datetime | None = None  # 1a: deploy it in a maintenance window instead of now


class DeployOut(BaseModel):
    policy: PolicyVersionOut
    open_in_application: list[dict]  # 6a: the fixes that stay the developer's work


class RollbackConsequences(BaseModel):
    """What the rollback dialog of Screen 49 states before anything happens (UC-8.8 step 2)."""

    from_version: int
    to_version: int | None  # None switches the policy off (2a)
    disables: bool
    rules_now: int
    rules_after: int
    rules_removed: int
    remediations_stopping: list[dict]  # the fixes that stop being enforced
    findings_reopening: list[str]  # step 5: what only the removed version had proved fixed
    gateway_reachable: bool  # 4a: a gateway that isn't reporting applies it when it comes back
    window_seconds: int


class RollbackIn(BaseModel):
    to_version: int = Field(default=0, ge=0)  # 0 switches the policy off (UC-8.8, 2a)
    reason: str = Field(max_length=300)


class RollbackOut(BaseModel):
    policy: PolicyVersionOut
    consequences: RollbackConsequences


class GatewayConfirmIn(BaseModel):
    """Step 4: the gateway says which version it has activated, and how many rules it holds."""

    version: int = Field(ge=0)
    rules: int | None = Field(default=None, ge=0)
