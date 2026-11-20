"""The evaluation of one attempt (UC-6.1 steps 1-5), as __init__.py describes it."""

import json
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.m02_targets.canaries import BY_KEY as CANARY_SLOTS
from app.modules.m02_targets.models import Target, TargetCanary
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import Detection, DetectionMethod, Origin, RuleCheck, SuccessRule
from app.modules.m05_campaigns.models import Attempt, AttemptStatus, CampaignRun
from app.modules.m06_findings.models import DetectionResult, DetectionVerdict, Outcome
from app.workers.connector.connector import Reply
from app.workers.detection import findings, judge, methods, verdict
from app.workers.detection.observation import Canary, Observation, ToolCall, read_tool_calls
from app.workers.orchestrator import templates as template_file

log = logging.getLogger("uvicorn.error")
BUDGET_MS = 100  # for the deterministic methods of one attempt (NFR-1.4)
NO_TOOL_PATH = (
    "The target's answers don't name its tool calls, so they can't be inspected. Its registration "
    "needs the place of the tool calls in its response format (FR-2.1)."
)
UNREADABLE_TOOLS = (
    "The target's tool calls can't be read: Sentra reads a list of calls, each with the tool's "
    "name and its arguments."
)
CANARY_CHECKS = {RuleCheck.CANARY_IN_REPLY, RuleCheck.CANARY_IN_TOOL_CALL}
CONVERSATION_CHECKS = {RuleCheck.TOOL_CALLED_WITHOUT_CONFIRMATION, RuleCheck.TOOL_CALLS_OVER}


def evaluate(
    db: Session, attempt: Attempt, reply: Reply
) -> tuple[DetectionVerdict, list[DetectionResult]]:
    """Evaluates an attempt that got `reply`, the raw reply of the Target Connector: stores the
    result of each detection method of its test and the combined verdict, and queues the LLM
    judge when the test uses it. An attempt is evaluated only once."""
    done = db.get(DetectionVerdict, attempt.id)
    if done is not None:
        return done, verdict.results_of(db, attempt.id)

    definition = db.get_one(TestDefinition, attempt.test_definition_id)
    detections = [Detection.model_validate(d) for d in definition.detection_methods]
    detections.sort(key=lambda d: verdict.ORDER.get(d.method, len(verdict.ORDER)))
    rules, problem, slot = success_checks(definition, attempt.template)
    seen = observe(db, attempt, reply, rules, slot)

    at = datetime.now(UTC)
    results, spent = [], 0
    for detection in detections:
        own = [rule for rule in rules if rule.method == detection.method]
        if detection.method == DetectionMethod.LLM_JUDGE:
            results.append(judge.first_result(db, attempt, detection.role, own))
            continue
        found = methods.evaluate(detection.method, detection.role, own, seen)
        spent += found.duration_ms or 0
        results.append(
            DetectionResult(
                organization_id=attempt.organization_id,
                attempt_id=attempt.id,
                method=found.method,
                role=found.role,
                outcome=found.outcome,
                summary=problem if problem and not own else found.summary,
                checks=found.checks,
                duration_ms=found.duration_ms,
                evaluated_at=at,
            )
        )
    if spent > BUDGET_MS:
        log.warning("Detection of attempt %s took %s ms (NFR-1.4: 100 ms)", attempt.id, spent)
    db.add_all(results)
    decided = verdict.record(db, attempt, results)
    db.commit()  # the judge's job must find its pending result
    findings.record(db, attempt, decided)  # step 6: a met verdict becomes a finding (UC-6.2)
    if any(r.method == DetectionMethod.LLM_JUDGE and r.outcome == Outcome.PENDING for r in results):
        judge.start(db, attempt)
    return decided, results


