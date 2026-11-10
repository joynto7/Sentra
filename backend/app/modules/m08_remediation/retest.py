"""The automatic retest of a remediation (FR-8.4; UC-8.6), and what starts and stops it.

A finding is retested once **every** fix of its approved proposal is in effect: the gateway fixes
when the policy version that carries them is active (UC-8.4 step 6), and the changes inside the
application when the developer has marked each of them as implemented (UC-8.5 step 5). Both paths
end here, in `after_deployment()` and `after_change()`, and both ask the same question in the same
place, `all_in_effect()`.

What a retest is:

1. **the same requests again.** The attempts that are the finding's evidence are sent again, each
   as often as the measurement its severity is based on repeated it (step 3), so that before and
   after are comparable (quality requirement 3). The messages are the stored ones: a retest
   repeats what was answered before, it does not build attempts of its own.
2. **an ordinary campaign run**, of type retest and without a campaign (`runs.start_retest()`), so
   the ownership check before the first attempt, the target's request rate, the organization's
   monthly limits, pause and stop and the Detection Engine all apply unchanged (step 2).
3. **the benign requests** of the target beside it (`benign.py`), so a fix that closes the weakness
   but breaks normal use is seen (quality requirement 1).
4. **a comparison** (`comparison.py`): the attack success rate before and after, what the fix did
   to normal use, and the change in the target's risk score (FR-8.5, UC-8.7).

A finding becomes `fixed_and_verified` only when every repeated attempt was evaluated and none of
them succeeded (step 5, quality requirement 5). If one succeeded the finding stays open and the
remediation is ineffective (5a1); if the measurement is incomplete nothing is closed on it, and
the retest can be started again (failed end condition).
"""

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError
from app.core.tenancy import scoped_select
from app.llm.usage import cost_of_run
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns import lifecycle, runs
from app.modules.m05_campaigns.models import (
    ACTIVE,
    Attempt,
    AttemptStatus,
    CampaignRun,
    EndReason,
    RunStatus,
)
from app.modules.m06_findings.models import (
    CLOSED,
    DetectionVerdict,
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    Outcome,
)
from app.modules.m07_risk import scoring
from app.modules.m07_risk.models import ScoreTrigger
from app.modules.m08_remediation import benign, changes, comparison
from app.modules.m08_remediation.models import (
    ChangeStatus,
    Remediation,
    RemediationStatus,
    Retest,
    RetestBenignCheck,
    RetestStatus,
    RetestVerdict,
)
from app.workers import jobs

log = logging.getLogger("uvicorn.error")
JOB = "remediation.finish_retest"
DEFAULT_REPETITIONS = 5  # as m07_risk/rating.py uses when a run recorded none
MAX_VARIANTS = 3  # a template has at most three messages (orchestrator/templates.py)
# How often the end of a retest comes back, and after how long: for the examples of normal use
# that the target's rate has not let through yet, and for a verdict the LLM judge still owes.
MAX_WAITS = 10
WAIT_SECONDS = 60
RUNNING = (RetestStatus.TESTING, RetestStatus.CHECKING)
STOPPED_BY_ROLLBACK = (
    "Stopped because the Sentra Shield policy was rolled back: the fixes this retest was "
    "verifying are not in the traffic any more."
)
CANCELLED_BY_ROLLBACK = (
    "A rollback took the fixes out of the traffic again, so there was nothing left to verify."
)
OUT_OF_DATE = "The policy version this retest verified was rolled back."
IN_EFFECT = "Every fix of this proposal is in effect."
NOTHING_MEASURED = "No attempt of this retest was sent, so nothing was measured."


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- when a retest starts


