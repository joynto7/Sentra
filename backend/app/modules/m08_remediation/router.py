import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ConflictError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, allowed, require
from app.modules.m06_findings.service import finding_row
from app.modules.m08_remediation import changes, generation, retest, review, service
from app.modules.m08_remediation.models import Remediation, RetestStatus
from app.modules.m08_remediation.schemas import (
    BenignReviewIn,
    ChangeList,
    ChangeOut,
    CommentIn,
    CommentOut,
    EditIn,
    ImplementedIn,
    JobOut,
    RejectIn,
    RemediationList,
    RemediationPage,
    RetestOut,
    VersionSummary,
)
from app.modules.m08_remediation.shield_routes import router as shield_router

remediations = APIRouter(prefix="/remediations", tags=["M8 Remediation"])

# Every member may read the organization's proposals; asking for one is the work of the
# application's developer or a security analyst (UC-8.2 primary actors).
can_request = require(Action.REQUEST_REMEDIATIONS)
# UC-8.3 step 4: a Security Analyst or a Security Manager decides.
can_approve = require(Action.APPROVE_REMEDIATIONS)


def _reader(membership: Membership) -> service.Reader:
    return service.Reader(
        user_id=membership.user_id,
        can_request=allowed(membership.role, Action.REQUEST_REMEDIATIONS),
        can_approve=allowed(membership.role, Action.APPROVE_REMEDIATIONS),
    )


def _version_out(db: Session, remediation: Remediation) -> VersionSummary:
    names = service.names_of(
        db, [remediation.requested_by_id, remediation.edited_by_id, remediation.decided_by_id]
    )
    return service.summary(remediation, names)


