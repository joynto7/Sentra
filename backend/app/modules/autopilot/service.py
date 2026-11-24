"""The autopilot's work. `start` plans an assessment and `advance` moves it one step: it is called
at once after a start and after every "refresh" of the page, and by Sentra's clock every minute
(schedules.py), so what is done is always a question to the database and a lost tick changes
nothing but the moment of the next step.

Each stage hands over to the next only when the earlier one has really finished, in the order of
the product itself: a verified target with a reviewed profile (M2), an approved threat model (M3),
a campaign (M5), a run that has ended (M5), and proposals for the most severe findings (M8). A stage
that needs a person's decision sets the autopilot to "waiting" and says what for; it never decides
for them.
"""

import json
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError, NotFoundError, PermissionDeniedError
from app.core.tenancy import scoped_select
from app.modules.autopilot.models import (
    ACTIVE,
    AutopilotRun,
    AutopilotStatus,
    Stage,
    WaitingFor,
)
from app.modules.m01_users.models import Membership, MembershipStatus, User
from app.modules.m01_users.permissions import Action, allowed
from app.modules.m02_targets import profile as target_profiles
from app.modules.m02_targets.models import ProfileStatus, Target, TargetStatus
from app.modules.m03_threat_models import generation as threat_models
from app.modules.m03_threat_models.models import (
    JobStatus as ThreatModelJobStatus,
)
from app.modules.m03_threat_models.models import (
    JobTrigger,
    ThreatModel,
    ThreatModelJob,
    ThreatModelStatus,
)
from app.modules.m03_threat_models.recommendations import newest_approved
from app.modules.m04_tests.models import TestSuite
from app.modules.m05_campaigns import runs as campaign_runs
from app.modules.m05_campaigns import service as campaigns
from app.modules.m05_campaigns.models import ENDED, Campaign, CampaignRun, RunStatus
from app.modules.m06_findings.models import OPEN, Finding
from app.modules.m06_findings.service import SEVERITY_RANK
from app.modules.m08_remediation import generation as remediations
from app.modules.m08_remediation.models import JobStatus as RemediationJobStatus
from app.modules.m08_remediation.models import Remediation, RemediationJob

log = logging.getLogger("uvicorn.error")

REPETITIONS = 3  # enough for FR-6.4 to say whether a finding is reproducible, and quick
DEFAULT_RATE = 30  # requests a minute, never above the target's own safe rate (FR-5.7)
MAX_PROPOSALS = 5  # proposals drafted per assessment, most severe first: each one is an LLM call

# The conflicts of M5's launch that a person has to solve (UC-5.2); any other stops the autopilot
SCOPE_WAIT = {"awaiting_approval", "approval_missing"}


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- reading


