import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.m07_risk import paths


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str


class LiveRun(BaseModel):
    """A campaign run of the target that is going on now (FR-5.6, M5): queued, running or paused."""

    code: str  # R-238-2
    campaign: str  # C-238: with `number`, the address of the live monitor
    number: int
    status: str


class TargetRiskRow(BaseModel):
    """One row of the "Target risk" table (Screen 42) and of the Risk Score column of Screen 16.
    A target without a score says why instead: its ownership isn't verified, or it has no
    campaign run yet (UC-7.2 precondition)."""

    id: uuid.UUID
    name: str
    type: str
    environment: str
    target_status: str
    owner: str
    score: int | None
    band: str | None
    calculated_at: datetime | None
    last_run_at: datetime | None
    live_run: LiveRun | None = None  # the dashboard says when a run is going on now
    open_total: int
    open_by_severity: dict[str, int]
    awaiting_confirmation: int
    not_scored_reason: str


class TopFindingItem(BaseModel):
    code: str
    title: str
    severity: str
    status: str
    target: TargetRef
    reproducibility: str | None  # None until the finding has been rated (FR-7.1)
    provisional: bool
    last_seen_at: datetime


class TopFindings(BaseModel):
    total: int
    items: list[TopFindingItem]


class CategoryRow(BaseModel):
    """One OWASP category of the dashboard (Screen 42): the open findings it holds and whether it
    has been tested (FR-7.4). `worst_target` names the target the status comes from, and the two
    counts say how many of the targets it applies to were tested."""

    code: str
    name: str | None
    in_scope: bool
    status: str
    label: str  # the status in words, so the table needs no colour (NFR-4.3)
    reason: str
    worst_target: str | None
    tested_targets: int  # tested, and the target hasn't changed since
    applicable_targets: int  # the verified targets it applies to: an unverified one can't be tested
    open_total: int
    open_by_severity: dict[str, int]


class TrendBucket(BaseModel):
    """One part of the period: the findings that came and the ones that were closed."""

    starts_at: datetime
    ends_at: datetime
    new: int
    closed: int


class ScorePoint(BaseModel):
    at: datetime
    score: int
    band: str
    trigger: str
    before_period: bool  # the level the line starts from, calculated before the period


class ScoreSeries(BaseModel):
    target: TargetRef
    score: int | None
    band: str | None
    points: list[ScorePoint]


class Trends(BaseModel):
    """UC-7.3 step 5: the risk scores and the new and closed findings across the period."""

    buckets: list[TrendBucket]
    scores: list[ScoreSeries]
    net_change: int  # new minus closed: below zero means fewer open findings than at the start
    category: str | None


