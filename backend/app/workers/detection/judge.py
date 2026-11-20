"""The LLM judge (FR-6.1; UC-6.1 step 3 and 3a; NFR-1.4, NFR-3.6, NFR-9.2, NFR-9.5, NFR-9.6).

The judge decides with a model whether a target's reply meets the success condition of the
attempt's test. It runs as its own job on the queue "analysis" (celery_app.py), never inside a
slice of a campaign run, so a slow model doesn't hold up the next attempt (NFR-1.4).

It reaches a model only through the LLM layer: the fixed instructions (judge_instructions.py) are
the system message, and the test's success condition and the attempt's message, reply and tool
calls are data, never instructions (NFR-3.6). The reply and the tool calls are the stored, masked
ones, and the layer masks the data again before it leaves Sentra (NFR-9.6). The answer must match
JudgeAnswer (NFR-9.2). Each verdict records the model and the version and SHA-256 of the
instructions (NFR-9.5); the request counts toward the run's and the organization's LLM cost.

A judge that can't answer now (the provider fails or answers in another form, or the
organization's monthly LLM cost limit is reached) tries again after detection_judge_retry_delays;
after the last try the attempt is marked as not evaluated by the judge (UC-6.1, 3a). Without
instructions or without a model the judge isn't tried at all.
"""

import hashlib
import json
import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.llm import LLMOutputError, LLMTask, LLMUnavailable, complete, model_for
from app.llm.masking import mask
from app.llm.models import LLMUsage
from app.llm.usage import cost_this_month
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import DetectionMethod, DetectionRole, SuccessRule
from app.modules.m05_campaigns import limits
from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.modules.m06_findings.models import DetectionResult, Outcome
from app.workers import jobs
from app.workers.detection import findings, judge_instructions, verdict
from app.workers.jobs import job
from app.workers.orchestrator import live

log = logging.getLogger("uvicorn.error")
JOB = "detection.judge_attempt"
QUEUE = "analysis"
MAX_REPLY_CHARS = 12_000  # of the reply in the judge's data
MAX_REASONING_CHARS = 2_000
MAX_TOKENS = 1_024  # of the judge's answer
WAITING = "Waiting for the LLM judge."
NO_INSTRUCTIONS = "The LLM judge's instructions aren't written yet."
NO_MODEL = "No model is configured for the LLM judge."
QUEUE_DOWN = "Sentra's background workers can't be reached right now."


class JudgeAnswer(BaseModel):
    """The only form in which the judge may answer (NFR-9.2)."""

    model_config = ConfigDict(extra="forbid")

    met: bool
    confidence: float = Field(ge=0, le=1)
    reasoning: str = Field(min_length=1)  # kept up to MAX_REASONING_CHARS


def instructions() -> tuple[str, str, str]:
    """The judge's fixed instructions, their version and their SHA-256 (NFR-9.5)."""
    text = judge_instructions.INSTRUCTIONS.strip()
    return text, str(judge_instructions.VERSION), hashlib.sha256(text.encode()).hexdigest()


def first_result(
    attempt: Attempt, role: DetectionRole, rules: list[SuccessRule]
) -> DetectionResult:
    """The judge's result for a new attempt: pending, or not evaluated with the reason when the
    judge can't be used at all. Its checks are the statements it must confirm, if the test has
    any (judge_confirms)."""
    problem = None
    if not instructions()[0]:
        problem = NO_INSTRUCTIONS
    elif model_for(LLMTask.LLM_JUDGE) is None:
        problem = NO_MODEL
    return DetectionResult(
        organization_id=attempt.organization_id,
        attempt_id=attempt.id,
        method=DetectionMethod.LLM_JUDGE,
        role=role,
        outcome=Outcome.NOT_EVALUATED if problem else Outcome.PENDING,
        summary=problem or WAITING,
        checks=[
            {
                "check": rule.check.value,
                "value": rule.value,
                "sentence": rule.sentence(),
                "result": "unknown",
                "detail": "",
            }
            for rule in rules
        ],
    )


def start(db: Session, attempt: Attempt) -> None:
    """Queues the judge's first try. The caller has committed the judge's pending result."""
    if not jobs.start(db, JOB, attempt.id):
        result = _result(db, attempt.id)
        if result is not None and result.outcome == Outcome.PENDING:
            _finish(db, attempt, result, Outcome.NOT_EVALUATED, _failed(QUEUE_DOWN))


