"""Recording findings (FR-6.2, FR-6.3; UC-6.2 Record Finding), the last step of the evaluation of
an attempt (UC-6.1 step 6).

A verdict becomes final in two places: at once in engine.evaluate(), when deterministic evidence
decides, and later in judge._finish(), when the LLM judge answers. Both call record(), so every
met verdict ends here, once:
1. the affected component is where the evidence shows the weakness (affected_component()); the
   test and the component together are the root cause;
2. the target's finding with the same root cause gets the evidence and the run (2a); without one,
   a new finding is created with a title, the category and framework mapping and the initial
   severity of the test definition (FR-4.2), the affected component, the campaign run and the
   observed behaviour. It is new, or requires confirmation when only the LLM judge supports it
   (NFR-9.3);
2b. a finding that had been fixed and verified is reopened as a regression and its owner is told
   (m06_findings/triage.py, FR-6.6); a finding detected again that is open, a false positive or a
   merged duplicate keeps its status (report, Figure 2.6);
3-4. the evidence is masked and stored once with its checksum (m06_findings/evidence.py);
6. the finding is shown on the live campaign monitor, and the users are notified of a new critical
   or high finding (FR-9.3).
Step 5, measuring the reproducibility, comes with FR-6.4.

When the judge answers after the attempt's evidence was stored, its answer is added as evidence of
its own. A finding that can't be recorded leaves the attempt and its detection results as they
are, and the error is logged (UC-6.2, failed end condition).
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.llm.masking import mask
from app.modules.m01_users.models import Membership, MembershipStatus, Role
from app.modules.m02_targets.models import Target, TargetType
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import DetectionMethod, RuleCheck, Severity
from app.modules.m05_campaigns import lifecycle
from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.modules.m06_findings import evidence, triage
from app.modules.m06_findings.models import (
    ComponentKind,
    DetectionResult,
    DetectionVerdict,
    Evidence,
    EvidenceKind,
    Finding,
    FindingEventKind,
    FindingStatus,
    Outcome,
    component_label,
)
from app.modules.m09_reporting.notifications import notify
from app.workers.detection import verdict
from app.workers.orchestrator import live

log = logging.getLogger("uvicorn.error")
TRIES = 3  # of one recording, when another worker records the same root cause at the same moment
MAX_NAME_CHARS = 120
NOTIFIED = (Severity.CRITICAL, Severity.HIGH)  # UC-6.2 step 6
TOOL_CHECKS = (RuleCheck.TOOL_CALLED, RuleCheck.TOOL_CALLED_WITHOUT_CONFIRMATION)
MODEL = (ComponentKind.MODEL, "Model")
SYSTEM_PROMPT = (ComponentKind.SYSTEM_PROMPT, "System prompt")
KNOWLEDGE_SOURCES = (ComponentKind.KNOWLEDGE_SOURCE, "Knowledge sources")
TOOLS = (ComponentKind.TOOL, "Tools")
# Where each canary token is planted (m02_targets.canaries.SLOTS), as a component of the target
SLOT_COMPONENTS = {
    "system_instructions": SYSTEM_PROMPT,
    "forbidden_phrase": SYSTEM_PROMPT,  # the instructions forbid the phrase
    "secret_value": SYSTEM_PROMPT,  # in the configuration the assistant reads
    "test_document": KNOWLEDGE_SOURCES,
    "restricted_document": KNOWLEDGE_SOURCES,
    "personal_data": KNOWLEDGE_SOURCES,  # a document with a synthetic contact
    "other_account": KNOWLEDGE_SOURCES,  # a record of a second test account; see _slot()
}


def record(db: Session, attempt: Attempt, decided: DetectionVerdict) -> Finding | None:
    """UC-6.2 for an attempt whose verdict `decided` is met; it does nothing for any other
    verdict, and nothing twice for the same attempt. The verdict is committed already. Returns
    the finding when the attempt's evidence was added to it now."""
    if decided.outcome != Outcome.MET:
        return None
    attempt_id = attempt.id  # for the log, without the database
    for _ in range(TRIES):
        try:
            return _record(db, attempt, decided)
        except IntegrityError:
            # Another worker recorded the same root cause, took the same number or stored this
            # attempt's evidence at the same moment: the database refused this one, so look again.
            db.rollback()
        except Exception:
            db.rollback()
            log.exception("No finding could be recorded for attempt %s", attempt_id)
            return None
    log.error(
        "No finding could be recorded for attempt %s: it conflicted %s times", attempt_id, TRIES
    )
    return None