class CoverageTarget(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    environment: str
    target_status: str


class CoverageCell(BaseModel):
    """One cell of the matrix (Screen 43): a status with the facts behind it, so the page can
    write the sentence with its dates."""

    target_id: uuid.UUID
    target_name: str
    status: str
    label: str
    reason: str
    run: dict | None  # the run it was last tested in: code and ended_at
    changed_at: datetime
    open_findings: int
    open_by_severity: dict[str, int]


class CoverageRow(CategoryRow):
    cells: list[CoverageCell]


class CoverageOut(BaseModel):
    """UC-7.4 steps 1-4: the categories or techniques against the targets."""

    framework: str
    targets: list[CoverageTarget]
    rows: list[CoverageRow]
    by_status: dict[str, int]
    legend: list[dict]


class ThreatRef(BaseModel):
    number: int
    title: str
    component: str
    risk: int


class SuiteRef(BaseModel):
    code: str
    name: str
    tests: int  # the tests of the suite that can run against this target
    covering: int  # of those, the ones of this category


class CoverageCellOut(BaseModel):
    """The panel of Screen 43: one cell with the threats behind it, the suites that would cover it
    (UC-7.4 step 5) and an accepted gap (5a1)."""

    framework: str
    code: str
    name: str | None
    in_scope: bool
    target: dict
    cell: CoverageCell
    threat_model_version: int | None
    threats: list[ThreatRef]
    accepted_gap: dict | None
    suites: list[SuiteRef]


class PathNode(BaseModel):
    """One component of the target, as its Target Profile records it (UC-7.5 step 2)."""

    id: str
    kind: str
    name: str
    label: str
    stage: int  # its place in the pipeline, which is the order the graph draws
    note: str
    in_profile: bool
    entry: bool  # what comes from outside: the request itself and the knowledge sources
    impact: str  # what is at stake when a path ends here
    findings: list[str]


class PathEdge(BaseModel):
    """A connection of the profile, with the reason it exists (UC-7.5, quality requirement 4)."""

    from_node: str = Field(alias="from")
    to_node: str = Field(alias="to")
    why: str

    model_config = ConfigDict(populate_by_name=True)


class PathFinding(BaseModel):
    code: str
    title: str
    severity: str
    status: str
    category: str
    unconfirmed: bool  # 3a1: it still requires confirmation (NFR-9.3)
    last_seen_at: datetime
    node_id: str
    component: dict
    in_profile: bool


class PathStep(BaseModel):
    """One component on the way, with every open finding that sits on it."""

    number: int
    sentence: str  # what happens at this component, in plain language (NFR-4.2)
    component: dict
    findings: list[PathFinding]


class AttackPath(BaseModel):
    """One chain of findings from something an attacker can reach to an impact (FR-7.3)."""

    key: str
    code: str  # AP-1, AP-2 …, in the order of the panel; empty for a dismissed path
    severity: str
    impact: str
    description: str
    has_unconfirmed: bool
    node_ids: list[str]
    finding_codes: list[str]
    steps: list[PathStep]
    reason: str | None = None  # why it was dismissed (6a1)
    dismissed_by: str | None = None
    dismissed_at: datetime | None = None


class AttackPathsOut(BaseModel):
    """UC-7.5: the graph, the findings on it and the paths. The findings are always listed, with
    or without a graph (the failed end condition)."""

    target: dict
    blocker: dict | None  # why no graph can be drawn, e.g. no Target Profile yet
    nodes: list[PathNode]
    edges: list[PathEdge]
    paths: list[AttackPath]
    dismissed: list[AttackPath]
    findings: list[PathFinding]
    unconfirmed: int
    no_paths_reason: str  # 4a1: why no multi-step path was found
    profile_version: int | None


class DismissIn(BaseModel):
    reason: str = Field(min_length=paths.MIN_REASON, max_length=300)


class DashboardOut(BaseModel):
    """UC-7.3 steps 2-5 (Screen 42). The attack paths of Screen 44 are AttackPathsOut, and the
    matrix of Screen 43 is CoverageOut."""

    period_days: int
    category: str | None  # the chosen OWASP category, or every category
    category_filtered: bool
    last_run_at: datetime | None  # None: no campaign run yet, so the page guides instead (2a1)
    open_by_severity: dict[str, int]
    open_total: int
    awaiting_triage: int
    awaiting_remediation: int
    fixed_and_verified: int  # closed by a retest within the period
    by_status: dict[str, int]
    targets: list[TargetRiskRow]
    top_findings: TopFindings
    by_category: list[CategoryRow]
    trends: Trends


class ScoreHistoryItem(BaseModel):
    score: int
    band: str
    trigger: str
    calculated_at: datetime
    counted: int


class TargetRiskOut(BaseModel):
    """The risk card of Screen 20 and the history of UC-2.7."""

    target: dict
    score: int | None
    band: str | None
    calculated_at: datetime | None
    trigger: str | None
    last_run_at: datetime | None
    counted: int
    counted_by_severity: dict[str, int]
    counted_codes: list[str]  # which findings the score is based on (UC-7.2)
    factors: dict
    awaiting_confirmation: int
    open_total: int
    open_by_severity: dict[str, int]
    not_scored_reason: str
    history: list[ScoreHistoryItem]


class FindingSeverityOut(BaseModel):
    """FR-7.1 with its factors (NFR-4.2), and the calculated severity beside the one an analyst
    set (UC-7.1, 4a1)."""

    code: str
    severity: str
    calculated_severity: str | None
    adjusted: bool
    provisional: bool
    rated_at: datetime | None
    reproducibility: str | None
    test_severity: str | None
    factors: dict


class MethodOut(BaseModel):
    """The rules themselves: the rating matrix (FR-7.1) and the bands (FR-7.2)."""

    severity: dict
    bands: list[dict]
