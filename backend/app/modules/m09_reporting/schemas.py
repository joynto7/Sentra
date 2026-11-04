import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event: str
    text: str
    subject: str  # shown in bold inside the text
    link: str | None
    count: int
    read_at: datetime | None
    last_event_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int


class UnreadOut(BaseModel):
    unread_count: int


class MarkedOut(BaseModel):
    marked: int


class PreferenceOut(BaseModel):
    event: str
    label: str
    locked: bool  # "Always on for your protection."
    in_app: bool
    email: bool


class PreferenceIn(BaseModel):
    event: str = Field(max_length=40)
    in_app: bool
    email: bool


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str


class ApiKeyOut(BaseModel):
    """One key of the organization (UC-9.6). The key itself is never in it (NFR-3.1)."""

    id: uuid.UUID
    name: str
    purpose: str
    prefix: str  # snt_3f9a2b1c, the only part of the key Sentra keeps
    scopes: list[str]
    scope_labels: list[str]
    targets: list[TargetRef]  # empty: every target of the organization
    created_by: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    revoked_by: str | None
    last_used_at: datetime | None
    state: str  # active, expiring, expired or revoked


class ScopeOut(BaseModel):
    value: str
    label: str
    available: bool  # whether an endpoint accepts it today
    waiting_for: str | None  # what it waits for, when it doesn't


class ApiKeyList(BaseModel):
    rows: list[ApiKeyOut]
    scopes: list[ScopeOut]
    targets: list[TargetRef]


class ApiKeyCreated(ApiKeyOut):
    """Step 4: the key, shown once and never again."""

    key: str


class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    purpose: str = Field(default="", max_length=300)
    scopes: list[str] = Field(min_length=1)
    target_ids: list[uuid.UUID] = Field(default_factory=list)
    expires_at: datetime


class ApiKeyMe(BaseModel):
    """What GET /api-keys/me tells an integration about its own key."""

    name: str
    scopes: list[str]
    scope_labels: list[str]
    targets: list[TargetRef]
    expires_at: datetime
    expires_soon: bool


class ReportOut(BaseModel):
    """One report (FR-9.1) as Screen 52 lists it. The file itself is downloaded separately."""

    id: uuid.UUID
    code: str  # RP-001
    title: str
    type: str
    scope: str
    target: str | None
    campaign_run: str | None
    category: str | None
    period_from: datetime | None
    period_to: datetime | None
    format: str
    status: str  # generating, ready, empty (5a1) or failed
    message: str | None
    summary: dict  # how many findings it counts, and how many await confirmation (2a1)
    checksum: str | None  # SHA-256 of the file, shown beside the download
    size_bytes: int | None
    requested_by: str | None
    schedule: str | None  # the schedule that produced it (FR-9.2)
    created_at: datetime
    finished_at: datetime | None


class RecipientRef(BaseModel):
    id: str
    name: str
    email: str | None = None  # Screen 53 matches a typed address against these (UC-9.2, 3a1)


class ScheduleOut(BaseModel):
    """A standing order for reports (FR-9.2, UC-9.2)."""

    id: uuid.UUID
    name: str
    type: str
    scope: str
    target: str | None
    category: str | None
    period_days: int | None
    format: str
    frequency: str  # after_each_run, weekly or monthly
    status: str  # active or paused (4a)
    recipients: list[RecipientRef]
    created_by: str | None
    created_at: datetime
    next_run_at: datetime | None
    last_run_at: datetime | None


class ReportList(BaseModel):
    rows: list[ReportOut]
    schedules: list[ScheduleOut]
    members: list[RecipientRef]  # who may be a recipient (UC-9.2 step 3)


class ReportRequestIn(BaseModel):
    type: str
    scope: str
    format: str
    target_id: uuid.UUID | None = None
    campaign_run_id: uuid.UUID | None = None
    period_days: int | None = Field(default=None, ge=1, le=3650)
    category: str | None = None


class ScheduleIn(ReportRequestIn):
    name: str = Field(min_length=1, max_length=120)
    frequency: str
    recipient_ids: list[uuid.UUID]


class ScheduleUpdateIn(BaseModel):
    name: str | None = None
    recipient_ids: list[uuid.UUID] | None = None
    frequency: str | None = None
    status: str | None = None


# ---------------------------------------------------------------- the CI/CD gate (FR-9.4)


class GateIn(BaseModel):
    """UC-9.4 steps 1-2: the campaign the gate runs, and the policy it judges by."""

    name: str = Field(min_length=1, max_length=120)
    campaign_code: str
    fail_on: list[str] = Field(default_factory=lambda: ["critical", "high"])
    fail_on_reopened: bool = True


class GateUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    fail_on: list[str] | None = None
    fail_on_reopened: bool | None = None
    status: str | None = None


class GateRunIn(BaseModel):
    """What the pipeline says about the build it is checking (UC-9.5 step 6)."""

    build_ref: str | None = Field(default=None, max_length=200)
    build_commit: str | None = Field(default=None, max_length=80)
    build_url: str | None = Field(default=None, max_length=500)


class GateFindingOut(BaseModel):
    code: str
    title: str
    severity: str
    test: str
    component: str
    why: str  # "new", or "reopened" for a finding that was fixed and came back


class GateRunOut(BaseModel):
    """One call of the gate, as the pipeline and Screen 55 read it."""

    gate: str  # G-001
    number: int
    verdict: str
    # What it decided, in one sentence the pipeline log can print (NFR-4.2)
    message: str | None
    run_code: str | None  # the campaign run it started
    run_status: str | None
    build_ref: str | None
    build_commit: str | None
    build_url: str | None
    compared_with: str | None  # the last accepted run its findings were measured against
    new_findings: list[GateFindingOut]
    breaking: list[GateFindingOut]
    # The policy this release was judged by, in the words of UC-9.4 step 2, so that every result
    # can be explained even after the gate's policy has changed (quality requirement 2)
    policy_words: str
    started_by: str | None  # the key or the person that started it
    started_at: datetime
    finished_at: datetime | None


class GateSuiteOut(BaseModel):
    """A suite of each gate run (UC-9.4 step 1), with the version a run would fix (FR-4.5)."""

    code: str
    found: bool  # false when the suite was archived after the campaign was made
    name: str
    version: int
    test_count: int


class GateOut(BaseModel):
    """A gate with its policy and how its last runs went (UC-9.4 step 3)."""

    code: str
    name: str
    status: str
    target_id: uuid.UUID
    target_name: str
    target_environment: str  # 1a: a gate of a production target is worth saying out loud
    campaign_code: str
    campaign_name: str
    # Step 1: what each gate run sends — the suites with their versions and the attempt budget
    suites: list[GateSuiteOut]
    attempt_budget: int
    # 3a: the campaign's scope approval, which the pipeline needs before it can start a run
    approval_status: str
    fail_on: list[str]
    fail_on_reopened: bool
    policy_words: str
    baseline_run_code: str | None
    baseline_at: datetime | None
    created_by: str | None
    created_at: datetime
    runs: list[GateRunOut]


class GateCampaignRef(BaseModel):
    code: str
    name: str
    target_id: uuid.UUID
    target_name: str
    # What choosing this campaign means for the gate (step 1), and whether its target is the
    # production environment a staging one should be used instead of (1a1)
    target_environment: str
    suite_count: int
    attempt_budget: int
    approval_status: str


class GateList(BaseModel):
    rows: list[GateOut]
    # The campaigns a gate can still be made of (step 1): one gate per campaign
    campaigns: list[GateCampaignRef]


# ---------------------------------------------------------------- webhooks (FR-9.6, UC-9.7)


class WebhookIn(BaseModel):
    """What an administrator enters for a new webhook (step 1)."""

    name: str
    url: str
    events: list[str]


class WebhookUpdateIn(BaseModel):
    name: str | None = None
    url: str | None = None
    events: list[str] | None = None
    status: str | None = None


class WebhookDeliveryOut(BaseModel):
    """One event on its way to one webhook ("Recent deliveries" of Screen 57)."""

    id: uuid.UUID
    event: str
    payload: dict  # the summary that was sent: never evidence or secrets
    attempts: int
    status_code: int | None
    duration_ms: int | None
    error: str | None
    delivered_at: datetime | None
    created_at: datetime


class WebhookOut(BaseModel):
    """One endpoint of Screen 57. The signing secret is never part of it."""

    id: uuid.UUID
    name: str
    url: str
    events: list[str]
    status: str
    verified_at: datetime | None
    secret_created_at: datetime
    secret_is_old: bool
    failures: int
    disabled_at: datetime | None
    created_at: datetime
    created_by: str | None
    last_delivery: WebhookDeliveryOut | None


class WebhookList(BaseModel):
    webhooks: list[WebhookOut]
    # The events that can be chosen, with their labels: the same list as the notifications.
    events: list[dict]


class WebhookCreated(BaseModel):
    """Step 3: the secret, shown this once."""

    webhook: WebhookOut
    secret: str


class WebhookSecretOut(BaseModel):
    secret: str
    webhook: WebhookOut


class WebhookTestOut(BaseModel):
    """Step 4 and 4a1: what the receiving system answered to the test event."""

    ok: bool
    message: str
    webhook: WebhookOut
    delivery: WebhookDeliveryOut
