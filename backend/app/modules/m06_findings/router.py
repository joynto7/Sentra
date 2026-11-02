import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import NotFoundError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m04_tests.schema import Category, Severity
from app.modules.m06_findings import service, triage
from app.modules.m06_findings.models import FindingStatus, Outcome
from app.modules.m06_findings.schemas import (
    AttemptDetectionOut,
    EvidenceItem,
    EvidenceOut,
    FindingFiltersOut,
    FindingOut,
    FindingPage,
    HistoryItem,
    RunDetectionPage,
    TriageIn,
    TriageOptionsOut,
)
from app.modules.m09_reporting import api_keys
from app.modules.m09_reporting.models import ApiKeyScope

router = APIRouter(tags=["M6 Detection, Findings & Evidence"])
can_triage = require(Action.TRIAGE_FINDINGS)  # Security Analysts (FR-1.6; UC-6.6)

# FR-9.5: the findings are the part of the API an integration reads, so these endpoints take a
# session as before or an API key that holds "Read findings" (UC-9.6). A key that is limited to
# targets reads only those; every other endpoint of Sentra stays closed to keys.
reads_findings = api_keys.reader(ApiKeyScope.READ_FINDINGS)


def _within(actor: api_keys.Actor, finding: dict) -> None:
    """A key that is limited to targets gets "not found" for every other target's finding."""
    target = (finding.get("target") or {}).get("id")
    if not actor.allows(target):
        raise NotFoundError("Finding not found.")


@router.get("/campaigns/{code}/runs/{number}/detection")
def run_detection(
    code: str,
    number: int,
    outcome: Outcome | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> RunDetectionPage:
    """The verdict of each evaluated attempt of a run (UC-6.1 step 5), for the live campaign
    monitor (Screen 36). Every member of the organization may read it."""
    page_data = service.run_detection(
        db, membership.organization_id, code, number, outcome or "", page, page_size
    )
    return RunDetectionPage.model_validate(page_data)


@router.get("/campaigns/{code}/runs/{number}/attempts/{attempt_no}/detection")
def attempt_detection(
    code: str,
    number: int,
    attempt_no: int,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AttemptDetectionOut:
    """FR-6.1: the result of each detection method of the attempt, stored separately, and the
    combined verdict (Screen 40, "Detection results")."""
    data = service.attempt_detection(db, membership.organization_id, code, number, attempt_no)
    return AttemptDetectionOut.model_validate(data, from_attributes=True)


# ---------------------------------------------------------------- findings (FR-6.2, FR-6.3)


@router.get("/findings")
def list_findings(
    view: Literal["open", "assigned", "requires_confirmation", "closed"] | None = None,
    severity: Severity | None = None,
    category: Category | None = None,
    status: FindingStatus | None = None,
    target_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    search: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    actor: api_keys.Actor = Depends(reads_findings),
    db: Session = Depends(get_db),
) -> FindingPage:
    """UC-6.4: the organization's findings, the most severe first, filtered by quick view
    (Screen 38's tabs, "assigned" being the member's own), severity, category, status, target,
    campaign run, owner or a search. With a campaign run, each finding also says what it was in
    that run: new, seen again or reopened (Screen 37)."""
    limit = actor.target_ids
    if limit and (target_id is None or target_id not in limit):
        # A key that is limited to targets never sees another target's findings; without a filter
        # of its own it reads its first target.
        target_id = limit[0] if target_id is None else None
        if target_id is None:
            return FindingPage.model_validate(
                {"items": [], "total": 0, "page": page, "page_size": page_size, "counts": {}}
            )
    filters = service.FindingFilters(
        view=view or "",
        severity=severity or "",
        category=category or "",
        status=status or "",
        target_id=target_id,
        run_id=run_id,
        owner_id=owner_id,
        search=search,
        user_id=actor.membership.user_id if actor.membership else None,
    )
    data = service.list_findings(db, actor.organization_id, filters, page, page_size)
    return FindingPage.model_validate(data)


@router.get("/findings/filter-options")
def finding_filter_options(
    actor: api_keys.Actor = Depends(reads_findings), db: Session = Depends(get_db)
) -> FindingFiltersOut:
    """The targets, campaign runs and categories that the organization's findings have."""
    data = service.finding_filter_options(db, actor.organization_id)
    return FindingFiltersOut.model_validate(data)


@router.get("/findings/{code}")
def get_finding(
    code: str,
    actor: api_keys.Actor = Depends(reads_findings),
    db: Session = Depends(get_db),
) -> FindingOut:
    """UC-6.5: one finding with its details (FR-6.2), runs and detection (Screen 39)."""
    found = service.finding_detail(db, actor.organization_id, code)
    _within(actor, found)
    return FindingOut.model_validate(found)


# ---------------------------------------------------------------- triage (FR-6.5, FR-6.6)


@router.get("/findings/{code}/history")
def finding_history(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[HistoryItem]:
    """FR-6.5: the finding's history, oldest first, with the history of every duplicate merged
    into it (FR-6.6). It is append-only, so that every decision can be traced; every member of
    the organization may read it."""
    finding = service.finding_row(db, membership.organization_id, code)
    rows = triage.history(db, membership.organization_id, finding)
    return [HistoryItem.model_validate(row) for row in rows]


@router.get("/findings/{code}/triage")
def triage_options(
    code: str, membership: Membership = Depends(can_triage), db: Session = Depends(get_db)
) -> TriageOptionsOut:
    """What Screen 41 needs to triage the finding: the calculated severity beside the one in
    force, who it can be assigned to, and the target's other open findings (UC-6.6, 2b)."""
    return TriageOptionsOut.model_validate(triage.options(db, membership.organization_id, code))


@router.post("/findings/{code}/triage")
def save_triage(
    code: str,
    data: TriageIn,
    membership: Membership = Depends(can_triage),
    db: Session = Depends(get_db),
) -> FindingOut:
    """UC-6.6 Triage Finding: the decision, the severity, the owner and the comment in one save.
    Each one is recorded in the finding's history and in the audit log, the owner is notified and
    the target's risk score is recalculated. A comment on its own is a save with only a comment."""
    triage.save(
        db,
        membership,
        code,
        triage.TriageInput(
            decision=data.decision or "",
            reason=data.reason,
            merge_into=data.merge_into,
            severity=data.severity or "",
            justification=data.justification,
            owner_id=data.owner_id,
            comment=data.comment,
        ),
    )
    return FindingOut.model_validate(service.finding_detail(db, membership.organization_id, code))


@router.get("/findings/{code}/evidence")
def list_evidence(
    code: str,
    actor: api_keys.Actor = Depends(reads_findings),
    db: Session = Depends(get_db),
) -> list[EvidenceItem]:
    """FR-6.3: the finding's evidence records, in the order they were recorded (Screen 40)."""
    _within(actor, service.finding_detail(db, actor.organization_id, code))
    rows = service.list_evidence(db, actor.organization_id, code)
    return [EvidenceItem.model_validate(row) for row in rows]


@router.get("/findings/{code}/evidence/{number}")
def get_evidence(
    code: str,
    number: int,
    actor: api_keys.Actor = Depends(reads_findings),
    db: Session = Depends(get_db),
) -> EvidenceOut:
    """FR-6.3, NFR-2.4: one evidence document, read-only, with the check of its checksum."""
    _within(actor, service.finding_detail(db, actor.organization_id, code))
    data = service.evidence_detail(db, actor.organization_id, code, number)
    return EvidenceOut.model_validate(data)