def _record(db: Session, attempt: Attempt, decided: DetectionVerdict) -> Finding | None:
    stored = {
        e.kind: e for e in db.scalars(select(Evidence).where(Evidence.attempt_id == attempt.id))
    }
    results = verdict.results_of(db, attempt.id)
    run = db.get_one(CampaignRun, attempt.campaign_run_id)
    definition = db.get_one(TestDefinition, attempt.test_definition_id)
    run_code = lifecycle.code(run, lifecycle.campaign_of(db, run))
    now = datetime.now(UTC)
    if EvidenceKind.ATTEMPT in stored:
        _add_judge_answer(db, attempt, decided, results, stored, run_code, definition, now)
        return None

    target = db.get_one(Target, run.target_id)
    kind, name = affected_component(results, target)
    finding, created, reopened = _finding(
        db, attempt, run, run_code, definition, kind, name, decided
    )
    document = evidence.attempt_document(
        finding, run_code, attempt, definition, decided, results, now
    )
    evidence.store(db, finding, attempt, EvidenceKind.ATTEMPT, document, now)
    seen = attempt.finished_at or now
    if seen >= finding.last_seen_at:
        finding.last_seen_at, finding.last_run_id = seen, run.id
    db.commit()
    _show(run, attempt, finding, created)
    if created:
        _notify(db, run, run_code, target, finding)
    if reopened:  # 2b1: a regression of a finding that had been fixed and verified
        triage.tell_regression(db, finding, run_code, target.name)
    return finding


def affected_component(results: list[DetectionResult], target: Target) -> tuple[str, str]:
    """UC-6.2 step 1: where the evidence shows the weakness, from the checks that the met
    deterministic methods found met, in the order of the methods:
    1. a tool: one that a tool-call check names, or whose call carried a canary token;
    2. else where the canary token that was found is planted;
    3. else the model, e.g. when a rule on the reply or only the LLM judge found it.
    The same test on the same target then always has the same component for the same weakness."""
    met = [
        check
        for result in results
        if result.method in verdict.DETERMINISTIC and result.outcome == Outcome.MET
        for check in result.checks
        if check.get("result") == "met"
    ]
    for check in met:
        tool = check.get("tool") or (
            check.get("value") if check.get("check") in TOOL_CHECKS else ""
        )
        if tool and tool.strip():
            return ComponentKind.TOOL, " ".join(tool.split())[:MAX_NAME_CHARS]
    for check in met:
        if check.get("slot"):
            return _slot(check["slot"], target)
    return MODEL


def _slot(slot: str, target: Target) -> tuple[str, str]:
    """A tool-using agent reaches the records of accounts through its tools."""
    if slot == "other_account" and target.type == TargetType.TOOL_USING_AGENT:
        return TOOLS
    return SLOT_COMPONENTS.get(slot, MODEL)


