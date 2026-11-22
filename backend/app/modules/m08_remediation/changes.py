"""The changes a remediation needs inside the application (FR-8.3, FR-8.4; UC-8.5).

Approving a proposal splits its fixes in two (UC-8.3 step 6): those a Sentra Shield gateway can
carry become a policy version (UC-8.4), and the rest are changes that only the application's own
developers can make — a code change, or anything the gateway in front of this target cannot see
(UC-8.2, 6a). This module is the second half: each of those fixes becomes an open task on the
finding and in the developer's task list (step 1), the developer marks it as implemented with a
description and, if they have one, a link (step 3), and Sentra records that with their name
(quality requirement 4).

Nothing is closed by a confirmation: a change counts as effective only when the retest confirms it
(quality requirement 5), so marking the last open change starts the retest of UC-8.6 and nothing
else.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m06_findings.models import Finding, FindingEventKind
from app.modules.m08_remediation.models import (
    ApplicationChange,
    ChangeStatus,
    Enforcement,
    Remediation,
    RemediationStatus,
)

MAX_NOTE = 2000
NO_NOTE = (
    "Say in a sentence what you changed in the application: it stays with the change, and the "
    "retest result is read together with it."
)
MAX_LINK = 2048
LINK_SCHEMES = ("http://", "https://")
BAD_LINK = "A link to the change has to start with http:// or https://."


def _now() -> datetime:
    return datetime.now(UTC)


def open_for(db: Session, finding: Finding, remediation: Remediation) -> list[ApplicationChange]:
    """Step 1, when a version is approved: one task per fix that stays the application's work.
    Called again for the same version, it adds nothing (the fix carries the task)."""
    already = {
        change.fix_id: change
        for change in db.scalars(
            select(ApplicationChange).where(ApplicationChange.remediation_id == remediation.id)
        )
    }
    made = []
    for fix in remediation.fixes:
        if fix.enforcement != Enforcement.APPLICATION or fix.id in already:
            continue
        change = ApplicationChange(
            organization_id=finding.organization_id,
            finding_id=finding.id,
            remediation_id=remediation.id,
            fix_id=fix.id,
            position=fix.position,
            title=fix.title,
            status=ChangeStatus.OPEN,
        )
        db.add(change)
        made.append(change)
    if made:
        db.flush()
    return made


def reconcile(
    db: Session, finding: Finding, remediation: Remediation, *, carried: set[int], left: list[dict]
) -> None:
    """After a deployment (UC-8.4 step 1): a fix the new policy version carries is the gateway's
    work, not the developer's, and a fix the gateway could not take is theirs after all.

    The split of UC-8.3 step 6 is made when the proposal is approved, from where each fix was
    said to take effect (UC-8.2 step 6); a gateway that is connected, moved or replaced after
    that changes the answer. So an open task of a fix the version carries is dropped, and a fix
    the deployment left to the application gets one. A task somebody has already marked stays:
    they did the work, and the retest is what judges it.
    """
    tasks = {one.position: one for one in of_version(db, remediation.id)}
    for position, task in tasks.items():
        if position in carried and task.status == ChangeStatus.OPEN:
            db.delete(task)
    for one in left:
        position = int(one.get("fix") or 0)
        fix = next((f for f in remediation.fixes if f.position == position), None)
        if fix is None or position in tasks or position in carried:
            continue
        db.add(
            ApplicationChange(
                organization_id=finding.organization_id,
                finding_id=finding.id,
                remediation_id=remediation.id,
                fix_id=fix.id,
                position=position,
                title=fix.title,
                status=ChangeStatus.OPEN,
            )
        )
    db.flush()


def of_version(db: Session, remediation_id: uuid.UUID) -> list[ApplicationChange]:
    """The tasks of one version of a proposal, in the order the proposal recommends them."""
    return list(
        db.scalars(
            select(ApplicationChange)
            .where(ApplicationChange.remediation_id == remediation_id)
            .order_by(ApplicationChange.position)
        )
    )


def open_of_version(db: Session, remediation_id: uuid.UUID) -> list[ApplicationChange]:
    return [one for one in of_version(db, remediation_id) if one.status == ChangeStatus.OPEN]


def task_list(db: Session, organization_id: uuid.UUID) -> list[ApplicationChange]:
    """Screen 50: every open change of the organization, the oldest first, because it has been
    waiting longest (step 1: they stay visible until they are implemented)."""
    return list(
        db.scalars(
            scoped_select(ApplicationChange, organization_id)
            .where(ApplicationChange.status == ChangeStatus.OPEN)
            .order_by(ApplicationChange.created_at)
        )
    )


def change_row(db: Session, organization_id: uuid.UUID, change_id: uuid.UUID) -> ApplicationChange:
    change = db.scalar(
        scoped_select(ApplicationChange, organization_id).where(ApplicationChange.id == change_id)
    )
    if change is None:  # also another organization's change (NFR-3.3)
        raise NotFoundError("That application change doesn't exist.")
    return change


def mark_implemented(
    db: Session,
    finding: Finding,
    user: User,
    change_id: uuid.UUID,
    *,
    note: str,
    link: str | None = None,
) -> ApplicationChange:
    """Steps 3-5: the developer says what they changed; Sentra records it in the finding's history
    and in the audit log (step 4), and starts the retest once every fix of the proposal is in
    effect (2b1)."""
    from app.modules.m06_findings import triage
    from app.modules.m08_remediation import retest

    change = change_row(db, finding.organization_id, change_id)
    if change.finding_id != finding.id:
        raise NotFoundError("That application change doesn't belong to this finding.")
    if change.status == ChangeStatus.IMPLEMENTED:
        raise ConflictError(
            "This change is already marked as implemented.", code="already_implemented"
        )
    said = " ".join((note or "").split())[:MAX_NOTE]
    if not said:
        raise FieldValidationError("note", NO_NOTE)
    where = (link or "").strip()[:MAX_LINK]
    if where and not where.startswith(LINK_SCHEMES):
        raise FieldValidationError("link", BAD_LINK)
    remediation = db.get_one(Remediation, change.remediation_id)
    if remediation.status not in (RemediationStatus.APPROVED, RemediationStatus.APPLYING):
        raise ConflictError(
            "Only the changes of an approved proposal can be marked as implemented.",
            code="not_approved",
        )
    change.status = ChangeStatus.IMPLEMENTED
    change.note, change.link = said, where or None
    change.implemented_by_id, change.implemented_at = user.id, _now()
    left = [one for one in open_of_version(db, remediation.id) if one.id != change.id]
    # Step 4 in the finding's history (FR-6.5), numbered like Module 6's own entries: the finding
    # is locked until the commit below, as triage locks it.
    triage.record(
        db,
        triage.lock(db, finding.organization_id, finding.code),
        FindingEventKind.CHANGE_IMPLEMENTED,
        actor=user,
        text=f"{change.title}: {said}" + (f" ({change.link})" if change.link else ""),
    )
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=user,
        action="remediation.change_implemented",
        summary=(
            f'Marked the application change "{change.title}" of {finding.code} as implemented: '
            f"{said}"
        ),
        item=audit.Item(
            "remediation", remediation.id, f"{finding.code}, version {remediation.version}"
        ),
        details={
            "finding": finding.code,
            "version": remediation.version,
            "fix": change.position,
            "link": change.link,
            "changes_left": len(left),
        },
    )
    # NFR-2.4: the confirmation, its history entry and its audit entry are one transaction.
    db.commit()
    db.refresh(change)
    # Step 5 with 2b1: the retest starts when nothing of the proposal is open any more.
    retest.after_change(db, finding=finding, remediation=remediation, user=user)
    return change