def all_in_effect(db: Session, finding: Finding, remediation: Remediation) -> tuple[bool, str]:
    """UC-8.6's trigger: is every fix of this approved version in effect? The second value says
    what is still missing, for the people who are waiting for it.

    A fix is in effect when the **active** policy version of the target carries a rule that came
    from it (UC-8.4 step 6), or when the developer has marked it as implemented in the application
    (UC-8.5 step 5). Neither of those is a promise: it is what is in the traffic now. So a fix
    nothing carries holds the retest up, whether it waits for a deployment, for a developer, or
    for the terms of its guardrail (UC-8.4 step 1) — and the sentence says which.
    """
    if remediation.status not in (RemediationStatus.APPROVED, RemediationStatus.APPLYING):
        return False, "The proposal is not approved."
    if not remediation.fixes:
        return False, "This version proposes no fix, so there is nothing to verify."
    carried = carried_positions(db, finding, remediation)
    tasks = {one.position: one for one in changes.of_version(db, remediation.id)}
    done = {position for position, one in tasks.items() if one.status == ChangeStatus.IMPLEMENTED}
    waiting = [fix.position for fix in remediation.fixes if fix.position not in carried | done]
    if not waiting:
        return True, IN_EFFECT
    open_changes = [one for one in waiting if one in tasks]
    at_gateway = [one for one in waiting if one not in tasks]
    said = []
    if open_changes:
        said.append(
            f"{len(open_changes)} change{'' if len(open_changes) == 1 else 's'} inside the "
            "application " + ("is" if len(open_changes) == 1 else "are") + " still open."
        )
    if at_gateway:
        said.append(
            f"{len(at_gateway)} fix{'' if len(at_gateway) == 1 else 'es'} of this proposal "
            + ("waits" if len(at_gateway) == 1 else "wait")
            + " for a Sentra Shield policy version that carries "
            + ("it" if len(at_gateway) == 1 else "them")
            + " to be active."
        )
    return False, " ".join(said)


def carried_positions(db: Session, finding: Finding, remediation: Remediation) -> set[int]:
    """The fixes of this proposal that the target's active policy version really carries: the
    rules of its document say which fix each of them came from (policies.rules_of_fix)."""
    from app.modules.m08_remediation import policies

    active = policies.current(db, finding.target_id)
    found: set[int] = set()
    for rule in ((active.document or {}).get("rules") if active else []) or []:
        where = rule.get("from") or {}
        if (
            str(where.get("finding")) == finding.code
            and int(where.get("version") or 0) == remediation.version
        ):
            found.add(int(where.get("fix") or 0))
    return found


def verified_policy_version(db: Session, finding: Finding, remediation: Remediation) -> int | None:
    """The active policy version that carries this proposal's fixes, or None — what the comparison
    says it verified (UC-8.7 step 4)."""
    from app.modules.m08_remediation import policies

    active = policies.current(db, finding.target_id)
    if active is None:
        return None
    if carried_positions(db, finding, remediation):
        return active.version
    return (
        active.version
        if active.trigger_finding == finding.code
        and (active.trigger_version == remediation.version)
        else None
    )


def after_deployment(
    db: Session, *, finding: Finding, remediation: Remediation, policy=None
) -> "Retest | None":
    """UC-8.4 step 6: a gateway confirmed a version, so the fixes it carries are in effect."""
    return start(db, finding=finding, remediation=remediation)


def after_change(
    db: Session, *, finding: Finding, remediation: Remediation, user: User | None = None
) -> "Retest | None":
    """UC-8.5 step 5 with 2b1: the developer marked a change; the retest starts when it was the
    last thing the proposal was waiting for."""
    return start(db, finding=finding, remediation=remediation, user=user)


def running_for(db: Session, remediation_id: uuid.UUID) -> Retest | None:
    return db.scalar(
        select(Retest)
        .where(Retest.remediation_id == remediation_id, Retest.status.in_(RUNNING))
        .order_by(Retest.number.desc())
    )


def of_finding(db: Session, finding_id: uuid.UUID) -> list[Retest]:
    """Every retest of a finding, the newest first."""
    return list(
        db.scalars(
            select(Retest).where(Retest.finding_id == finding_id).order_by(Retest.number.desc())
        )
    )


