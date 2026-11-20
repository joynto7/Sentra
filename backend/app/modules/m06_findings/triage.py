"""Triage of a finding (FR-6.5, FR-6.6; UC-6.6 Triage Finding): what the organization decides a
finding means, and what Sentra does with that decision.

One save of Screen 41 carries the whole decision: confirm the finding, or mark it as a false
positive with a reason, or merge it into the finding it duplicates; adjust the severity with a
justification; give it an owner; add a comment. Each of those is recorded as its own entry in the
finding's append-only history and in the audit log (step 5), the owner is notified and the
target's risk score is recalculated (step 6).

Deduplication (FR-6.6) works in two places: the Detection Engine keeps one finding per root cause
by itself (UC-6.2 step 1, the unique index of `findings`), and reopens one that had been fixed
when its root cause comes back (2b1, `reopen_as_regression`). What a root cause can't tell apart —
two findings an analyst judges to be the same weakness — is merged here (2b1). Evidence is written
once and never moved (NFR-2.4), so the merged finding keeps its own rows and the two are read
together through the merge link.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, MembershipStatus, User
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.schema import Severity
from app.modules.m05_campaigns import lifecycle
from app.modules.m05_campaigns.models import CampaignRun
from app.modules.m06_findings.models import (
    OPEN,
    Finding,
    FindingEvent,
    FindingEventKind,
    FindingStatus,
)

CONFIRM = "confirm"
FALSE_POSITIVE = "false_positive"
MERGE = "merge"
DECISIONS = (CONFIRM, FALSE_POSITIVE, MERGE)


@dataclass
class TriageInput:
    """Screen 41. Everything is optional: an analyst may change only the owner, or only add a
    comment, and then the finding keeps its status."""

    decision: str = ""  # confirm, false_positive or merge
    reason: str = ""  # a false positive needs one
    merge_into: str = ""  # the code of the finding this one duplicates, e.g. F-012
    severity: str = ""  # only when the analyst changes it
    justification: str = ""  # needed when the severity changes
    owner_id: uuid.UUID | None = None
    comment: str = ""


def now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- the history (FR-6.5)


def record(
    db: Session,
    finding: Finding,
    kind: str,
    *,
    actor: User | None = None,
    text: str = "",
    was: str | None = None,
    became: str | None = None,
    run: CampaignRun | None = None,
    related: Finding | None = None,
    related_user: User | None = None,
) -> FindingEvent:
    """One entry in the finding's history. `finding` must be locked by the caller, so that the
    entries are numbered without gaps. Without an actor the entry is Sentra's own. The caller
    commits."""
    number = (
        db.scalar(
            select(func.max(FindingEvent.event_no)).where(FindingEvent.finding_id == finding.id)
        )
        or 0
    ) + 1
    entry = FindingEvent(
        organization_id=finding.organization_id,
        finding_id=finding.id,
        event_no=number,
        kind=kind,
        actor_id=actor.id if actor is not None else None,
        actor_name=(actor.name if actor is not None else "Sentra")[:200],
        text=text,
        was=was,
        became=became,
        campaign_run_id=run.id if run is not None else None,
        related_finding_id=related.id if related is not None else None,
        related_user_id=related_user.id if related_user is not None else None,
        created_at=now(),
    )
    db.add(entry)
    db.flush()  # so that the next entry of the same save gets the next number
    return entry


def _audit(
    db: Session, finding: Finding, action: str, summary: str, actor: User | None, details: dict
) -> None:
    """The same action for the organization as a whole (FR-10.2; UC-6.6 step 5)."""
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=actor,
        action=action,
        summary=summary,
        item=audit.Item("finding", finding.id, f"{finding.code} · {finding.title}"),
        details={"finding": finding.code, **details},
        **({} if actor is not None else {"source_address": None}),
    )


def history(db: Session, organization_id: uuid.UUID, finding: Finding) -> list[dict]:
    """The finding's history, oldest first, together with the history of every duplicate that was
    merged into it (UC-6.6, 2b1: their histories are combined). Every member may read it."""
    codes = {finding.id: finding.code}
    for merged in db.scalars(
        scoped_select(Finding, organization_id).where(Finding.merged_into_id == finding.id)
    ):
        codes[merged.id] = merged.code
    rows = db.scalars(
        scoped_select(FindingEvent, organization_id)
        .where(FindingEvent.finding_id.in_(codes))
        .order_by(FindingEvent.created_at, FindingEvent.event_no)
    ).all()
    names = _names(db, {row.related_user_id for row in rows if row.related_user_id})
    merges = {row.related_finding_id for row in rows if row.related_finding_id}
    others = _codes(db, organization_id, merges)
    runs = _run_codes(db, {row.campaign_run_id for row in rows if row.campaign_run_id})
    return [
        {
            "number": row.event_no,
            "kind": row.kind,
            "finding": codes[row.finding_id],  # whose history this entry is (a merged duplicate)
            "actor": row.actor_name,
            "by_sentra": row.actor_id is None,
            "text": row.text,
            "was": row.was,
            "became": row.became,
            "run": runs.get(row.campaign_run_id),
            "finding_related": others.get(row.related_finding_id),
            "user": names.get(row.related_user_id),
            "at": row.created_at,
        }
        for row in rows
    ]


def _names(db: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())


def _codes(db: Session, organization_id: uuid.UUID, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = db.scalars(scoped_select(Finding, organization_id).where(Finding.id.in_(ids)))
    return {row.id: row.code for row in rows}


def _run_codes(db: Session, run_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not run_ids:
        return {}
    runs = db.scalars(select(CampaignRun).where(CampaignRun.id.in_(run_ids)))
    return {run.id: lifecycle.code(run, lifecycle.campaign_of(db, run)) for run in runs}


# ---------------------------------------------------------------- saving a triage (UC-6.6)


def lock(db: Session, organization_id: uuid.UUID, code: str) -> Finding:
    """The finding's row, locked until the caller commits: two analysts triaging it at the same
    moment then act one after the other, on what the other left."""
    from app.modules.m06_findings.service import finding_row

    found = finding_row(db, organization_id, code)
    return db.scalar(
        select(Finding)
        .where(Finding.id == found.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def members(db: Session, organization_id: uuid.UUID) -> list[tuple[uuid.UUID, str, str]]:
    """Who a finding can be assigned to: the active members of the organization (UC-6.6 step 4).
    A finding never leaves its organization (NFR-3.3)."""
    rows = db.execute(
        select(User.id, User.name, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.organization_id == organization_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
        .order_by(User.name)
    ).all()
    return [(row[0], row[1], row[2]) for row in rows]


def options(db: Session, organization_id: uuid.UUID, code: str) -> dict:
    """What Screen 41 needs to triage this finding: the severity the matrix calculated beside the
    one in force (UC-7.1, 4a1), who it can be assigned to with the suggestion of step 4, and the
    target's other open findings, one of which it may duplicate (2b)."""
    from app.modules.m06_findings.service import finding_row

    finding = finding_row(db, organization_id, code)
    suggested = suggested_owner(db, finding)
    owner = _owner(db, organization_id, finding.owner_id)
    duplicates = db.scalars(
        scoped_select(Finding, organization_id)
        .where(
            Finding.target_id == finding.target_id,
            Finding.id != finding.id,
            Finding.status.in_(OPEN),
        )
        .order_by(Finding.number)
    ).all()
    return {
        "code": finding.code,
        "title": finding.title,
        "status": finding.status,
        "open": finding.status in OPEN,
        "requires_confirmation": finding.status == FindingStatus.REQUIRES_CONFIRMATION,
        "severity": finding.severity,
        "calculated_severity": finding.calculated_severity,
        "severity_provisional": finding.severity_provisional,
        "severity_adjusted": finding.severity_adjusted,
        "severity_justification": finding.severity_justification,
        "owner": {"id": owner.id, "name": owner.name} if owner is not None else None,
        "suggested_owner": (
            {"id": suggested[0].id, "name": suggested[0].name, "reason": suggested[1]}
            if suggested is not None
            else None
        ),
        "members": [
            {"id": user_id, "name": name, "role": role}
            for user_id, name, role in members(db, organization_id)
        ],
        "duplicates": [
            {
                "code": other.code,
                "title": other.title,
                "severity": other.severity,
                "status": other.status,
            }
            for other in duplicates
        ],
    }


