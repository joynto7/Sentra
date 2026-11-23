"""Review and approval of a remediation proposal (FR-8.2, UC-8.3).

A stored version is never changed: adapting a proposal writes the next version (UC-8.3 steps 2-3),
which is sent for approval in the same step. A Security Analyst or a Security Manager approves or
rejects it, and the person who adapted a version may never approve that version (4a). Nothing a
proposal recommends takes effect before that approval (NFR-9.3).
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m02_targets.models import Target
from app.modules.m06_findings.models import Finding
from app.modules.m08_remediation import fixes as fix_rules
from app.modules.m08_remediation.models import (
    Enforcement,
    FixKind,
    Origin,
    Remediation,
    RemediationComment,
    RemediationFix,
    RemediationStatus,
)

# UC-8.3 step 4: a Security Analyst or a Security Manager approves. The permission itself is
# checked by the route; these are the roles the page names as the people who can do it.
APPROVER_ROLES = (Role.SECURITY_ANALYST, Role.SECURITY_MANAGER)
OPEN = (RemediationStatus.DRAFT, RemediationStatus.AWAITING_APPROVAL)
MAX_COMMENT = 2000


def _now() -> datetime:
    return datetime.now(UTC)


def version_row(db: Session, finding_id: uuid.UUID, version: int) -> Remediation:
    row = db.scalar(
        select(Remediation).where(
            Remediation.finding_id == finding_id, Remediation.version == version
        )
    )
    if row is None:
        raise NotFoundError(f"Version {version} of this proposal doesn't exist.")
    return row


def _newest(db: Session, finding_id: uuid.UUID) -> Remediation | None:
    return db.scalars(
        select(Remediation)
        .where(Remediation.finding_id == finding_id)
        .order_by(Remediation.version.desc())
        .limit(1)
    ).first()


def _only_newest(db: Session, remediation: Remediation) -> None:
    """An earlier version is history: it is read, not worked on."""
    newest = _newest(db, remediation.finding_id)
    if newest is not None and newest.version != remediation.version:
        raise ConflictError(
            f"Version {newest.version} is the newest one. Open it to work on the proposal.",
            code="not_the_newest_version",
        )


def approvers(db: Session, organization_id: uuid.UUID) -> dict[uuid.UUID, str]:
    """Who may approve in this organization (step 4), for the panel of Screen 46."""
    rows = db.execute(
        select(User.id, User.name)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.organization_id == organization_id,
            Membership.status == MembershipStatus.ACTIVE,
            Membership.role.in_(APPROVER_ROLES),
        )
        .order_by(User.name)
    ).all()
    return {one[0]: one[1] for one in rows}


def on_approval(remediation: Remediation) -> list[str]:
    """What approving this version will start (step 6), written out before anybody approves."""
    gateway = [fix for fix in remediation.fixes if fix.enforcement == Enforcement.GATEWAY]
    application = [fix for fix in remediation.fixes if fix.enforcement == Enforcement.APPLICATION]
    lines = []
    if gateway:
        lines.append(
            f"{len(gateway)} {'fix goes' if len(gateway) == 1 else 'fixes go'} into the target's "
            "next Sentra Shield policy version."
        )
    if application:
        lines.append(
            f"{len(application)} {'fix becomes' if len(application) == 1 else 'fixes become'} a "
            "task for the application's developer."
        )
    lines.append("A retest starts when every fix of the proposal is in effect.")
    return lines


def cannot_approve(remediation: Remediation, user_id: uuid.UUID, allowed: bool) -> str | None:
    """Why this person may not approve this version — the rule of 4a, or their role."""
    if remediation.status != RemediationStatus.AWAITING_APPROVAL:
        return None
    if remediation.edited_by_id == user_id:
        return (
            "You adapted this version, so somebody else has to approve it: a proposal is never "
            "approved by the person who last changed it."
        )
    if not allowed:
        return "Only a Security Analyst or a Security Manager can approve a proposal."
    return None


# ---------------------------------------------------------------- adapting it (steps 2-3)


def _clean_details(kind: str, details: dict) -> dict:
    """The body of a fix, by kind: a prompt is text, tools and sources are rows of a name and its
    rule, and the other two are a list of lines. The shape has to survive a person's edit: FR-8.3
    builds a policy rule from the name in a row, so a row may never become a line of text."""
    key = fix_rules.DETAIL_KEYS[FixKind(kind)]
    value = details.get(key)
    if key == "prompt":
        text = str(value or "").strip()
        if not text:
            raise FieldValidationError("fixes", "A system prompt fix needs its prompt.")
        return {"prompt": text[:4000]}
    if key in ("tools", "sources"):
        name = "tool" if key == "tools" else "source"
        rows = [
            {
                name: str(one.get(name, "")).strip()[:120],
                "rule": str(one.get("rule", "")).strip()[:300],
            }
            for one in (value or [])
            if isinstance(one, dict) and str(one.get(name, "")).strip()
        ]
        if not rows:
            raise FieldValidationError(
                "fixes", f"Every row of this fix needs the {name} it is about."
            )
        return {key: rows[:20]}
    lines = [str(one).strip()[:400] for one in (value or []) if str(one).strip()]
    if not lines:
        raise FieldValidationError("fixes", "A fix needs at least one line.")
    return {key: lines[:20]}


def edit(
    db: Session,
    finding: Finding,
    user: User,
    *,
    version: int,
    fixes: list[dict],
    root_cause: str,
    summary: str,
) -> Remediation:
    """Steps 2-3: the person's version of the proposal, which asks for approval in the same step.

    `fixes` holds the fixes that stay, each with its position in the version it comes from; a fix
    that was dropped is simply not in the list. The kind of a fix and where it is enforced are
    Sentra's (UC-8.2 step 6 with 6a), so they are copied, never taken from the request.
    """
    before = version_row(db, finding.id, version)
    _only_newest(db, before)
    if before.status not in OPEN:
        raise ConflictError(
            f"Version {version} is {before.status.replace('_', ' ')}, so it can't be changed. "
            "Ask for a revision instead.",
            code="version_closed",
        )
    if not root_cause.strip() or not summary.strip():
        raise FieldValidationError("root_cause", "The root cause and the summary can't be empty.")
    keep = {one["position"]: one for one in fixes}
    sources = [fix for fix in before.fixes if fix.position in keep]
    if not sources:
        raise FieldValidationError("fixes", "A proposal needs at least one fix.")

    remediation = Remediation(
        organization_id=finding.organization_id,
        finding_id=finding.id,
        version=before.version + 1,
        status=RemediationStatus.AWAITING_APPROVAL,
        origin=Origin.EDITED,
        based_on_version=before.version,
        root_cause=root_cause.strip(),
        summary=summary.strip(),
        # NFR-9.4: a version a person adapted still rests on what the model wrote.
        ai_generated=before.ai_generated,
        generation=before.generation,
        requested_by_id=before.requested_by_id,
        edited_by_id=user.id,
        submitted_at=_now(),
    )
    db.add(remediation)
    db.flush()
    for position, source in enumerate(sources, start=1):
        change = keep[source.position]
        db.add(
            RemediationFix(
                remediation_id=remediation.id,
                position=position,
                kind=source.kind,
                title=str(change.get("title") or source.title).strip()[:200],
                description=str(change.get("description") or source.description).strip(),
                details=_clean_details(source.kind, change.get("details") or source.details),
                enforcement=source.enforcement,
                enforcement_note=source.enforcement_note,
            )
        )
    dropped = len(before.fixes) - len(sources)
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=user,
        action="remediation.edited",
        summary=(
            f"Adapted the remediation proposal for {finding.code} as version {remediation.version}"
            + (f", {dropped} fix(es) dropped" if dropped else "")
        ),
        item=audit.Item(
            "remediation", remediation.id, f"{finding.code}, version {remediation.version}"
        ),
        details={"version": remediation.version, "based_on": before.version, "dropped": dropped},
    )
    db.commit()
    db.refresh(remediation)
    _ask_for_approval(db, finding, remediation, user)
    return remediation


def submit(db: Session, finding: Finding, user: User, version: int) -> Remediation:
    """Step 3 for a draft nobody had to change: it goes to the approvers as it is."""
    remediation = version_row(db, finding.id, version)
    _only_newest(db, remediation)
    if remediation.status == RemediationStatus.AWAITING_APPROVAL:
        raise ConflictError("This version is already waiting for approval.", code="already_sent")
    if remediation.status != RemediationStatus.DRAFT:
        raise ConflictError(
            f"Version {version} is {remediation.status.replace('_', ' ')}.", code="version_closed"
        )
    remediation.status = RemediationStatus.AWAITING_APPROVAL
    remediation.submitted_at = _now()
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=user,
        action="remediation.submitted",
        summary=f"Sent version {version} of the proposal for {finding.code} for approval",
        item=audit.Item("remediation", remediation.id, f"{finding.code}, version {version}"),
        details={"version": version},
    )
    db.commit()
    db.refresh(remediation)
    _ask_for_approval(db, finding, remediation, user)
    return remediation


# ---------------------------------------------------------------- the decision (steps 4-6)


def _decide(
    db: Session,
    finding: Finding,
    user: User,
    version: int,
    *,
    status: str,
    reason: str | None,
) -> Remediation:
    remediation = version_row(db, finding.id, version)
    if remediation.status != RemediationStatus.AWAITING_APPROVAL:
        raise ConflictError(
            f"Version {version} is not waiting for approval.", code="not_awaiting_approval"
        )
    # 4a: the person who adapted a version may not approve that version, whatever their role.
    if remediation.edited_by_id == user.id:
        raise ConflictError(
            "You adapted this version, so another Security Analyst or Security Manager has to "
            "approve it.",
            code="edited_it_yourself",
        )
    remediation.status = status
    remediation.decided_by_id = user.id
    remediation.decided_at = _now()
    remediation.decision_reason = reason
    approved = status == RemediationStatus.APPROVED
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=user,
        action="remediation.approved" if approved else "remediation.rejected",
        summary=(
            f"{'Approved' if approved else 'Rejected'} version {version} of the remediation "
            f"proposal for {finding.code}" + (f": {reason}" if reason else "")
        ),
        item=audit.Item("remediation", remediation.id, f"{finding.code}, version {version}"),
        details={"version": version, "reason": reason},
    )
    # NFR-2.4: the decision and its audit entry are one transaction.
    db.commit()
    db.refresh(remediation)
    _tell_about_the_decision(db, finding, remediation, user, approved=approved)
    if approved:
        # Step 6: the fixes a gateway can carry become the target's next Shield Policy version
        # (UC-8.4), and the others become the developer's open tasks (UC-8.5 step 1). A deployment
        # that cannot start says so and leaves the approval as it is.
        from app.modules.m08_remediation import changes, policies

        changes.open_for(db, finding, remediation)
        db.commit()
        policies.after_approval(db, finding, remediation, user)
    return remediation


def approve(db: Session, finding: Finding, user: User, version: int) -> Remediation:
    """Steps 5-6: only a person approves (NFR-9.3), and the approval is recorded with them."""
    return _decide(db, finding, user, version, status=RemediationStatus.APPROVED, reason=None)


def reject(db: Session, finding: Finding, user: User, version: int, reason: str) -> Remediation:
    """5a1: the rejected version is kept with its reason, and the developer can revise it."""
    if not reason.strip():
        raise FieldValidationError("reason", "Say why you are rejecting the proposal.")
    return _decide(
        db,
        finding,
        user,
        version,
        status=RemediationStatus.REJECTED,
        reason=reason.strip()[:1000],
    )


# ---------------------------------------------------------------- the thread


def comments(db: Session, finding_id: uuid.UUID) -> list[RemediationComment]:
    return list(
        db.scalars(
            select(RemediationComment)
            .where(RemediationComment.finding_id == finding_id)
            .order_by(RemediationComment.created_at)
        )
    )


def comment(
    db: Session, finding: Finding, user: User, version: int, text: str
) -> RemediationComment:
    """A message of the review thread. Every member of the organization can read a proposal, so
    every member can answer in it; who wrote what is recorded with the comment."""
    if not text.strip():
        raise FieldValidationError("text", "Write something before you send it.")
    version_row(db, finding.id, version)  # a comment belongs to a version that exists
    row = RemediationComment(
        organization_id=finding.organization_id,
        finding_id=finding.id,
        version=version,
        author_id=user.id,
        text=text.strip()[:MAX_COMMENT],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------- who hears about it


def _target_name(db: Session, finding: Finding) -> str:
    target = db.scalar(
        scoped_select(Target, finding.organization_id).where(Target.id == finding.target_id)
    )
    return target.name if target else "the target"


def _ask_for_approval(db: Session, finding: Finding, remediation: Remediation, user: User) -> None:
    """Step 3: the analysts and managers are asked to review it — except the person who edited
    it, who may not approve it anyway (4a)."""
    from app.modules.m09_reporting.notifications import notify

    recipients = [one for one in approvers(db, finding.organization_id) if one != user.id]
    if not recipients:
        return
    notify(
        db,
        event="approval_requested",
        user_ids=recipients,
        organization_id=finding.organization_id,
        text=(
            f"{user.name} asks you to approve version {remediation.version} of the remediation "
            f"for {finding.code} ({_target_name(db, finding)}): {len(remediation.fixes)} fixes."
        ),
        subject=f"{finding.code} {finding.title}",
        link=f"/remediation/{finding.code}",
    )


def _tell_about_the_decision(
    db: Session, finding: Finding, remediation: Remediation, user: User, *, approved: bool
) -> None:
    """Step 6: the people who worked on the proposal hear what was decided."""
    from app.modules.m09_reporting.notifications import notify

    recipients = {
        one
        for one in (remediation.edited_by_id, remediation.requested_by_id)
        if one and one != user.id
    }
    if not recipients:
        return
    reason = f" Reason: {remediation.decision_reason}" if remediation.decision_reason else ""
    notify(
        db,
        event="remediation_decided",
        user_ids=list(recipients),
        organization_id=finding.organization_id,
        text=(
            f"{user.name} {'approved' if approved else 'rejected'} version {remediation.version} "
            f"of the remediation for {finding.code} ({_target_name(db, finding)}).{reason}"
        ),
        subject=f"{finding.code} {finding.title}",
        link=f"/remediation/{finding.code}",
    )