def newest(db: Session, finding_id: uuid.UUID) -> Retest | None:
    found = of_finding(db, finding_id)
    return found[0] if found else None


def start(
    db: Session,
    *,
    finding: Finding,
    remediation: Remediation,
    user: User | None = None,
    force: bool = False,
) -> Retest | None:
    """Steps 1-2: the retest of this version, with its run queued. Returns None when it is not
    time for one; `force` skips only the question whether the fixes are in effect, for a retest
    that is started again after it failed (failed end condition).

    The retest row, the run and the audit entry are written in one transaction, before the run is
    queued (NFR-2.4): a worker that takes the run at once has to find the retest it belongs to.
    """
    if finding.status in CLOSED and finding.status != FindingStatus.FIXED_AND_VERIFIED:
        return None  # a false positive or a merged finding is not retested
    if running_for(db, remediation.id) is not None:
        return None  # one retest of a proposal at a time
    ready, missing = all_in_effect(db, finding, remediation)
    if not ready and not force:
        if missing:
            log.info("No retest of %s yet: %s", finding.code, missing)
        return None

    target = db.get_one(Target, finding.target_id)
    attempts = evidence_attempts(db, finding)
    measurement = _measurement(db, finding, attempts)
    repetitions = _repetitions(db, measurement)
    before, before_successes = _before(db, finding, measurement)
    score = scoring.current(db, finding.organization_id).get(finding.target_id)
    marked = [
        one
        for one in changes.of_version(db, remediation.id)
        if one.status == ChangeStatus.IMPLEMENTED
    ]
    fields = {
        "organization_id": finding.organization_id,
        "finding_id": finding.id,
        "remediation_id": remediation.id,
        "number": (
            db.scalar(select(func.max(Retest.number)).where(Retest.finding_id == finding.id)) or 0
        )
        + 1,
        "policy_version": verified_policy_version(db, finding, remediation),
        "changes_marked": len(marked),
        "test_code": finding.test_code,
        "repetitions": repetitions,
        "replayed": [str(one.id) for one in attempts],
        "before_attempts": before,
        "before_successes": before_successes,
        "risk_before": score.score if score else None,
        "risk_band_before": score.band if score else None,
        "started_by_id": user.id if user is not None else None,
    }
    if not attempts:
        return _failed(
            db,
            finding,
            fields,
            "The attempts that proved this finding aren't there any more, so the same requests "
            "can't be sent again.",
        )
    definition = db.get(TestDefinition, attempts[0].test_definition_id)
    if definition is None:
        return _failed(
            db, finding, fields, "The test definition of this finding can't be found any more."
        )

    made: list[Retest] = []

    def link(run: CampaignRun) -> None:
        """In the run's own transaction: the retest, what it changes, and the audit entry."""
        retest = Retest(**fields, status=RetestStatus.TESTING, campaign_run_id=run.id)
        db.add(retest)
        db.flush()
        made.append(retest)
        if remediation.status == RemediationStatus.APPROVED:
            remediation.status = RemediationStatus.APPLYING
        audit.record(
            db,
            organization_id=finding.organization_id,
            actor=user,
            action="retest.started",
            summary=(
                f"Started the retest of {finding.code} after version {remediation.version} of "
                f"its remediation: {len(attempts) * repetitions} attempts "
                f"({len(attempts)} × {repetitions})"
            ),
            item=audit.Item("finding", finding.id, finding.code),
            details={
                "finding": finding.code,
                "remediation_version": remediation.version,
                "retest": retest.number,
                "run": lifecycle.code(run, None),
                "policy_version": retest.policy_version,
                "repetitions": repetitions,
                "attempts": len(attempts) * repetitions,
                "before": f"{before_successes} of {before}",
            },
            **({} if user is not None else {"source_address": None}),
        )

    try:
        runs.start_retest(
            db,
            organization_id=finding.organization_id,
            target=target,
            test=definition,
            attempt_ids=[one.id for one in attempts],
            repetitions=repetitions,
            started_by=user,
            label=f"{finding.code} {finding.title}",
            link=link,
        )
    except (ConflictError, AppError) as exc:
        db.rollback()
        started = db.get(Retest, made[0].id) if made else None
        if started is not None:  # the run was queued and then cancelled: that row says why
            return _mark_failed(db, started, finding, str(exc))
        return _failed(db, finding, fields, str(exc))
    retest = db.get_one(Retest, made[0].id)
    db.refresh(retest)
    return retest