def save(db: Session, membership: Membership, code: str, data: TriageInput) -> Finding:
    """UC-6.6 steps 2-6 in one save: the decision, the severity, the owner and the comment, each
    recorded in the finding's history and in the audit log, then the owner is notified and the
    target's risk score is recalculated."""
    finding = lock(db, membership.organization_id, code)
    if finding.status not in OPEN:  # precondition: the finding is open
        raise ConflictError(
            f"{finding.code} is closed ({_label(finding.status)}), so it can't be triaged.",
            code="finding_closed",
        )
    actor = db.get_one(User, membership.user_id)
    duplicate = _checked(db, membership.organization_id, finding, data)
    severity = (data.severity or "").strip()
    changes = False

    if data.decision == CONFIRM and finding.status != FindingStatus.CONFIRMED:  # step 2
        was, finding.status = finding.status, FindingStatus.CONFIRMED
        finding.confirmed_at, finding.confirmed_by_id = now(), actor.id
        record(db, finding, FindingEventKind.CONFIRMED, actor=actor, was=was, became=finding.status)
        _audit(
            db,
            finding,
            "finding.confirmed",
            f"Confirmed {finding.code} · {finding.title}",
            actor,
            {"was": was},
        )
        changes = True
    elif data.decision == FALSE_POSITIVE:  # 2a1
        was = finding.status
        _close(finding, FindingStatus.FALSE_POSITIVE, actor, data.reason.strip())
        record(
            db,
            finding,
            FindingEventKind.FALSE_POSITIVE,
            actor=actor,
            text=finding.close_reason,
            was=was,
            became=finding.status,
        )
        _audit(
            db,
            finding,
            "finding.false_positive",
            f"Marked {finding.code} as a false positive",
            actor,
            {"was": was, "reason": finding.close_reason},
        )
        changes = True
    elif data.decision == MERGE and duplicate is not None:  # 2b1 (FR-6.6)
        was = finding.status
        _close(finding, FindingStatus.MERGED, actor, f"Merged into {duplicate.code}.")
        finding.merged_into_id = duplicate.id
        record(
            db,
            finding,
            FindingEventKind.MERGED,
            actor=actor,
            was=was,
            became=finding.status,
            related=duplicate,
        )
        record(db, duplicate, FindingEventKind.MERGED_IN, actor=actor, related=finding)
        _audit(
            db,
            finding,
            "finding.merged",
            f"Merged {finding.code} into {duplicate.code}, which has the same root cause",
            actor,
            {"was": was, "into": duplicate.code},
        )
        changes = True

    if severity and severity != finding.severity:  # step 3 (FR-7.1; UC-7.1, 4a)
        was, finding.severity = finding.severity, severity
        finding.severity_adjusted = True
        finding.severity_justification = data.justification.strip()
        record(
            db,
            finding,
            FindingEventKind.SEVERITY_ADJUSTED,
            actor=actor,
            text=finding.severity_justification,
            was=was,
            became=severity,
        )
        _audit(
            db,
            finding,
            "finding.severity_adjusted",
            f"Adjusted the severity of {finding.code} from {was} to {severity}",
            actor,
            {"was": was, "became": severity, "justification": finding.severity_justification},
        )
        changes = True

    owner = _owner(db, membership.organization_id, data.owner_id)
    assigned = owner if owner is not None and owner.id != finding.owner_id else None
    if assigned is not None:  # step 4
        finding.owner_id, finding.assigned_at = assigned.id, now()
        record(db, finding, FindingEventKind.ASSIGNED, actor=actor, related_user=assigned)
        _audit(
            db,
            finding,
            "finding.assigned",
            f"Assigned {finding.code} to {assigned.name}",
            actor,
            {"owner": assigned.name},
        )

    if comment := data.comment.strip():  # step 4
        record(db, finding, FindingEventKind.COMMENTED, actor=actor, text=comment)
        summary = f"Commented on {finding.code}"
        _audit(db, finding, "finding.commented", summary, actor, {"text": comment})

    db.commit()
    if assigned is not None:
        _tell_owner(db, finding, assigned, actor)
    if changes:  # step 6: what the risk score counts has changed (FR-7.2)
        recalculate(db, finding)
    return finding