@remediations.get("")
def list_remediations(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> RemediationList:
    """Screen 45: the findings that wait for a fix and their proposals."""
    return service.overview(db, membership.organization_id, _reader(membership))


@remediations.get("/{finding_code}")
def get_remediation(
    finding_code: str,
    version: int | None = Query(default=None, ge=1),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> RemediationPage:
    """Screen 46: one version of a finding's proposal (the newest by default) with its fixes."""
    return service.page(
        db, membership.organization_id, finding_code, version, reader=_reader(membership)
    )


@remediations.post("/{finding_code}/generate", status_code=status.HTTP_202_ACCEPTED)
def generate(
    finding_code: str,
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> JobOut:
    """UC-8.2: "Request remediation". A worker writes the draft; follow the job with
    GET .../jobs/{id}. A finding that already has a proposal gets a revision (1b)."""
    finding = finding_row(db, membership.organization_id, finding_code)
    job = generation.request(db, finding, requested_by=membership.user_id)
    return service.get_job(db, finding.id, job.id)


@remediations.get("/{finding_code}/jobs/{job_id}")
def get_job(
    finding_code: str,
    job_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> JobOut:
    """The state of one generation, which the page follows until the draft is there."""
    finding = finding_row(db, membership.organization_id, finding_code)
    return service.get_job(db, finding.id, job_id)


# ---------------------------------------------------------------- review and approval (UC-8.3)


@remediations.post("/{finding_code}/versions", status_code=status.HTTP_201_CREATED)
def adapt(
    finding_code: str,
    data: EditIn,
    version: int = Query(ge=1),
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> VersionSummary:
    """UC-8.3 steps 2-3: the developer's version of the proposal, which asks for approval."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    made = review.edit(
        db,
        finding,
        user,
        version=version,
        fixes=[one.model_dump() for one in data.fixes],
        root_cause=data.root_cause,
        summary=data.summary,
    )
    return _version_out(db, made)


@remediations.post("/{finding_code}/versions/{version}/submit")
def submit(
    finding_code: str,
    version: int,
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> VersionSummary:
    """Step 3 for a draft that needs no change: it goes to the approvers as it is."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    return _version_out(db, review.submit(db, finding, user, version))


@remediations.post("/{finding_code}/versions/{version}/approve")
def approve(
    finding_code: str,
    version: int,
    membership: Membership = Depends(can_approve),
    db: Session = Depends(get_db),
) -> VersionSummary:
    """Steps 5-6: only a person approves a proposal (NFR-9.3), and never one they adapted (4a)."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    return _version_out(db, review.approve(db, finding, user, version))


@remediations.post("/{finding_code}/versions/{version}/reject")
def reject(
    finding_code: str,
    version: int,
    data: RejectIn,
    membership: Membership = Depends(can_approve),
    db: Session = Depends(get_db),
) -> VersionSummary:
    """5a1: the rejected version is kept with the reason it was rejected for."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    return _version_out(db, review.reject(db, finding, user, version, data.reason))


# ---------------------------------------------------------------- verification (UC-8.5 to UC-8.7)


@remediations.get("/changes/open")
def open_changes(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> ChangeList:
    """Screen 50: the changes inside the applications that developers still have to make."""
    return service.changes_page(db, membership.organization_id)


@remediations.post("/{finding_code}/changes/{change_id}/implemented")
def mark_implemented(
    finding_code: str,
    change_id: uuid.UUID,
    data: ImplementedIn,
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> ChangeOut:
    """UC-8.5 steps 3-5: "Mark as implemented". The retest starts when it was the last fix the
    proposal was waiting for (2b1); a change counts for nothing until the retest confirms it."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    change = changes.mark_implemented(db, finding, user, change_id, note=data.note, link=data.link)
    return service.change_out(db, change, service.names_of(db, [change.implemented_by_id]))


@remediations.get("/{finding_code}/retest")
def get_retest(
    finding_code: str,
    number: int | None = Query(default=None, ge=1),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> RetestOut:
    """Screen 51: the before-and-after comparison of a finding's retest (UC-8.7)."""
    return service.retest_page(db, membership.organization_id, finding_code, number)


@remediations.post("/{finding_code}/retest", status_code=status.HTTP_202_ACCEPTED)
def start_retest(
    finding_code: str,
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> RetestOut:
    """The failed end condition of UC-8.6: a retest that couldn't run is started again. Sentra
    starts every other retest by itself, when the fixes take effect — there is no "request
    retest"."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    last = retest.newest(db, finding.id)
    if last is None or last.status not in (RetestStatus.FAILED, RetestStatus.CANCELLED):
        raise ConflictError(
            "Sentra starts the retest of a finding by itself as soon as every fix of its "
            "approved remediation is in effect.",
            code="retest_not_waiting",
        )
    remediation = db.get_one(Remediation, last.remediation_id)
    made = retest.start(db, finding=finding, remediation=remediation, user=user, force=False)
    if made is None:
        raise ConflictError(
            "This finding can't be retested now: its proposal is not approved, or not every fix "
            "of it is in effect.",
            code="retest_not_possible",
        )
    return service.retest_page(db, membership.organization_id, finding_code, made.number)


@remediations.post("/{finding_code}/retest/benign/{check_id}")
def review_benign_check(
    finding_code: str,
    check_id: uuid.UUID,
    data: BenignReviewIn,
    membership: Membership = Depends(can_request),
    db: Session = Depends(get_db),
) -> RetestOut:
    """UC-8.7 step 3: "Looks fine" or "Needs revision" on a request of normal use the fix
    affected. A revision itself is UC-8.2, which the page offers beside it (5a1)."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    number = service.review_benign(db, finding, user, check_id, data.judgement)
    return service.retest_page(db, membership.organization_id, finding_code, number)


@remediations.post("/{finding_code}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    finding_code: str,
    data: CommentIn,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> CommentOut:
    """The review thread of Screen 46. Every member who reads a proposal can answer in it."""
    finding = finding_row(db, membership.organization_id, finding_code)
    user = db.get_one(User, membership.user_id)
    made = review.comment(db, finding, user, data.version, data.text)
    return CommentOut(
        id=made.id,
        version=made.version,
        author=user.name,
        text=made.text,
        created_at=made.created_at,
    )


# The module's router: the proposals above and the Sentra Shield gateways of FR-8.3.
router = APIRouter()
router.include_router(remediations)
router.include_router(shield_router)