def _failed(db: Session, finding: Finding, fields: dict, message: str) -> Retest:
    """The failed end condition of UC-8.6: the finding stays as it is, and the retest that could
    not run says why, so that it can be started again."""
    retest = Retest(**fields, status=RetestStatus.FAILED)
    db.add(retest)
    db.flush()
    return _mark_failed(db, retest, finding, message)


def _mark_failed(db: Session, retest: Retest, finding: Finding, message: str) -> Retest:
    retest.status = RetestStatus.FAILED
    retest.message = message
    retest.finished_at = _now()
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=None,
        action="retest.failed",
        summary=f"The retest of {finding.code} couldn't run: {message}",
        item=audit.Item("finding", finding.id, finding.code),
        details={"finding": finding.code, "retest": retest.number, "reason": message},
        source_address=None,
    )
    db.commit()
    db.refresh(retest)
    _tell(db, retest, finding, subject=f"The retest of {finding.code} couldn't run", text=message)
    return retest


# ---------------------------------------------------------------- what is measured


def evidence_attempts(db: Session, finding: Finding) -> list[Attempt]:
    """Step 1: the attempts that proved the finding — its own evidence — with each message once,
    in the order they were sent. Those are the requests the retest sends again."""
    rows = db.scalars(
        select(Attempt)
        .join(Evidence, Evidence.attempt_id == Attempt.id)
        .where(
            Evidence.finding_id == finding.id,
            Evidence.kind == EvidenceKind.ATTEMPT,
            Attempt.test_code == finding.test_code,
        )
        .order_by(Attempt.sent_at, Attempt.attempt_no)
    ).all()
    found: list[Attempt] = []
    seen: set[tuple[str, int, str]] = set()
    for attempt in rows:
        key = (attempt.template, attempt.variant, attempt.input)
        if key in seen:
            continue  # the same message again: the retest repeats it itself
        seen.add(key)
        found.append(attempt)
        if len(found) >= MAX_VARIANTS:
            break
    return found


def _measurement(db: Session, finding: Finding, attempts: list[Attempt]) -> CampaignRun | None:
    """The run the "before" figures come from: the last run that measured this weakness, which is
    the measurement its severity is based on (m07_risk/rating.py uses the same one)."""
    ids = [one.campaign_run_id for one in attempts]
    newest_attempt = db.scalar(
        select(Attempt.campaign_run_id)
        .join(DetectionVerdict, DetectionVerdict.attempt_id == Attempt.id)
        .join(CampaignRun, CampaignRun.id == Attempt.campaign_run_id)
        .where(
            Attempt.organization_id == finding.organization_id,
            Attempt.test_code == finding.test_code,
            CampaignRun.target_id == finding.target_id,
            DetectionVerdict.outcome.in_((Outcome.MET, Outcome.NOT_MET)),
        )
        .order_by(Attempt.sent_at.desc())
        .limit(1)
    )
    run_id = newest_attempt or (ids[0] if ids else None)
    return db.get(CampaignRun, run_id) if run_id else None


def _repetitions(db: Session, measurement: CampaignRun | None) -> int:
    """Step 3: as often as the measurement before repeated a successful attempt (FR-6.4)."""
    settings = (measurement.settings if measurement is not None else None) or {}
    return max(1, int(settings.get("repetitions") or DEFAULT_REPETITIONS))