def _target(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> Target:
    target = db.scalar(scoped_select(Target, organization_id).where(Target.id == target_id))
    if target is None:
        raise NotFoundError("Target not found.")
    return target


def row(db: Session, organization_id: uuid.UUID, run_id: uuid.UUID) -> AutopilotRun:
    found = db.scalar(scoped_select(AutopilotRun, organization_id).where(AutopilotRun.id == run_id))
    if found is None:
        raise NotFoundError("Autopilot run not found.")
    return found


def _suite_codes(db: Session, organization_id: uuid.UUID) -> list[str]:
    """Every active suite the organization can use: the autopilot tests with everything there is,
    and `estimate` leaves out the tests that don't apply to the target's type."""
    suites = db.scalars(
        select(TestSuite)
        .where(
            TestSuite.is_current.is_(True),
            TestSuite.status == "active",
            (TestSuite.organization_id.is_(None)) | (TestSuite.organization_id == organization_id),
        )
        .order_by(TestSuite.code)
    )
    return [suite.code for suite in suites]


def plan_for(db: Session, organization_id: uuid.UUID, target: Target) -> dict:
    """What an assessment of this target would do and cost, shown before anyone starts it."""
    codes = _suite_codes(db, organization_id)
    estimate = campaigns.estimate(db, organization_id, target.id, codes, None)
    rate = max(1, min(DEFAULT_RATE, target.max_request_rate))
    attempts = estimate["estimated_attempts"]
    budget = min(campaigns.MAX_BUDGET, max(1, attempts * REPETITIONS))
    minutes = max(1, round(budget / rate))
    return {
        "suites": codes,
        "tests": estimate["tests"],
        "repetitions": REPETITIONS,
        "attempt_budget": budget,
        "request_rate": rate,
        "estimated_minutes": minutes,
        "llm_cost": estimate["llm_cost"],
        "requires_scope_approval": estimate["requires_scope_approval"],
        "has_approved_threat_model": newest_approved(db, target.id) is not None,
        "has_reviewed_profile": threat_models.blocker(target, target_profiles.find(db, target.id))
        is None,
        "warnings": estimate["warnings"],
    }


def _storable(plan: dict) -> dict:
    """The plan as it is kept: a JSON column can't hold the judge's cost range, a Decimal."""
    return json.loads(json.dumps(plan, default=str))


def _blocker(db: Session, target: Target) -> str | None:
    """Why this target can't be assessed at all, in a sentence."""
    if target.status == TargetStatus.ARCHIVED:
        return "This target is archived, so it can't be tested."
    if target.status != TargetStatus.VERIFIED:
        return "Verify the ownership of this target first: only verified targets are tested."
    return None


def _active_for(db: Session, target_id: uuid.UUID) -> AutopilotRun | None:
    return db.scalar(
        select(AutopilotRun).where(
            AutopilotRun.target_id == target_id, AutopilotRun.status.in_(ACTIVE)
        )
    )


def listing(db: Session, organization_id: uuid.UUID) -> list[AutopilotRun]:
    return list(
        db.scalars(
            scoped_select(AutopilotRun, organization_id)
            .order_by(AutopilotRun.created_at.desc())
            .limit(50)
        )
    )


def _membership(db: Session, run: AutopilotRun) -> Membership | None:
    """The person's own place in the organization, with the permissions they have now."""
    if run.started_by_id is None:
        return None
    return db.scalar(
        select(Membership).where(
            Membership.user_id == run.started_by_id,
            Membership.organization_id == run.organization_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )


# ---------------------------------------------------------------- writing


def _log(run: AutopilotRun, text: str) -> None:
    run.steps = [*run.steps, {"stage": run.stage, "at": _now().isoformat(), "text": text}]


def _go(run: AutopilotRun, stage: str, text: str) -> None:
    """The stage is finished: say so, and move on."""
    _log(run, text)
    run.stage = stage
    run.status = AutopilotStatus.RUNNING
    run.waiting_for = None


def _wait(run: AutopilotRun, waiting_for: str, message: str) -> None:
    """A person has to decide. The first time it is also written in the story."""
    if run.waiting_for != waiting_for:
        _log(run, message)
    run.status = AutopilotStatus.WAITING
    run.waiting_for = waiting_for
    run.message = message


def _busy(run: AutopilotRun, message: str) -> None:
    """Sentra's own job is running; nothing for a person to do."""
    run.status = AutopilotStatus.RUNNING
    run.waiting_for = None
    run.message = message


def _fail(db: Session, run: AutopilotRun, message: str) -> None:
    run.status = AutopilotStatus.FAILED
    run.message = message
    run.waiting_for = None
    run.finished_at = _now()
    _log(run, message)
    _audit(db, run, "autopilot.failed", f"Autopilot {run.code} stopped: {message}")


def _audit(db: Session, run: AutopilotRun, action: str, summary: str) -> None:
    actor = db.get(User, run.started_by_id) if run.started_by_id else None
    target = db.get(Target, run.target_id)
    audit.record(
        db,
        organization_id=run.organization_id,
        actor=actor,
        action=action,
        summary=summary,
        item=audit.Item("autopilot", run.id, f"{run.code}, {target.name if target else ''}"),
        details={"stage": run.stage},
    )


def start(db: Session, membership: Membership, target_id: uuid.UUID) -> AutopilotRun:
    """Plans the assessment and starts it. The route has checked that the role may manage
    campaigns; the remediation step needs a second permission, so it is checked here, before
    anything is sent to a target rather than after the run."""
    if not allowed(membership.role, Action.REQUEST_REMEDIATIONS):
        raise PermissionDeniedError(
            "Your role can't request remediations, so the autopilot can't finish the job for you. "
            "Ask a Security Analyst to start it."
        )
    target = _target(db, membership.organization_id, target_id)
    if problem := _blocker(db, target):
        raise ConflictError(problem, code="target_not_testable")
    if (active := _active_for(db, target.id)) is not None:
        raise ConflictError(
            f"{active.code} is already assessing {target.name}. Wait for it or stop it first.",
            code="autopilot_active",
        )
    number = (
        db.scalar(
            select(func.max(AutopilotRun.number)).where(
                AutopilotRun.organization_id == membership.organization_id
            )
        )
        or 0
    ) + 1
    run = AutopilotRun(
        organization_id=membership.organization_id,
        number=number,
        target_id=target.id,
        started_by_id=membership.user_id,
        status=AutopilotStatus.RUNNING,
        stage=Stage.CHECK,
        message="Starting.",
        plan=_storable(plan_for(db, membership.organization_id, target)),
        state={},
        steps=[],
    )
    _log(run, f"Started by {db.get_one(User, membership.user_id).name}.")
    db.add(run)
    db.flush()
    _audit(db, run, "autopilot.started", f"Started autopilot {run.code} on {target.name}")
    db.commit()
    advance(db, run.id)
    return row(db, membership.organization_id, run.id)


def stop(db: Session, membership: Membership, run_id: uuid.UUID) -> AutopilotRun:
    """Stops the assessment, and the run if one is on: nothing more is sent to the target."""
    run = row(db, membership.organization_id, run_id)
    if run.status not in ACTIVE:
        raise ConflictError("This autopilot run has already ended.", code="autopilot_ended")
    if run.run_id is not None and run.campaign_id is not None:
        campaign = db.get_one(Campaign, run.campaign_id)
        campaign_run = db.get_one(CampaignRun, run.run_id)
        if campaign_run.status not in ENDED:
            campaign_runs.stop(
                db, membership, campaign.code, campaign_run.number, f"Stopped with {run.code}"
            )
    who = db.get_one(User, membership.user_id).name
    run.status = AutopilotStatus.STOPPED
    run.waiting_for = None
    run.message = f"Stopped by {who}."
    run.finished_at = _now()
    _log(run, run.message)
    _audit(db, run, "autopilot.stopped", f"Stopped autopilot {run.code}")
    db.commit()
    return run


def advance(db: Session, run_id: uuid.UUID) -> bool:
    """Does the next step of one assessment, if there is one. True when anything changed."""
    run = db.scalar(select(AutopilotRun).where(AutopilotRun.id == run_id).with_for_update())
    if run is None or run.status not in ACTIVE:
        return False
    before = (run.stage, run.status, run.waiting_for, run.message)
    try:
        person = _membership(db, run)
        if person is None:
            _fail(db, run, "The person who started this can no longer act in the organization.")
        else:
            HANDLERS[run.stage](db, run, person)
    except AppError as exc:
        db.rollback()
        run = db.get_one(AutopilotRun, run_id)
        _fail(db, run, exc.message)
    except Exception:
        log.exception("Autopilot %s failed", run_id)
        db.rollback()
        run = db.get_one(AutopilotRun, run_id)
        _fail(db, run, "Something went wrong inside Sentra. The details are in the server log.")
    db.commit()
    return before != (run.stage, run.status, run.waiting_for, run.message)


def due(db: Session) -> int:
    """Every active assessment, one step each. Used by the clock."""
    ids = list(db.scalars(select(AutopilotRun.id).where(AutopilotRun.status.in_(ACTIVE))))
    return sum(advance(db, run_id) for run_id in ids)


# ---------------------------------------------------------------- the stages


def _check(db: Session, run: AutopilotRun, person: Membership) -> None:
    """A verified target with a profile that a person has reviewed. A target with no profile is
    mapped here (a few harmless discovery requests within its safe rate, which is what "Update
    profile" does); saving the mapped profile as reviewed is the person's step."""
    target = _target(db, run.organization_id, run.target_id)
    if problem := _blocker(db, target):
        _fail(db, run, problem)
        return
    profile = target_profiles.find(db, target.id)
    if threat_models.blocker(target, profile) is None:
        _go(run, Stage.THREAT_MODEL, f"{target.name} is verified and its profile is reviewed.")
        return
    mapping = "Mapping the target's profile: a few harmless requests, within its safe rate."
    status = profile.status if profile is not None else None
    if status == ProfileStatus.MAPPING:
        _busy(run, mapping)
        return
    if status in (ProfileStatus.READY, ProfileStatus.PARTIAL):
        _wait(
            run,
            WaitingFor.REVIEW_PROFILE,
            f"The profile of {target.name} is mapped. Review it and save it, and it goes on.",
        )
        return
    # Nothing mapped yet, or the last mapping failed: start it, once, if the person may
    if not run.state.get("mapping_asked") and allowed(person.role, Action.MAP_TARGET_PROFILES):
        target_profiles.start_mapping(db, target, requested_by=run.started_by_id)
        run = db.get_one(AutopilotRun, run.id)
        run.state = {**run.state, "mapping_asked": True}
        _log(run, "Started mapping the target's profile.")
        _busy(run, mapping)
        return
    reason = profile.stop_reason if profile is not None and profile.stop_reason else None
    _wait(
        run,
        WaitingFor.REVIEW_PROFILE,
        (reason + " " if reason else "")
        + f"Open the profile of {target.name}, fill in what is missing and save it as reviewed.",
    )


def _latest_job(db: Session, target_id: uuid.UUID) -> ThreatModelJob | None:
    return db.scalar(
        select(ThreatModelJob)
        .where(ThreatModelJob.target_id == target_id)
        .order_by(ThreatModelJob.created_at.desc())
        .limit(1)
    )


def _threat_model(db: Session, run: AutopilotRun, person: Membership) -> None:
    """Needs an approved threat model. One is generated when there is none at all; the approval is
    always a person's: the autopilot waits for it (UC-3.3)."""
    target = _target(db, run.organization_id, run.target_id)
    if (approved := newest_approved(db, target.id)) is not None:
        _go(run, Stage.CAMPAIGN, f"Using the approved threat model, version {approved.version}.")
        return
    job = _latest_job(db, target.id)
    if job is not None and job.status in (
        ThreatModelJobStatus.QUEUED,
        ThreatModelJobStatus.RUNNING,
    ):
        _busy(run, "Generating the threat model: Sentra's LLM suggests threats for this target.")
        return
    draft = db.scalar(
        select(ThreatModel)
        .where(ThreatModel.target_id == target.id, ThreatModel.status == ThreatModelStatus.DRAFT)
        .order_by(ThreatModel.version.desc())
        .limit(1)
    )
    if draft is not None:
        _wait(
            run,
            WaitingFor.APPROVE_THREAT_MODEL,
            f"The threat model (draft, version {draft.version}) is ready. Review it and approve "
            "it, then the autopilot goes on.",
        )
        return
    if job is not None and job.status == ThreatModelJobStatus.FAILED and run.state.get("asked"):
        _fail(db, run, job.message or "The threat model could not be generated.")
        return
    threat_models.request(db, target, trigger=JobTrigger.REQUESTED, requested_by=run.started_by_id)
    run.state = {**run.state, "asked": True}
    _log(run, "Asked for a threat model.")
    _busy(run, "Generating the threat model: Sentra's LLM suggests threats for this target.")


def _campaign(db: Session, run: AutopilotRun, person: Membership) -> None:
    target = _target(db, run.organization_id, run.target_id)
    plan = run.plan
    name = f"Autopilot {run.code}: {target.name}"[:120]
    # Creating the campaign commits, which ends the lock on this row: if another step of the same
    # assessment comes in meanwhile, it adopts the campaign that was just made.
    campaign = db.scalar(
        scoped_select(Campaign, run.organization_id).where(Campaign.name == name)
    ) or campaigns.create(
        db,
        person,
        campaigns.CampaignInput(
            name=name,
            target_id=target.id,
            suites=list(plan["suites"]),
            adaptive_agent=False,
            attempt_budget=plan["attempt_budget"],
            request_rate=plan["request_rate"],
            repetitions=plan["repetitions"],
        ),
    )
    run = db.get_one(AutopilotRun, run.id)
    run.campaign_id = campaign.id
    _go(
        run,
        Stage.RUN,
        f"Created campaign {campaign.code}: {plan['tests']} tests, {plan['repetitions']} "
        f"repetitions, at most {plan['attempt_budget']} attempts.",
    )


def _run(db: Session, run: AutopilotRun, person: Membership) -> None:
    campaign = db.get_one(Campaign, run.campaign_id)
    if run.run_id is None:
        existing = db.scalar(
            select(CampaignRun)
            .where(CampaignRun.campaign_id == campaign.id)
            .order_by(CampaignRun.number.desc())
            .limit(1)
        )
        if existing is not None:  # launched a moment ago by another step of this assessment
            run.run_id = existing.id
            _busy(run, f"Run {campaign.code}-{existing.number} is queued.")
            return
        try:
            launched = campaign_runs.launch(db, person, campaign.code)
        except ConflictError as exc:
            if exc.code in SCOPE_WAIT:
                _wait(
                    run,
                    WaitingFor.APPROVE_SCOPE,
                    f"{campaign.code} needs a Security Manager's approval of its scope before it "
                    "can run. The autopilot goes on when it is approved.",
                )
                return
            raise
        run = db.get_one(AutopilotRun, run.id)
        run.run_id = launched.id
        _go(run, Stage.RUN, f"Launched run {campaign.code}-{launched.number}.")
        _busy(run, f"Run {campaign.code}-{launched.number} is queued.")
        return
    campaign_run = db.get_one(CampaignRun, run.run_id)
    name = f"{campaign.code}-{campaign_run.number}"
    if campaign_run.status not in ENDED:
        _busy(run, f"Run {name} is {campaign_run.status}: Sentra is testing the target.")
        return
    if campaign_run.status != RunStatus.COMPLETED:
        run.status = AutopilotStatus.STOPPED
        run.message = f"Run {name} was {campaign_run.status}, so the autopilot stopped."
        run.finished_at = _now()
        _log(run, run.message)
        _audit(db, run, "autopilot.stopped", f"Autopilot {run.code} stopped: its run was stopped")
        return
    if not campaign_run.attempts_planned:
        # A run that planned nothing ended "completed", but there was nothing to judge: it must not
        # pass for an assessment that found no problem.
        _fail(
            db,
            run,
            f"Run {name} could not send a single test, so there is nothing to judge. The run's "
            "summary says why for each test (usually: a test's message template is not filled in).",
        )
        return
    _go(run, Stage.REMEDIATION, f"Run {name} finished.")


def progress(db: Session, run: AutopilotRun) -> dict:
    """What a page can show while it works: how far the run is, what it found so far and how many
    proposals are drafted. Read from the records themselves, never counted in the browser."""
    out: dict = {
        "run_status": None,
        "attempts_planned": 0,
        "attempts_sent": 0,
        "attempt_budget": 0,
        "findings": 0,
        "by_severity": {},
        "proposals": 0,
        "proposals_total": len(run.state.get("findings") or []),
    }
    if run.run_id is None:
        return out
    campaign_run = db.get_one(CampaignRun, run.run_id)
    out.update(
        run_status=campaign_run.status,
        attempts_planned=campaign_run.attempts_planned,
        attempts_sent=campaign_run.attempts_sent,
        attempt_budget=campaign_run.attempt_budget,
    )
    findings = _findings_of(db, run)
    for finding in findings:
        out["by_severity"][finding.severity] = out["by_severity"].get(finding.severity, 0) + 1
    out["findings"] = len(findings)
    asked = set(run.state.get("findings") or [])
    ids = [f.id for f in findings if f.code in asked]
    if ids:
        out["proposals"] = (
            db.scalar(
                select(func.count(func.distinct(Remediation.finding_id))).where(
                    Remediation.finding_id.in_(ids)
                )
            )
            or 0
        )
    return out


def _findings_of(db: Session, run: AutopilotRun) -> list[Finding]:
    """The findings still open that this run saw, most severe first."""
    found = db.scalars(
        scoped_select(Finding, run.organization_id).where(
            Finding.last_run_id == run.run_id, Finding.status.in_(OPEN)
        )
    ).all()
    return sorted(found, key=lambda f: (SEVERITY_RANK.get(f.severity, 99), f.number))


def _remediation(db: Session, run: AutopilotRun, person: Membership) -> None:
    findings = _findings_of(db, run)
    asked = run.state.get("findings")
    if asked is None:
        chosen = findings[:MAX_PROPOSALS]
        for finding in chosen:
            has_proposal = db.scalar(
                select(Remediation.id).where(Remediation.finding_id == finding.id).limit(1)
            ) or db.scalar(
                select(RemediationJob.id)
                .where(
                    RemediationJob.finding_id == finding.id,
                    RemediationJob.status.in_(
                        (RemediationJobStatus.QUEUED, RemediationJobStatus.RUNNING)
                    ),
                )
                .limit(1)
            )
            if has_proposal is None:
                remediations.request(db, finding, requested_by=run.started_by_id)
        run = db.get_one(AutopilotRun, run.id)
        run.state = {**run.state, "findings": [f.code for f in chosen], "total": len(findings)}
        _log(
            run,
            f"Found {len(findings)} open findings; asked for proposals for the "
            f"{len(chosen)} most severe."
            if findings
            else "The run found no open findings.",
        )
        asked = run.state["findings"]
    ids = [f.id for f in findings if f.code in asked]
    running = ids and db.scalar(
        select(RemediationJob.id)
        .where(
            RemediationJob.finding_id.in_(ids),
            RemediationJob.status.in_((RemediationJobStatus.QUEUED, RemediationJobStatus.RUNNING)),
        )
        .limit(1)
    )
    if running:
        _busy(run, "Drafting remediation proposals: Sentra's LLM suggests a fix for each finding.")
        return
    _finish(db, run, findings)


def _finish(db: Session, run: AutopilotRun, findings: list[Finding]) -> None:
    by_severity: dict[str, int] = {}
    for finding in findings:
        by_severity[finding.severity] = by_severity.get(finding.severity, 0) + 1
    ids = [f.id for f in findings]
    proposals = (
        db.scalar(
            select(func.count(func.distinct(Remediation.finding_id))).where(
                Remediation.finding_id.in_(ids)
            )
        )
        if ids
        else 0
    )
    campaign = db.get_one(Campaign, run.campaign_id)
    campaign_run = db.get_one(CampaignRun, run.run_id)
    run.summary = {
        "findings": len(findings),
        "by_severity": by_severity,
        "proposals": proposals or 0,
        "campaign": campaign.code,
        "run_number": campaign_run.number,
        "finding_codes": [f.code for f in findings[:20]],
    }
    run.stage = Stage.DONE
    run.status = AutopilotStatus.COMPLETED
    run.waiting_for = None
    run.finished_at = _now()
    run.message = (
        f"Done: {len(findings)} open findings, {proposals or 0} with a remediation proposal. "
        "Review and approve the proposals: nothing is applied until you do."
    )
    _log(run, run.message)
    _audit(db, run, "autopilot.completed", f"Autopilot {run.code} finished its assessment")


HANDLERS = {
    Stage.CHECK: _check,
    Stage.THREAT_MODEL: _threat_model,
    Stage.CAMPAIGN: _campaign,
    Stage.RUN: _run,
    Stage.REMEDIATION: _remediation,
}