def _close(finding: Finding, status: str, actor: User, reason: str) -> None:
    finding.status, finding.close_reason = status, reason
    finding.closed_at, finding.closed_by_id = now(), actor.id


def _label(status: str) -> str:
    return status.replace("_", " ")


def _checked(
    db: Session, organization_id: uuid.UUID, finding: Finding, data: TriageInput
) -> Finding | None:
    """Every problem of the save at once, each named as Screen 41 shows the field. Returns the
    finding to merge into, if one was chosen."""
    errors: list[dict] = []

    def problem(field: str, message: str) -> None:
        errors.append({"field": field, "message": message})

    decision = (data.decision or "").strip()
    if decision and decision not in DECISIONS:
        problem("decision", "Choose what this finding is.")
    if decision == FALSE_POSITIVE and not data.reason.strip():
        problem("reason", "Give the reason why this is a false positive.")

    severity = (data.severity or "").strip()
    if severity and severity not in tuple(Severity):
        problem("severity", "Unknown severity.")
    elif severity and severity != finding.severity and not data.justification.strip():
        # UC-6.6, quality requirement 3: every severity change needs a justification
        problem("justification", "Say why you are changing the severity.")

    duplicate = None
    if decision == MERGE:
        duplicate = _duplicate(db, organization_id, finding, data.merge_into.strip(), problem)
    if data.owner_id is not None and _owner(db, organization_id, data.owner_id) is None:
        problem("owner_id", "Choose an active member of this organization.")

    if errors:
        raise AppError(
            "Some fields are invalid.", code="validation_error", status_code=422, details=errors
        )
    return duplicate