def success_checks(
    definition: TestDefinition, template_name: str
) -> tuple[list[SuccessRule], str | None, str | None]:
    """The checks of the attempt's test (UC-6.1 step 1), why some can't be read, and the canary
    slot of its attempt template. A custom test brings its own checks (FR-4.3). A built-in test's
    checks are its own, if any, and those of its attempt template in templates.yaml, which
    Joynto writes; the engine evaluates what the file says and adds nothing."""
    rules = [SuccessRule.model_validate(rule) for rule in definition.success_rules]
    templates = template_file.load()
    entry = templates.entries.get(template_name)
    slot = entry.canary_slot if entry is not None else None
    if definition.origin != Origin.BUILT_IN:
        return rules, None, slot
    problem = templates.problem(template_name)
    if problem:
        unreadable = f"The checks of its attempt template {template_name} can't be read: {problem}"
        return rules, unreadable, None
    return rules + (entry.checks if entry is not None else []), None, slot


def observe(
    db: Session, attempt: Attempt, reply: Reply, rules: list[SuccessRule], slot: str | None
) -> Observation:
    """Everything the checks need, read before they run (NFR-1.4)."""
    kinds = {rule.check for rule in rules}
    run = db.get_one(CampaignRun, attempt.campaign_run_id)
    target = db.get_one(Target, run.target_id)
    canaries, canary_problem = [], None
    if kinds & CANARY_CHECKS:
        canaries, canary_problem = _canaries(db, target, slot)
    tool_calls, tool_problem = _tool_calls(target, reply)
    earlier = _earlier_turns(db, attempt) if kinds & CONVERSATION_CHECKS else []
    return Observation(reply.text, tool_calls, tool_problem, canaries, canary_problem, earlier)


def _canaries(db: Session, target: Target, slot: str | None) -> tuple[list[Canary], str | None]:
    """The planted tokens the canary checks look for: those of the template's slot, or every
    planted token of the target when it names no slot. A token that was replaced, as when a lab
    target is reset, still counts: it was planted in the target as well."""
    query = select(TargetCanary).where(
        TargetCanary.target_id == target.id, TargetCanary.planted_at.is_not(None)
    )
    if slot:
        query = query.where(TargetCanary.slot == slot)
    rows = db.scalars(query.order_by(TargetCanary.created_at.desc())).all()
    if not rows:
        if slot:
            return (
                [],
                f'The canary token "{CANARY_SLOTS[slot].label}" isn\'t planted on the target.',
            )
        return [], "No canary token is planted on the target."
    labels = {key: s.label for key, s in CANARY_SLOTS.items()}
    return [Canary(row.slot, labels.get(row.slot, row.slot), row.token) for row in rows], None


def _tool_calls(target: Target, reply: Reply) -> tuple[list[ToolCall] | None, str | None]:
    """The calls the target named in its reply. An OpenAI-compatible target always names them; a
    target with its own format only when its registration says where (connector._reply)."""
    named = target.request_template is None or bool(
        (target.response_template or {}).get("tool_calls")
    )
    if not named:
        return None, NO_TOOL_PATH
    calls = read_tool_calls(reply.tool_calls)
    return (calls, None) if calls is not None else (None, UNREADABLE_TOOLS)


def _earlier_turns(db: Session, attempt: Attempt) -> list[list[ToolCall] | None]:
    """The tool calls of the earlier turns of the attempt's conversation: the attempts of its run
    in the same conversation with the target that were answered before it."""
    if attempt.sent_at is None:
        return []
    stored = db.scalars(
        select(Attempt.tool_calls)
        .where(
            Attempt.campaign_run_id == attempt.campaign_run_id,
            Attempt.session_id == attempt.session_id,
            Attempt.id != attempt.id,
            Attempt.status == AttemptStatus.REPLIED,
            Attempt.sent_at < attempt.sent_at,
        )
        .order_by(Attempt.sent_at)
    ).all()
    turns: list[list[ToolCall] | None] = []
    for text in stored:  # stored masked; the names of the tools stay readable
        try:
            turns.append(read_tool_calls(json.loads(text)) if text else [])
        except ValueError:
            turns.append(None)
    return turns