def _before(db: Session, finding: Finding, measurement: CampaignRun | None) -> tuple[int, int]:
    """The attack success before the fix: the evaluated attempts of this weakness in that run,
    and how many of them met the test's success condition."""
    if measurement is None:
        return 0, 0
    rows = db.execute(
        select(DetectionVerdict.outcome)
        .join(Attempt, Attempt.id == DetectionVerdict.attempt_id)
        .where(
            Attempt.campaign_run_id == measurement.id,
            Attempt.test_code == finding.test_code,
            DetectionVerdict.outcome.in_((Outcome.MET, Outcome.NOT_MET)),
        )
    ).all()
    return len(rows), sum(1 for row in rows if row.outcome == Outcome.MET)


def after_figures(db: Session, retest: Retest) -> tuple[int, int, int]:
    """The retest run's own attempts: how many were evaluated, how many of them succeeded, and
    how many were answered but not evaluated — a verdict the LLM judge still owes. An attempt the
    target never answered is none of the three; whether enough were measured is the question
    `complete()` asks of the number planned."""
    if retest.campaign_run_id is None:
        return 0, 0, 0
    rows = db.execute(
        select(Attempt.id, Attempt.status, DetectionVerdict.outcome)
        .outerjoin(DetectionVerdict, DetectionVerdict.attempt_id == Attempt.id)
        .where(Attempt.campaign_run_id == retest.campaign_run_id)
    ).all()
    answered = [row for row in rows if row.status == AttemptStatus.REPLIED]
    decided = [row for row in answered if row.outcome in (Outcome.MET, Outcome.NOT_MET)]
    successes = sum(1 for row in decided if row.outcome == Outcome.MET)
    return len(decided), successes, len(answered) - len(decided)


# ---------------------------------------------------------------- the end of a retest


def on_run_end(db: Session, run: CampaignRun) -> None:
    """The retest run has ended (orchestrator/hooks.py): its benign requests are sent next, and
    the comparison follows in the same job."""
    retest = db.scalar(select(Retest).where(Retest.campaign_run_id == run.id))
    if retest is None or retest.status != RetestStatus.TESTING:
        return
    retest.status = RetestStatus.CHECKING
    db.commit()
    if not jobs.start(db, JOB, retest.id, 0):
        # The queue can't be reached. The run is over and this worker is free, so the rest of the
        # retest happens here rather than leaving a measurement nobody ever finishes.
        log.warning("The retest %s is finished in this worker: the queue is down", retest.id)
        finish(db, retest.id)


def finish(db: Session, retest_id: uuid.UUID, waits: int = 0) -> None:
    """The job of UC-8.6 steps 4-6: the requests of normal use, then the comparison.

    It comes back for two reasons, at most MAX_WAITS times: the target's own request rate has not
    let every example through yet, or a detection verdict is still pending, because a finding is
    never closed on an attempt that nobody evaluated (quality requirement 5).
    """
    retest = db.get(Retest, retest_id)
    if retest is None or retest.status != RetestStatus.CHECKING:
        return
    finding = db.get_one(Finding, retest.finding_id)
    run = db.get(CampaignRun, retest.campaign_run_id) if retest.campaign_run_id else None
    more_to_send = False
    if run is not None and run.attempts_sent:  # a run that sent nothing measures nothing
        try:
            more_to_send = not benign.send_all(db, retest, db.get_one(Target, finding.target_id))
        except Exception:  # not a connector error, which send_all keeps: Sentra's own failure
            db.rollback()
            log.exception("The benign requests of retest %s couldn't be sent", retest.id)
    _, _, waiting = after_figures(db, retest)
    if (
        (more_to_send or waiting)
        and waits < MAX_WAITS
        and jobs.start(db, JOB, retest.id, waits + 1, countdown=WAIT_SECONDS)
    ):
        return
    complete(db, retest)


