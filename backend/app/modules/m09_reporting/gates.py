"""The CI/CD security gate of FR-9.4: UC-9.4 Configure Security Gate and UC-9.5 Run Security Gate.

A gate is a campaign of Module 5 that a pipeline may start with an API key, plus the policy its
findings are judged by and the run they are compared with. Nothing here sends anything to a target
itself: the run goes through `runs.launch()` like every other campaign run, and the verdict is
written when that run ends (`hooks.on_run_end`).

The gate never says "pass" without a completed run (UC-9.5, quality requirement 2): a run that was
stopped, cancelled or cut short by a limit ends the gate run as `error`, which is a failure for the
pipeline.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import Item, record
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.modules.m01_users.models import Membership, MembershipStatus, User
from app.modules.m02_targets.models import Target
from app.modules.m05_campaigns import lifecycle, runs
from app.modules.m05_campaigns.models import Campaign, CampaignRun, RunStatus, RunTrigger
from app.modules.m06_findings.models import Finding, FindingStatus
from app.modules.m09_reporting import notifications
from app.modules.m09_reporting.models import (
    ApiKey,
    GateRun,
    GateStatus,
    GateVerdict,
    SecurityGate,
)

SEVERITIES = ("critical", "high", "medium", "low", "informational")
DEFAULT_FAIL_ON = ["critical", "high"]
# Statuses that say a person has already judged the finding away, so it may not fail a release
# (UC-9.5, 5b and 5b1).
DISMISSED = (FindingStatus.FALSE_POSITIVE, FindingStatus.MERGED)


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- the gate itself (UC-9.4)


def gate_row(db: Session, organization_id: uuid.UUID, code: str) -> SecurityGate:
    number = _number_of(code)
    gate = db.scalar(
        select(SecurityGate).where(
            SecurityGate.organization_id == organization_id, SecurityGate.number == number
        )
    )
    if gate is None:
        raise NotFoundError("This security gate doesn't exist.")
    return gate


def _number_of(code: str) -> int:
    try:
        return int(code.upper().removeprefix("G-"))
    except ValueError:
        raise NotFoundError("This security gate doesn't exist.") from None


def check_policy(fail_on: list[str]) -> list[str]:
    """Step 2: the severities a new finding may not have. An empty policy would let everything
    through, which is not a gate, so it is refused at the field."""
    cleaned = [one for one in dict.fromkeys(fail_on) if one in SEVERITIES]
    if not cleaned:
        raise FieldValidationError("fail_on", "Choose at least one severity the gate fails on.")
    return [one for one in SEVERITIES if one in cleaned]


def create(
    db: Session,
    *,
    membership: Membership,
    name: str,
    campaign_code: str,
    fail_on: list[str],
    fail_on_reopened: bool,
) -> SecurityGate:
    """Steps 1-3: the gate is saved for an existing campaign and shows its identifier."""
    organization_id = membership.organization_id
    try:  # the code is C-001; the row is found by its number, as M5 finds it
        campaign = runs.campaign_row(db, organization_id, campaign_code.upper())
    except NotFoundError:
        raise FieldValidationError("campaign_code", "This campaign doesn't exist.") from None
    taken = db.scalar(
        select(SecurityGate.id).where(
            SecurityGate.organization_id == organization_id,
            SecurityGate.campaign_id == campaign.id,
        )
    )
    if taken is not None:
        raise ConflictError(
            "This campaign is already the gate of a release. Use that gate, or make a campaign "
            "of its own for this one.",
            code="campaign_already_a_gate",
        )
    number = (
        db.scalar(
            select(func.max(SecurityGate.number)).where(
                SecurityGate.organization_id == organization_id
            )
        )
        or 0
    ) + 1
    gate = SecurityGate(
        organization_id=organization_id,
        number=number,
        name=name.strip(),
        target_id=campaign.target_id,
        campaign_id=campaign.id,
        fail_on=check_policy(fail_on),
        fail_on_reopened=fail_on_reopened,
        created_by_id=membership.user_id,
    )
    db.add(gate)
    db.flush()
    record(
        db,
        organization_id=organization_id,
        actor=db.get(User, membership.user_id),
        action="gate.created",
        summary=f"Created the security gate {gate.code} {gate.name}",
        item=Item("security_gate", gate.id, gate.code),
        details={"campaign": campaign.code, "policy": _policy_words(gate)},
    )
    db.commit()
    db.refresh(gate)
    return gate


def update(
    db: Session,
    *,
    membership: Membership,
    gate: SecurityGate,
    name: str | None = None,
    fail_on: list[str] | None = None,
    fail_on_reopened: bool | None = None,
    status: str | None = None,
) -> SecurityGate:
    """What a person may change about a gate afterwards: its name, its policy and whether the
    pipeline may start it at all. The campaign and the target stay as they were, because the
    baseline and every earlier run were measured against them."""
    changed: dict[str, object] = {}
    if name is not None and name.strip() != gate.name:
        gate.name = name.strip()
        changed["name"] = gate.name
    if fail_on is not None:
        cleaned = check_policy(fail_on)
        if cleaned != list(gate.fail_on):
            gate.fail_on = cleaned
            changed["fail_on"] = cleaned
    if fail_on_reopened is not None and fail_on_reopened != gate.fail_on_reopened:
        gate.fail_on_reopened = fail_on_reopened
        changed["fail_on_reopened"] = fail_on_reopened
    if status is not None and status != gate.status:
        if status not in tuple(GateStatus):
            raise FieldValidationError("status", "Choose whether the gate is active or paused.")
        gate.status = status
        changed["status"] = status
    if not changed:
        return gate
    gate.updated_at = _now()
    record(
        db,
        organization_id=gate.organization_id,
        actor=db.get(User, membership.user_id),
        action="gate.changed",
        summary=f"Changed the security gate {gate.code} {gate.name}",
        item=Item("security_gate", gate.id, gate.code),
        details=changed,
    )
    db.commit()
    db.refresh(gate)
    return gate


def _policy_words(gate: SecurityGate) -> str:
    """The policy in the words of UC-9.4 step 2, for the audit log and the CLI."""
    names = " or ".join(one.capitalize() for one in gate.fail_on)
    reopened = ", or a fixed finding comes back" if gate.fail_on_reopened else ""
    return f"fail if a new finding of severity {names} appears{reopened}"


# ---------------------------------------------------------------- running it (UC-9.5)


def start(
    db: Session,
    *,
    organization_id: uuid.UUID,
    gate: SecurityGate,
    key: ApiKey | None = None,
    user: User | None = None,
    build_ref: str | None = None,
    build_commit: str | None = None,
    build_url: str | None = None,
) -> GateRun:
    """Step 2: the key's scope was checked by the route, so this launches the gate's campaign and
    writes the gate run that waits for its result. The launch is UC-5.3's own, with the gate
    creator's permissions (1a1), so the approval, the verified target, the one run at a time and
    the monthly limits are checked exactly as they are for a person."""
    if gate.status != GateStatus.ACTIVE:
        raise ConflictError(
            f"The security gate {gate.code} is paused, so it can't be run.", code="gate_paused"
        )
    campaign = db.get_one(Campaign, gate.campaign_id)
    membership = _membership_for(db, gate)
    number = (
        db.scalar(select(func.max(GateRun.number)).where(GateRun.gate_id == gate.id)) or 0
    ) + 1
    made: list[GateRun] = []

    def link(run: CampaignRun) -> None:
        """In the run's own transaction, before its job is queued: a worker that takes the run at
        once has to find the gate run whose verdict it decides."""
        gate_run = GateRun(
            organization_id=organization_id,
            gate_id=gate.id,
            number=number,
            campaign_run_id=run.id,
            build_ref=(build_ref or None),
            build_commit=(build_commit or None),
            build_url=(build_url or None),
            started_by_key_id=key.id if key is not None else None,
            started_by_id=user.id if user is not None else None,
        )
        db.add(gate_run)
        db.flush()
        made.append(gate_run)

    try:
        run = runs.launch(db, membership, campaign.code, trigger=RunTrigger.API, link=link)
    except Exception as exc:  # the pipeline gets a failure, never a pass (2a1, 3a, 4a)
        db.rollback()
        return _could_not_start(
            db, gate, number, key, user, build_ref, build_commit, build_url, str(exc)
        )
    gate_run = db.get_one(GateRun, made[0].id)
    record(
        db,
        organization_id=organization_id,
        actor=user,
        actor_type="api_key" if key is not None else None,
        actor_name=key.name if key is not None else None,
        action="gate.run_started",
        summary=(
            f"Started {gate.code} #{number} of the security gate {gate.name} as "
            f"{lifecycle.code(run, campaign)}"
        ),
        item=Item("security_gate", gate.id, gate.code),
        details={
            "gate_run": number,
            "run": lifecycle.code(run, campaign),
            "build": build_ref or None,
            "commit": build_commit or None,
            "policy": _policy_words(gate),
        },
        **({} if user is not None else {"source_address": None}),
    )
    db.commit()
    db.refresh(gate_run)
    return gate_run


def _could_not_start(
    db: Session,
    gate: SecurityGate,
    number: int,
    key: ApiKey | None,
    user: User | None,
    build_ref: str | None,
    build_commit: str | None,
    build_url: str | None,
    message: str,
) -> GateRun:
    """The run could not be launched at all — an unverified target, a run already in progress, a
    reached limit. The pipeline is told in the only way that is safe: a failure with the reason."""
    gate_run = GateRun(
        organization_id=gate.organization_id,
        gate_id=gate.id,
        number=number,
        verdict=GateVerdict.ERROR,
        build_ref=(build_ref or None),
        build_commit=(build_commit or None),
        build_url=(build_url or None),
        started_by_key_id=key.id if key is not None else None,
        started_by_id=user.id if user is not None else None,
        message=message,
        finished_at=_now(),
    )
    db.add(gate_run)
    db.flush()
    record(
        db,
        organization_id=gate.organization_id,
        actor=user,
        actor_type="api_key" if key is not None else None,
        actor_name=key.name if key is not None else None,
        action="gate.run_error",
        summary=f"{gate.code} #{number} could not start: {message}",
        item=Item("security_gate", gate.id, gate.code),
        details={"gate_run": number, "build": build_ref or None, "reason": message},
        **({} if user is not None else {"source_address": None}),
    )
    db.commit()
    db.refresh(gate_run)
    return gate_run


def _membership_for(db: Session, gate: SecurityGate) -> Membership:
    """1a1: a pipeline runs with the permissions of whoever set the gate up. If that member has
    left, the gate cannot be run until somebody else owns it, which is said as such."""
    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == gate.organization_id,
            Membership.user_id == gate.created_by_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    if membership is None:
        raise ConflictError(
            f"The member who set up the security gate {gate.code} is no longer active in this "
            "organization, so it can't be run. Create the gate again under a current member.",
            code="gate_owner_inactive",
        )
    return membership


# ---------------------------------------------------------------- the verdict (UC-9.5 steps 4-6)


def _root_cause(finding: Finding) -> tuple[str, str, str]:
    """What makes two findings the same weakness: the test and the component it is in."""
    return (finding.test_code, finding.component_kind, finding.component_name)


def _findings_of_run(db: Session, run_id: uuid.UUID) -> list[Finding]:
    return list(
        db.scalars(
            select(Finding)
            .where((Finding.first_run_id == run_id) | (Finding.last_run_id == run_id))
            .order_by(Finding.number)
        )
    )


def _accepted_run_id(db: Session, gate: SecurityGate, before: GateRun) -> uuid.UUID | None:
    """Step 4: the last accepted run — the newest gate run that passed, or else the baseline."""
    passed = db.scalars(
        select(GateRun)
        .where(
            GateRun.gate_id == gate.id,
            GateRun.verdict == GateVerdict.PASSED,
            GateRun.number < before.number,
            GateRun.campaign_run_id.is_not(None),
        )
        .order_by(GateRun.number.desc())
        .limit(1)
    ).first()
    if passed is not None:
        return passed.campaign_run_id
    return gate.baseline_run_id


def _finding_out(finding: Finding, why: str) -> dict:
    return {
        "code": finding.code,
        "title": finding.title,
        "severity": finding.severity,
        "test": finding.test_code,
        "component": finding.component_name,
        "why": why,  # "new" or "reopened"
    }


def decide(db: Session, gate_run: GateRun, run: CampaignRun) -> GateRun:
    """Steps 4-6: the findings of this run against the last accepted one, judged by the policy.

    Called when the campaign run ends, in the run's own transaction, so a gate run is never left
    waiting for a result that nobody will write.
    """
    gate = db.get_one(SecurityGate, gate_run.gate_id)
    if run.status != RunStatus.COMPLETED:
        return _ended(
            db,
            gate,
            gate_run,
            GateVerdict.ERROR,
            f"The campaign run {run.status} before it had finished, so this release was not "
            "checked. The gate fails, because a run that did not complete proves nothing.",
        )

    accepted_id = _accepted_run_id(db, gate, gate_run)
    if accepted_id is None:  # the first completed run is the baseline (UC-9.4)
        gate.baseline_run_id = run.id
        found = [one for one in _findings_of_run(db, run.id) if one.status not in DISMISSED]
        return _ended(
            db,
            gate,
            gate_run,
            GateVerdict.PASSED,
            f"This run is the baseline of {gate.code}: its {len(found)} finding(s) are what the "
            "application has today, and the next release is compared with them.",
        )

    accepted = {_root_cause(one) for one in _findings_of_run(db, accepted_id)}
    new: list[dict] = []
    for finding in _findings_of_run(db, run.id):
        if finding.status in DISMISSED:
            continue  # 5b1: an analyst triaged it away, so it no longer counts
        if _root_cause(finding) not in accepted:
            new.append(_finding_out(finding, "new"))
        elif gate.fail_on_reopened and finding.status == FindingStatus.REOPENED:
            new.append(_finding_out(finding, "reopened"))

    breaking = [one for one in new if one["severity"] in gate.fail_on or one["why"] == "reopened"]
    gate_run.new_findings = new
    gate_run.compared_run_id = accepted_id
    if breaking:
        worst = breaking[0]["severity"].capitalize()
        return _ended(
            db,
            gate,
            gate_run,
            GateVerdict.FAILED,
            f"{len(breaking)} finding(s) break the gate policy, the most severe of them {worst}. "
            "The release is blocked until they are fixed or triaged.",
            breaking=breaking,
        )
    return _ended(
        db,
        gate,
        gate_run,
        GateVerdict.PASSED,
        (
            f"No new finding breaks the policy ({_policy_words(gate)})."
            if not new
            else f"{len(new)} new finding(s), none of them of a severity the policy fails on."
        ),
    )


def _ended(
    db: Session,
    gate: SecurityGate,
    gate_run: GateRun,
    verdict: GateVerdict,
    message: str,
    breaking: list[dict] | None = None,
) -> GateRun:
    gate_run.verdict = verdict
    gate_run.message = message
    gate_run.breaking = breaking or []
    gate_run.finished_at = _now()
    record(
        db,
        organization_id=gate.organization_id,
        actor=None,
        actor_type="system",
        actor_name="Sentra",
        action=f"gate.run_{verdict}",
        summary=f"{gate.code} #{gate_run.number} {verdict}: {message}",
        item=Item("security_gate", gate.id, gate.code),
        details={
            "gate_run": gate_run.number,
            "verdict": verdict,
            "build": gate_run.build_ref,
            "commit": gate_run.build_commit,
            "breaking": [one["code"] for one in (breaking or [])],
        },
        source_address=None,
    )
    return gate_run


def tell_them(db: Session, gate_run: GateRun) -> None:
    """5a1: the developer is notified when a release is blocked. Called after the run's own
    transaction is committed, as every other notification is."""
    if gate_run.verdict not in (GateVerdict.FAILED, GateVerdict.ERROR):
        return
    gate = db.get_one(SecurityGate, gate_run.gate_id)
    target = db.get(Target, gate.target_id)
    owner = target.created_by_id if target is not None else None
    recipients = [one for one in (gate.created_by_id, owner) if one]
    if not recipients:
        return
    build = f" of {gate_run.build_ref}" if gate_run.build_ref else ""
    notifications.notify(
        db,
        event="gate_failed",
        user_ids=recipients,
        organization_id=gate.organization_id,
        subject=f"{gate.code} #{gate_run.number} did not pass",
        text=(f"The security gate {gate.name}{build} did not pass: {gate_run.message}"),
        link=f"/integrations/gates/{gate.code}/runs/{gate_run.number}",
    )


def for_run(db: Session, run_id: uuid.UUID) -> GateRun | None:
    """The gate run a campaign run belongs to, if it was started by a gate."""
    return db.scalars(
        select(GateRun).where(
            GateRun.campaign_run_id == run_id, GateRun.verdict == GateVerdict.RUNNING
        )
    ).first()
