import uuid
from datetime import datetime

from pydantic import BaseModel


class TargetRef(BaseModel):
    id: uuid.UUID
    name: str


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


class DashboardOut(BaseModel):
    """UC-7.3 steps 2-3. The trends, the OWASP coverage and the attack paths of Screens 42-44
    come with FR-7.3 and FR-7.4."""

    period_days: int
    last_run_at: datetime | None  # None: no campaign run yet, so the page guides instead (2a1)
    open_by_severity: dict[str, int]
    open_total: int
    awaiting_triage: int
    awaiting_remediation: int
    fixed_and_verified: int  # closed by a retest within the period
    by_status: dict[str, int]
    targets: list[TargetRiskRow]
    top_findings: TopFindings


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