def data_for(attempt: Attempt, definition: TestDefinition, statements: list[str]) -> str:
    """What the judge receives, only as data: the test's success condition and the statements it
    must confirm, the attempt's message, and the target's reply and tool calls as the attempt
    stores them, masked (NFR-8.2). Nothing else about the target or the organization (NFR-9.6)."""
    reply = attempt.reply or ""
    tool_calls = None
    if attempt.tool_calls:
        try:
            tool_calls = json.loads(attempt.tool_calls)
        except ValueError:
            tool_calls = attempt.tool_calls
    data = {
        "test": {
            "name": definition.name,
            "objective": definition.objective,
            "success_condition": definition.success_condition,
            "statements": statements,
        },
        "attempt": {"message": attempt.input},
        "reply": {
            "text": reply[:MAX_REPLY_CHARS],
            "truncated": max(len(reply), attempt.reply_length or 0) > MAX_REPLY_CHARS,
            "length": attempt.reply_length,
        },
        "tool_calls": tool_calls,
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


@job(JOB)
def judge_attempt(db: Session, attempt_id: str) -> None:
    run(db, uuid.UUID(attempt_id))


def run(db: Session, attempt_id: uuid.UUID) -> None:
    """One try of the judge for one attempt (the job detection.judge_attempt)."""
    result = _result(db, attempt_id)
    if result is None or result.outcome != Outcome.PENDING:
        db.rollback()  # judged already, e.g. by a job that was delivered twice
        return
    tries = result.tries + 1
    claimed = db.execute(
        update(DetectionResult)
        .where(
            DetectionResult.id == result.id,
            DetectionResult.outcome == Outcome.PENDING,
            DetectionResult.tries == result.tries,
        )
        .values(tries=tries)
    ).rowcount
    db.commit()
    if not claimed:
        return  # another worker took this try
    db.refresh(result)
    attempt = db.get_one(Attempt, attempt_id)
    text, version, sha256 = instructions()
    if not text:
        _finish(db, attempt, result, Outcome.NOT_EVALUATED, NO_INSTRUCTIONS)
        return
    reached = _cost_limit_reached(db, attempt.organization_id)
    if reached:
        _later(db, attempt, result, tries, reached)
        return
    definition = db.get_one(TestDefinition, attempt.test_definition_id)
    statements = [check["value"] for check in result.checks]
    try:
        completion = complete(
            db,
            LLMTask.LLM_JUDGE,
            instructions=text,
            data=data_for(attempt, definition, statements),
            organization_id=attempt.organization_id,
            schema=JudgeAnswer,
            max_tokens=MAX_TOKENS,
            campaign_run_id=attempt.campaign_run_id,
        )
    except (LLMUnavailable, LLMOutputError) as exc:
        _later(db, attempt, result, tries, str(exc))
        return
    answer: JudgeAnswer = completion.parsed
    result.confidence = Decimal(str(round(answer.confidence, 3)))
    result.reasoning = mask(answer.reasoning).text[:MAX_REASONING_CHARS]
    result.judge_model, result.judge_deployment = completion.model, completion.deployment
    result.instructions_version, result.instructions_sha256 = version, sha256
    result.error = None
    outcome = Outcome.MET if answer.met else Outcome.NOT_MET
    said = "meets" if answer.met else "doesn't meet"
    summary = f"The reply {said} the success condition (confidence {result.confidence:.2f})."
    _finish(db, attempt, result, outcome, summary)


def _result(db: Session, attempt_id: uuid.UUID) -> DetectionResult | None:
    return db.scalar(
        select(DetectionResult)
        .where(
            DetectionResult.attempt_id == attempt_id,
            DetectionResult.method == DetectionMethod.LLM_JUDGE,
        )
        .execution_options(populate_existing=True)
    )


def _cost_limit_reached(db: Session, organization_id: uuid.UUID) -> str | None:
    limit = limits.limits_for(db, organization_id).llm_cost_usd
    if cost_this_month(db, organization_id) >= limit:
        return f"The organization's monthly LLM cost limit of ${limit:,.2f} is reached."
    return None


def _failed(problem: str) -> str:
    return f"The LLM judge couldn't evaluate this attempt. {problem}"


def _later(
    db: Session, attempt: Attempt, result: DetectionResult, tries: int, problem: str
) -> None:
    """UC-6.1, 3a: the judge tries again later; after the last try the attempt is marked as not
    evaluated by the judge."""
    delays = get_settings().detection_judge_retry_delays
    result.error = problem[:1000]
    if tries <= len(delays):
        delay = delays[tries - 1]
        result.summary = f"{WAITING} It tries again in {delay} seconds. {problem}"
        db.commit()
        if jobs.start(db, JOB, attempt.id, countdown=delay):
            return
        problem = QUEUE_DOWN
    _finish(db, attempt, result, Outcome.NOT_EVALUATED, _failed(problem))


def _finish(
    db: Session, attempt: Attempt, result: DetectionResult, outcome: Outcome, summary: str
) -> None:
    """Stores the judge's result and the attempt's new verdict, shows it on the live campaign
    monitor (an event "detection") and records a finding when the verdict is met (UC-6.1 step 6),
    or adds the judge's answer to the evidence of the finding the attempt already supports."""
    result.outcome, result.summary = outcome, summary
    result.evaluated_at = datetime.now(UTC)
    state = {Outcome.MET: "met", Outcome.NOT_MET: "not_met"}.get(outcome, "unknown")
    result.checks = [{**check, "result": state} for check in result.checks]
    results = verdict.results_of(db, attempt.id)
    decided = verdict.record(db, attempt, results)
    # A judge that answers after its run ended adds its cost to the run's (UC-5.6 step 5). The
    # sum is taken in the statement itself, so two judges finishing together both count.
    db.execute(
        update(CampaignRun)
        .where(CampaignRun.id == attempt.campaign_run_id, CampaignRun.finalized_at.is_not(None))
        .values(
            cost_usd=select(func.coalesce(func.sum(LLMUsage.cost_usd), 0))
            .where(LLMUsage.campaign_run_id == attempt.campaign_run_id)
            .scalar_subquery()
        )
    )
    db.commit()
    live.publish(
        attempt.campaign_run_id,
        "detection",
        {
            "attempt_no": attempt.attempt_no,
            "test_code": attempt.test_code,
            **verdict.live_data(decided, results),
        },
    )
    findings.record(db, attempt, decided)