def _finding(
    db: Session,
    attempt: Attempt,
    run: CampaignRun,
    run_code: str,
    definition: TestDefinition,
    kind: str,
    name: str,
    decided: DetectionVerdict,
) -> tuple[Finding, bool, bool]:
    """UC-6.2 steps 1-2, 2a and 2b: the target's finding with the same root cause, locked so that
    its evidence and its history are numbered without gaps, or a new one. The flags say whether
    the finding is new, and whether it was reopened as a regression now (2b1)."""
    found = db.scalar(
        select(Finding)
        .where(
            Finding.target_id == run.target_id,
            Finding.test_code == attempt.test_code,
            Finding.component_kind == kind,
            Finding.component_name == name,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if found is not None:
        if found.status != FindingStatus.FIXED_AND_VERIFIED:
            return found, False, False
        triage.reopen_as_regression(db, found, run, run_code)  # 2b1
        return found, False, True
    number = (
        db.scalar(
            select(func.max(Finding.number)).where(
                Finding.organization_id == attempt.organization_id
            )
        )
        or 0
    ) + 1
    seen = attempt.finished_at or datetime.now(UTC)
    title = definition.name
    if kind != ComponentKind.MODEL:
        title += f" ({component_label(kind, name)})"
    finding = Finding(
        organization_id=attempt.organization_id,
        number=number,
        target_id=run.target_id,
        test_code=attempt.test_code,
        test_definition_id=definition.id,
        component_kind=kind,
        component_name=name,
        title=title[:200],
        category=definition.category,
        atlas=list(definition.atlas),
        severity=definition.severity,
        status=(
            FindingStatus.REQUIRES_CONFIRMATION
            if decided.requires_confirmation
            else FindingStatus.NEW
        ),
        description=_description(attempt, run_code, definition, decided),
        first_run_id=run.id,
        last_run_id=run.id,
        first_seen_at=seen,
        last_seen_at=seen,
        evidence_count=0,
    )
    db.add(finding)
    db.flush()  # the unique indexes refuse a second finding of this root cause, or this number
    triage.record(
        db,
        finding,
        FindingEventKind.DETECTED,
        text=(
            f"Attempt {attempt.attempt_no} of campaign run {run_code} met the success condition "
            f"of {definition.code}."
        ),
        became=finding.status,
        run=run,
    )
    return finding, True, False


def _sentence(text: str) -> str:
    text = " ".join(text.split())
    return text if text.endswith((".", "!", "?")) else f"{text}."


def _description(
    attempt: Attempt, run_code: str, definition: TestDefinition, decided: DetectionVerdict
) -> str:
    """FR-6.2: the observed behaviour, in words, masked like the evidence."""
    text = (
        f"Attempt {attempt.attempt_no} of campaign run {run_code} met the success condition of "
        f"the test {definition.name} ({definition.code}): "
        f"{_sentence(definition.success_condition)} {decided.summary.removeprefix('Met. ')}"
    )
    return mask(text).text


def _add_judge_answer(
    db: Session,
    attempt: Attempt,
    decided: DetectionVerdict,
    results: list[DetectionResult],
    stored: dict[str, Evidence],
    run_code: str,
    definition: TestDefinition,
    now: datetime,
) -> None:
    """The LLM judge answered after the attempt's evidence was stored, which happens when
    deterministic evidence decided at once (NFR-1.4): its answer is added as evidence too."""
    judged = next((r for r in results if r.method == DetectionMethod.LLM_JUDGE), None)
    first = stored[EvidenceKind.ATTEMPT]
    if (
        EvidenceKind.JUDGE_VERDICT in stored
        or judged is None
        or judged.outcome == Outcome.PENDING
        or judged.evaluated_at is None
        or judged.evaluated_at <= first.recorded_at
    ):
        return
    finding = db.scalar(
        select(Finding)
        .where(Finding.id == first.finding_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    document = evidence.judge_document(finding, run_code, attempt, definition, decided, judged, now)
    evidence.store(db, finding, attempt, EvidenceKind.JUDGE_VERDICT, document, now)
    db.commit()


def _show(run: CampaignRun, attempt: Attempt, finding: Finding, created: bool) -> None:
    """UC-6.2 step 6: the live campaign monitor lists the findings of the run (UC-5.6)."""
    live.publish(
        run.id,
        "finding",
        {
            "code": finding.code,
            "title": finding.title,
            "severity": finding.severity,
            "status": finding.status,
            "category": finding.category,
            "component": component_label(finding.component_kind, finding.component_name),
            "new": created,  # else seen again: the same root cause as before (2a)
            "attempt_no": attempt.attempt_no,
            "test_code": attempt.test_code,
            "evidence_count": finding.evidence_count,
        },
    )


def _notify(db: Session, run: CampaignRun, run_code: str, target: Target, finding: Finding) -> None:
    """UC-6.2 step 6: a new critical or high finding is notified to the organization's Security
    Analysts, who triage it (UC-6.6), its Security Managers, who follow the risk (UC-7.3), and
    whoever launched the run. New findings of one run are combined within an hour (UC-9.3, 1a)."""
    if finding.severity not in NOTIFIED:
        return
    readers = Membership.role.in_((Role.SECURITY_ANALYST, Role.SECURITY_MANAGER))
    if run.launched_by_id is not None:
        readers = or_(readers, Membership.user_id == run.launched_by_id)
    people = db.scalars(
        select(Membership.user_id).where(
            Membership.organization_id == finding.organization_id,
            Membership.status == MembershipStatus.ACTIVE,
            readers,
        )
    ).all()
    if not people:
        return
    level = finding.severity.capitalize()
    notify(
        db,
        event="finding_critical_high",
        user_ids=list(people),
        organization_id=finding.organization_id,
        text=f"New {level} finding {finding.code} on {target.name}: {finding.title}",
        subject=f"New {level} finding {finding.code}",
        link=f"/findings?run_id={run.id}",
        group_key=f"finding_critical_high:{run.id}",
        combined_text=f"{{count}} new Critical or High findings in campaign run {run_code}",
    )