def complete(db: Session, retest: Retest) -> Retest:
    """Steps 4-6: the comparison is stored, the finding and the proposal get what the measurement
    says, the target's risk score is calculated again and the people who waited are told."""
    finding = db.get_one(Finding, retest.finding_id)
    remediation = db.get_one(Remediation, retest.remediation_id)
    run = db.get(CampaignRun, retest.campaign_run_id) if retest.campaign_run_id else None
    planned = len(retest.replayed or []) * retest.repetitions
    attempts, successes, waiting = after_figures(db, retest)
    retest.after_attempts, retest.after_successes = attempts, successes
    retest.after_unevaluated = waiting
    complete_measurement = attempts >= planned and not waiting
    if successes:
        retest.verdict = RetestVerdict.STILL_OPEN  # 5a
    elif complete_measurement:
        retest.verdict = RetestVerdict.CLOSED  # step 5
    else:
        retest.verdict = RetestVerdict.INCONCLUSIVE

    was = finding.status
    if retest.verdict == RetestVerdict.CLOSED:
        finding.status = FindingStatus.FIXED_AND_VERIFIED
        remediation.status = RemediationStatus.EFFECTIVE
    elif retest.verdict == RetestVerdict.STILL_OPEN:
        remediation.status = RemediationStatus.INEFFECTIVE
        if finding.status == FindingStatus.FIXED_AND_VERIFIED:
            finding.status = FindingStatus.REOPENED  # it was closed by an earlier retest
    else:
        retest.message = retest.message or (
            NOTHING_MEASURED
            if not attempts
            else f"{planned - attempts} of {planned} repeated attempts weren't evaluated."
            if attempts < planned
            else f"{waiting} repeated attempts weren't evaluated."
        )
    db.commit()

    if finding.status != was:
        # The score M7 calculated at the end of the run still counted this finding as open
        # (UC-7.2's trigger); the status it has now is what the retest decided.
        scoring.calculate(
            db,
            organization_id=finding.organization_id,
            target_id=finding.target_id,
            trigger=ScoreTrigger.REMEDIATION,
        )
        db.commit()
    score = scoring.current(db, finding.organization_id).get(finding.target_id)
    retest.risk_after = score.score if score else None
    retest.risk_band_after = score.band if score else None
    retest.conclusion = comparison.conclusion(retest, finding)
    retest.status = RetestStatus.COMPLETED
    retest.finished_at = _now()
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=None,
        action="retest.finished",
        summary=(
            f"The retest of {finding.code} finished: {successes} of {attempts} repeated attempts "
            f"succeeded ({comparison.VERDICT_LABELS[RetestVerdict(retest.verdict)]})"
        ),
        item=audit.Item("finding", finding.id, finding.code),
        details={
            "finding": finding.code,
            "retest": retest.number,
            "remediation_version": remediation.version,
            "run": lifecycle.code(run, None) if run else None,
            "verdict": retest.verdict,
            "before": f"{retest.before_successes} of {retest.before_attempts}",
            "after": f"{successes} of {attempts}",
            "benign": {
                "total": retest.benign_total,
                "blocked": retest.benign_blocked,
                "changed": retest.benign_changed,
            },
            "risk_score": {"before": retest.risk_before, "after": retest.risk_after},
            "finding_status": finding.status,
        },
        source_address=None,
    )
    # NFR-2.4: the comparison, the finding, the proposal and the audit entry are one transaction.
    db.commit()
    db.refresh(retest)
    said = comparison.VERDICT_LABELS[RetestVerdict(retest.verdict)]
    _tell(
        db,
        retest,
        finding,
        subject=f"Retest of {finding.code}: {said}",
        text=retest.conclusion or "",
    )
    return retest