def _duplicate(
    db: Session, organization_id: uuid.UUID, finding: Finding, code: str, problem
) -> Finding | None:
    """2b1: the finding this one duplicates. It must be another open finding of the same target,
    because the same weakness of two targets is two findings."""
    from app.modules.m06_findings.service import finding_row

    if not code:
        problem("merge_into", "Choose the finding this one duplicates.")
        return None
    try:
        other = finding_row(db, organization_id, code)
    except AppError:
        problem("merge_into", f"No finding {code} in this organization.")
        return None
    if other.id == finding.id:
        problem("merge_into", "A finding can't be merged into itself.")
    elif other.target_id != finding.target_id:
        problem("merge_into", f"{other.code} belongs to another target.")
    elif other.status not in OPEN:
        problem(
            "merge_into",
            f"{other.code} is closed ({_label(other.status)}), so nothing can be merged into it.",
        )
    return other


def _owner(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID | None) -> User | None:
    if user_id is None:
        return None
    return db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            User.id == user_id,
            Membership.organization_id == organization_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )


def suggested_owner(db: Session, finding: Finding) -> tuple[User, str] | None:
    """Screen 41's suggestion: whoever registered the target, usually the AI Application
    Developer responsible for it (UC-6.6 step 4)."""
    target = db.get(Target, finding.target_id)
    if target is None or target.created_by_id is None:
        return None
    owner = _owner(db, finding.organization_id, target.created_by_id)
    return (owner, f"owner of {target.name}") if owner is not None else None


def _tell_owner(db: Session, finding: Finding, owner: User, actor: User) -> None:
    """UC-6.6 step 6 (FR-9.3): the owner hears that the finding is theirs now. Whoever assigns a
    finding to themselves is not notified."""
    from app.modules.m09_reporting.notifications import notify

    if owner.id == actor.id:
        return
    notify(
        db,
        event="finding_assigned",
        user_ids=[owner.id],
        organization_id=finding.organization_id,
        text=(
            f"{actor.name} assigned {finding.code} to you: {finding.title} "
            f"({finding.severity.capitalize()}, {_label(finding.status)})"
        ),
        subject=f"{finding.code} is assigned to you",
        link=f"/findings/{finding.code}",
    )


def recalculate(db: Session, finding: Finding) -> None:
    """UC-6.6 step 6: the target's risk score takes the triage into account at once (FR-7.2),
    because what it counts has changed."""
    from app.modules.m07_risk import scoring
    from app.modules.m07_risk.models import ScoreTrigger

    scoring.calculate(
        db,
        organization_id=finding.organization_id,
        target_id=finding.target_id,
        trigger=ScoreTrigger.TRIAGE,
    )
    db.commit()


# ---------------------------------------------------------------- regressions (FR-6.6)


def reopen_as_regression(db: Session, finding: Finding, run: CampaignRun, run_code: str) -> None:
    """UC-6.2, 2b1: the root cause of a finding that had been fixed and verified was detected
    again, so the finding is open once more. It keeps its owner and needs no new confirmation
    (report, Figure 2.6). `finding` is locked; the caller commits and then tells its owner."""
    was, finding.status = finding.status, FindingStatus.REOPENED
    finding.closed_at = finding.closed_by_id = None
    finding.close_reason = ""
    record(
        db,
        finding,
        FindingEventKind.REOPENED,
        text=f"The root cause was detected again in campaign run {run_code}.",
        was=was,
        became=finding.status,
        run=run,
    )
    _audit(
        db,
        finding,
        "finding.reopened",
        f"Reopened {finding.code} as a regression: its root cause came back in {run_code}",
        None,
        {"was": was, "run": run_code},
    )


def tell_regression(db: Session, finding: Finding, run_code: str, target_name: str) -> None:
    """UC-6.2, 2b1: the owner of the reopened finding hears about the regression (FR-9.3). The
    analysts of the organization see it on the run's summary and in the findings list."""
    from app.modules.m09_reporting.notifications import notify

    if finding.owner_id is None:
        return
    notify(
        db,
        event="finding_reopened",
        user_ids=[finding.owner_id],
        organization_id=finding.organization_id,
        text=(
            f"{finding.code} is open again: campaign run {run_code} found its root cause on "
            f"{target_name} after it had been fixed and verified. {finding.title}"
        ),
        subject=f"{finding.code} came back in {run_code}",
        link=f"/findings/{finding.code}",
    )