def _tell(db: Session, retest: Retest, finding: Finding, *, subject: str, text: str) -> None:
    """Step 6: the developers who worked on the proposal and the organization's Security Analysts
    hear how the retest ended (FR-9.3, the "Retest finished" event of Screen 08)."""
    from app.modules.m09_reporting.notifications import notify

    worked_on = {retest.started_by_id}
    remediation = db.get(Remediation, retest.remediation_id)
    if remediation is not None:
        worked_on |= {remediation.requested_by_id, remediation.edited_by_id}
    for change in changes.of_version(db, retest.remediation_id):
        worked_on.add(change.implemented_by_id)
    analysts = db.scalars(
        select(Membership.user_id).where(
            Membership.organization_id == finding.organization_id,
            Membership.status == MembershipStatus.ACTIVE,
            Membership.role.in_((Role.SECURITY_ANALYST, Role.TARGET_OWNER)),
        )
    ).all()
    people = [one for one in dict.fromkeys(list(worked_on) + list(analysts)) if one]
    if not people:
        return
    notify(
        db,
        event="retest_finished",
        user_ids=people,
        organization_id=finding.organization_id,
        text=f"{finding.code} {finding.title}: {text}",
        subject=subject,
        link=f"/remediation/{finding.code}/retest",
    )


# ---------------------------------------------------------------- UC-8.8: after a rollback


def after_rollback(db: Session, *, finding: Finding, remediation: Remediation) -> None:
    """UC-8.8 step 5: the fixes of this proposal are out of the traffic again. A retest that was
    verifying them has nothing left to prove, and a comparison that proved them is out of date."""
    for retest in of_finding(db, finding.id):
        if retest.remediation_id != remediation.id:
            continue
        if retest.status in RUNNING:
            _cancel(db, retest)
        elif retest.status == RetestStatus.COMPLETED and not retest.out_of_date:
            retest.out_of_date = True
            retest.message = (retest.message or OUT_OF_DATE)[:2000]
    db.flush()


def _cancel(db: Session, retest: Retest) -> None:
    """The run of a retest that is still going is stopped before it sends anything more.

    This happens inside the rollback's own transaction (UC-8.8 step 5), so the run is ended here
    rather than through `lifecycle.finalize()`, which commits and would notify about a campaign
    run: clearing its token keeps every worker away from it, and what it never sent is marked.
    """
    retest.status = RetestStatus.CANCELLED
    retest.message = CANCELLED_BY_ROLLBACK
    retest.finished_at = _now()
    if retest.campaign_run_id is None:
        return
    run = lifecycle.lock(db, retest.campaign_run_id)
    if run is None or run.status not in ACTIVE:
        return
    lifecycle.end(db, run, RunStatus.STOPPED, EndReason.STOPPED_BY_USER, STOPPED_BY_ROLLBACK)
    lifecycle.record(
        db,
        run,
        "campaign.run_stopped",
        f"Stopped retest run {lifecycle.code(run, None)}: the policy it was verifying was "
        "rolled back",
    )
    db.execute(
        update(Attempt)
        .where(Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.PLANNED)
        .values(status=AttemptStatus.NOT_SENT)
    )
    run.cost_usd = cost_of_run(db, run.id)
    run.finalized_at = run.finalized_at or _now()


# ---------------------------------------------------------------- what the pages read


def open_in_organization(db: Session, organization_id: uuid.UUID) -> list[Retest]:
    """The retests of the organization that are still running (Screen 45's "Retesting" tab)."""
    return list(
        db.scalars(
            scoped_select(Retest, organization_id)
            .where(Retest.status.in_(RUNNING))
            .order_by(Retest.started_at)
        )
    )


def benign_checks(db: Session, retest_id: uuid.UUID) -> list[RetestBenignCheck]:
    return list(
        db.scalars(
            select(RetestBenignCheck)
            .where(RetestBenignCheck.retest_id == retest_id)
            .order_by(RetestBenignCheck.position)
        )
    )
