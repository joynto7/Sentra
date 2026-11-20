"""Benchmark runs (FR-11.3, UC-11.3 and UC-11.4): an experiment that compares testing strategies
on the same lab targets under the same conditions.

A benchmark run is a **plan of campaign runs**, not a new kind of execution: one campaign run of
type `benchmark` per lab target, strategy and repetition, each planned and sent by the run engine
of FR-5.4, with the detection of FR-6.1 and the reproducibility measurement of FR-6.4. What this
module adds is the fairness:

- every strategy gets the same attempt budget and the same number of repetitions, because both
  belong to the run and not to a strategy (UC-11.3, quality requirement 3);
- the order of the repetitions is random and interleaved, and fixed when the run starts, so a
  slower provider in the afternoon spreads evenly over the strategies (UC-11.4, quality req. 1);
- each campaign run starts from a lab target that was just reset (FR-11.2), and two runs on the
  same lab target never overlap, so the engine runs them one after another (quality req. 3);
- the versions of the suites, the tests, the lab targets and the models are fixed at the start, and
  a model that changes afterwards pauses the run, because later repetitions would no longer be
  comparable (UC-11.4, 4b1).

The engine advances on the `on_run_end` hook of the run engine (`m11_lab/hooks.py`), the extension
point M6 and M7 already use, so nothing polls.
"""

import logging
import random
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.llm.config import LLMTask, model_for
from app.llm.usage import cost_of_run, cost_per_judged_attempt
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.models import TestDefinition, TestSuite
from app.modules.m04_tests.schema import DetectionMethod
from app.modules.m04_tests.suites import ATTEMPTS_PER_TEST
from app.modules.m05_campaigns import lifecycle, limits
from app.modules.m05_campaigns.models import CampaignRun, RunStatus, RunTrigger, RunType
from app.modules.m11_lab import deployment
from app.modules.m11_lab.models import (
    BenchmarkRepetition,
    BenchmarkRun,
    BenchmarkStatus,
    LabDeployment,
    LabState,
    RepetitionStatus,
)

log = logging.getLogger("uvicorn.error")

ADVANCE_JOB = "benchmark.advance"
MIN_STRATEGIES = 2
MAX_STRATEGIES = 6
MIN_REPETITIONS, MAX_REPETITIONS = 1, 20
MIN_BUDGET, MAX_BUDGET = 10, 20_000
NO_LAB_TARGET = "Choose at least one lab target."
NOT_A_LAB_TARGET = "Only lab targets can be used in a benchmark run."
NOT_READY = "{name} isn't ready. Deploy or reset it in the Security Lab first."
TOO_FEW_STRATEGIES = (
    f"Define at least {MIN_STRATEGIES} strategies, so there is something to compare."
)
NO_SUITES = "Every strategy needs at least one test suite."
UNKNOWN_SUITE = "No test suite {code} can be used in this organization."
SAME_KEY = "Each strategy needs its own letter."
NO_AGENT = (
    "No model is assigned to the adaptive testing agent, so a strategy can't use it. A Platform "
    "Administrator assigns one on the LLM Providers page."
)
BAD_BUDGET = f"Use an attempt budget between {MIN_BUDGET} and {MAX_BUDGET:,}."
BAD_REPETITIONS = f"Use between {MIN_REPETITIONS} and {MAX_REPETITIONS} repetitions."
ALREADY_STARTED = "This benchmark run has already been started."
RESET_FAILED = "The lab target {name} couldn't be reset, so the benchmark run is paused."
MODELS_CHANGED = (
    "The model of {task} changed while the benchmark run was going, so the repetitions that are "
    "left would not be comparable. The benchmark run is paused."
)
FINISHED = "Every repetition has ended."
STOPPED_BY = "Stopped by {name}. The repetitions that finished are kept."


@dataclass
class Strategy:
    key: str  # "A", "B", …
    name: str
    suites: list[str]
    adaptive_agent: bool = False


@dataclass
class Draft:
    name: str
    target_ids: list[uuid.UUID]
    strategies: list[Strategy]
    attempt_budget: int
    repetitions: int
    judge_every_attempt: bool = False
    baseline_code: str | None = None


@dataclass
class Estimate:
    """UC-11.3 step 5: what the experiment will send and cost, and the limits it would pass."""

    runs: int
    attempts: int
    llm_cost_low_usd: Decimal | None
    llm_cost_high_usd: Decimal | None
    minutes: int
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- the configuration (UC-11.3)


def _lab_targets(
    db: Session, organization_id: uuid.UUID, target_ids: list[uuid.UUID]
) -> list[Target]:
    """Only lab targets, and only ones that are ready (quality requirement 1, FR-11.2)."""
    if not target_ids:
        raise FieldValidationError("target_ids", NO_LAB_TARGET)
    found = []
    for target_id in dict.fromkeys(target_ids):
        row = db.scalar(
            select(LabDeployment).where(
                LabDeployment.organization_id == organization_id,
                LabDeployment.target_id == target_id,
            )
        )
        if row is None:
            raise FieldValidationError("target_ids", NOT_A_LAB_TARGET)
        target = db.get_one(Target, target_id)
        if row.state != LabState.READY:
            raise FieldValidationError("target_ids", NOT_READY.format(name=target.name))
        found.append(target)
    return found


def _strategies(db: Session, organization_id: uuid.UUID, strategies: list[Strategy]) -> list[dict]:
    if not MIN_STRATEGIES <= len(strategies) <= MAX_STRATEGIES:
        raise FieldValidationError("strategies", TOO_FEW_STRATEGIES)
    if len({s.key for s in strategies}) != len(strategies):
        raise FieldValidationError("strategies", SAME_KEY)
    agent = model_for(db, LLMTask.ADAPTIVE_TESTING) is not None
    found = []
    for strategy in strategies:
        if not strategy.suites:
            raise FieldValidationError("strategies", NO_SUITES)
        found_suites = {s.code for s in _suites(db, organization_id, strategy.suites)}
        missing = [code for code in strategy.suites if code not in found_suites]
        if missing:
            raise FieldValidationError("strategies", UNKNOWN_SUITE.format(code=missing[0]))
        if strategy.adaptive_agent and not agent:  # UC-11.3, 2a1
            raise FieldValidationError("strategies", NO_AGENT)
        found.append(
            {
                "key": strategy.key,
                "name": strategy.name,
                "suites": list(dict.fromkeys(strategy.suites)),
                "adaptive_agent": strategy.adaptive_agent,
            }
        )
    return found


def _visible(model, organization_id: uuid.UUID):
    """A built-in suite or test belongs to no organization and every organization may use it."""
    return or_(model.organization_id.is_(None), model.organization_id == organization_id)


def _suites(db: Session, organization_id: uuid.UUID, codes: list[str]) -> list[TestSuite]:
    return list(
        db.scalars(
            select(TestSuite).where(
                TestSuite.code.in_(codes),
                TestSuite.is_current.is_(True),
                TestSuite.status == "active",
                _visible(TestSuite, organization_id),
            )
        ).all()
    )


def _suite_tests(db: Session, organization_id: uuid.UUID, codes: list[str]) -> list[TestDefinition]:
    suites = _suites(db, organization_id, codes)
    wanted = list(dict.fromkeys(code for suite in suites for code in suite.tests))
    return list(
        db.scalars(
            select(TestDefinition).where(
                TestDefinition.code.in_(wanted),
                TestDefinition.is_current.is_(True),
                TestDefinition.retired.is_(False),
                _visible(TestDefinition, organization_id),
            )
        ).all()
    )


def estimate(db: Session, organization_id: uuid.UUID, draft: Draft) -> Estimate:
    """UC-11.3 step 5 and 5a: the attempts, the time and the LLM cost of the whole experiment,
    with the organization's monthly limits named when it would pass one (FR-10.4)."""
    targets = _lab_targets(db, organization_id, draft.target_ids)
    strategies = _strategies(db, organization_id, draft.strategies)
    runs = len(targets) * len(strategies) * draft.repetitions
    attempts, judged = 0, 0
    for strategy in strategies:
        tests = _suite_tests(db, organization_id, strategy["suites"])
        for target in targets:
            fitting = [test for test in tests if target.type in test.target_types]
            planned = min(ATTEMPTS_PER_TEST * len(fitting), draft.attempt_budget)
            attempts += planned * draft.repetitions
            if draft.judge_every_attempt:
                judged += planned * draft.repetitions
            else:
                using = [
                    test
                    for test in fitting
                    if any(
                        m.get("method") == DetectionMethod.LLM_JUDGE for m in test.detection_methods
                    )
                ]
                judged += min(ATTEMPTS_PER_TEST * len(using), planned) * draft.repetitions

    each = cost_per_judged_attempt(db, organization_id)
    low = high = None
    if each is not None and judged:
        total = each * judged
        low = (total * Decimal("0.8")).quantize(Decimal("0.01"))
        high = (total * Decimal("1.2")).quantize(Decimal("1.00").scaleb(-2))
    rate = min(target.max_request_rate for target in targets) if targets else 1
    minutes = max(1, int(attempts / max(rate, 1)) + runs)  # plus about a minute per reset

    warnings = []
    in_force, used = limits.limits_for(db, organization_id), limits.usage(db, organization_id)
    if used.campaign_runs + runs > in_force.campaign_runs:
        left = in_force.campaign_runs - used.campaign_runs
        warnings.append(
            f"This benchmark run needs {runs} campaign runs, and {left} are left of this month's "
            f"limit of {in_force.campaign_runs}."
        )
    if used.attempts + attempts > in_force.attempts:
        warnings.append(
            f"The estimate of {attempts:,} attempts is more than the "
            f"{in_force.attempts - used.attempts:,} left of this month's limit."
        )
    if high is not None and used.llm_cost_usd + high > in_force.llm_cost_usd:
        warnings.append(
            f"The estimated LLM cost of up to ${high:,.2f} is more than the "
            f"${in_force.llm_cost_usd - used.llm_cost_usd:,.2f} left of this month's limit."
        )
    return Estimate(
        runs=runs,
        attempts=attempts,
        llm_cost_low_usd=low,
        llm_cost_high_usd=high,
        minutes=minutes,
        warnings=warnings,
    )


def save(db: Session, membership: Membership, user: User, draft: Draft) -> BenchmarkRun:
    """UC-11.3 steps 1-6: the benchmark run is saved as a draft, with its estimate as it was then.
    Starting it is a second step, so the analyst can read the estimate first."""
    deployment.may_use(db, membership)
    organization_id = membership.organization_id
    if not MIN_BUDGET <= draft.attempt_budget <= MAX_BUDGET:
        raise FieldValidationError("attempt_budget", BAD_BUDGET)
    if not MIN_REPETITIONS <= draft.repetitions <= MAX_REPETITIONS:
        raise FieldValidationError("repetitions", BAD_REPETITIONS)
    targets = _lab_targets(db, organization_id, draft.target_ids)
    strategies = _strategies(db, organization_id, draft.strategies)
    found = estimate(db, organization_id, draft)

    baseline = None
    if draft.baseline_code:  # 1a1: it repeats an earlier run
        baseline = row_of(db, organization_id, draft.baseline_code)

    number = (
        db.scalar(
            select(func.max(BenchmarkRun.number)).where(
                BenchmarkRun.organization_id == organization_id
            )
        )
        or 0
    ) + 1
    run = BenchmarkRun(
        organization_id=organization_id,
        number=number,
        name=draft.name.strip() or f"Benchmark run BR-{number:03d}",
        status=BenchmarkStatus.DRAFT,
        strategies=strategies,
        attempt_budget=draft.attempt_budget,
        repetitions=draft.repetitions,
        judge_every_attempt=draft.judge_every_attempt,
        baseline_id=baseline.id if baseline else None,
        estimate={
            "runs": found.runs,
            "attempts": found.attempts,
            "llm_cost_low_usd": str(found.llm_cost_low_usd) if found.llm_cost_low_usd else None,
            "llm_cost_high_usd": str(found.llm_cost_high_usd) if found.llm_cost_high_usd else None,
            "minutes": found.minutes,
        },
        created_by_id=user.id,
    )
    db.add(run)
    db.flush()
    _plan(db, run, targets)
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="benchmark.saved",
        summary=f"Saved the benchmark run {run.code} {run.name}",
        item=audit.Item("benchmark_run", run.id, run.code),
        details={
            "lab_targets": [target.name for target in targets],
            "strategies": [strategy["key"] for strategy in strategies],
            "repetitions": run.repetitions,
            "attempt_budget": run.attempt_budget,
        },
    )
    db.commit()
    return run


def _plan(db: Session, run: BenchmarkRun, targets: list[Target]) -> None:
    """UC-11.4 step 1: one repetition per lab target, strategy and repetition, in a random
    interleaved order. The seed is kept, so the order can be explained afterwards."""
    seed = random.randrange(1_000_000)
    rows = [
        BenchmarkRepetition(
            benchmark_run_id=run.id,
            target_id=target.id,
            strategy_key=strategy["key"],
            repetition=repetition,
            order_no=0,
        )
        for repetition in range(1, run.repetitions + 1)
        for strategy in run.strategies
        for target in targets
    ]
    random.Random(seed).shuffle(rows)
    for place, row in enumerate(rows, start=1):
        row.order_no = place
        db.add(row)
    run.order_seed = seed


# ---------------------------------------------------------------- the execution (UC-11.4)


def _models(db: Session) -> dict[str, str]:
    """Which model does each AI task right now, for the run's versions (FR-4.5, UC-11.4, 4b)."""
    return {task: (choice.model if (choice := model_for(db, task)) else "") for task in LLMTask}


def _versions(db: Session, run: BenchmarkRun, targets: list[Target]) -> dict:
    """FR-4.5 and UC-11.3, quality requirement 6: the exact suites, tests, lab targets and models
    the experiment uses, fixed now. The suites and tests are recorded in the shape the run engine
    plans from (`m05_campaigns/runs._versions`), per strategy."""
    suites: dict[str, list[dict]] = {}
    tests: dict[str, dict] = {}
    for strategy in run.strategies:
        rows = _suites(db, run.organization_id, strategy["suites"])
        in_order = [s for code in strategy["suites"] for s in rows if s.code == code]
        suites[strategy["key"]] = [
            {"id": str(s.id), "code": s.code, "version": s.version} for s in in_order
        ]
        for definition in _suite_tests(db, run.organization_id, strategy["suites"]):
            tests[definition.code] = {
                "id": str(definition.id),
                "code": definition.code,
                "version": definition.version,
                "suites": [s.code for s in in_order if definition.code in s.tests],
            }
    return {
        "suites": suites,
        "tests": [tests[code] for code in sorted(tests)],
        "lab_targets": [{"id": str(t.id), "name": t.name, "type": t.type} for t in targets],
        "models": _models(db),
    }


def start(db: Session, membership: Membership, user: User, code: str) -> BenchmarkRun:
    """UC-11.3 step 6 into UC-11.4: the versions are fixed, and the first repetition begins. The
    run advances by itself from there, one campaign run at a time."""
    deployment.may_use(db, membership)
    run = row_of(db, membership.organization_id, code)
    if run.status != BenchmarkStatus.DRAFT:
        raise ConflictError(ALREADY_STARTED, code="already_started")
    targets = _lab_targets(db, run.organization_id, _target_ids(db, run))
    run.versions = _versions(db, run, targets)
    run.status = BenchmarkStatus.RUNNING
    run.status_message = "Starting the first repetition."
    run.started_at = datetime.now(UTC)
    audit.record(
        db,
        organization_id=run.organization_id,
        actor=user,
        action="benchmark.started",
        summary=f"Started the benchmark run {run.code}",
        item=audit.Item("benchmark_run", run.id, run.code),
        details={"repetitions": len(run.repetition_rows), "order_seed": run.order_seed},
    )
    db.commit()
    _go(db, run)
    db.refresh(run)
    return run


def _go(db: Session, run: BenchmarkRun) -> None:
    """The work itself happens on a worker: it resets lab targets and launches campaign runs, and
    only a worker reaches a target (deployment 2.5.5)."""
    from app.workers import jobs

    if not jobs.start(db, ADVANCE_JOB, run.id):
        _pause(db, run, "The background workers couldn't be reached, so the run hasn't started.")


def _target_ids(db: Session, run: BenchmarkRun) -> list[uuid.UUID]:
    return list(
        dict.fromkeys(
            db.scalars(
                select(BenchmarkRepetition.target_id)
                .where(BenchmarkRepetition.benchmark_run_id == run.id)
                .order_by(BenchmarkRepetition.order_no)
            )
        )
    )


def advance(db: Session, benchmark_run_id: uuid.UUID) -> None:
    """UC-11.4 steps 3-7: take the next repetition in the order, reset its lab target and launch
    its campaign run. Called when the run starts and again whenever one of its campaign runs has
    ended, so only one runs at a time and each starts from a lab target that was just reset."""
    run = db.get(BenchmarkRun, benchmark_run_id)
    if run is None or run.status != BenchmarkStatus.RUNNING:
        return
    if _in_progress(db, run) is not None:
        return  # one at a time (quality requirement 3)
    changed = _model_changed(db, run)
    if changed:  # 4b1
        _pause(db, run, MODELS_CHANGED.format(task=changed))
        return
    nxt = db.scalar(
        select(BenchmarkRepetition)
        .where(
            BenchmarkRepetition.benchmark_run_id == run.id,
            BenchmarkRepetition.status == RepetitionStatus.PLANNED,
        )
        .order_by(BenchmarkRepetition.order_no)
        .limit(1)
    )
    if nxt is None:
        _finish(db, run)
        return
    _begin(db, run, nxt)


def _in_progress(db: Session, run: BenchmarkRun) -> BenchmarkRepetition | None:
    return db.scalar(
        select(BenchmarkRepetition).where(
            BenchmarkRepetition.benchmark_run_id == run.id,
            BenchmarkRepetition.status.in_([RepetitionStatus.RESETTING, RepetitionStatus.RUNNING]),
        )
    )


def _model_changed(db: Session, run: BenchmarkRun) -> str | None:
    """UC-11.4, 4b: the model of a task is not the one the run started with."""
    from app.llm.config import TASK_LABELS

    recorded = (run.versions or {}).get("models") or {}
    for task in LLMTask:
        choice = model_for(db, task)
        now = choice.model if choice else ""
        if task in recorded and recorded[task] != now:
            return TASK_LABELS[task]
    return None


def _begin(db: Session, run: BenchmarkRun, repetition: BenchmarkRepetition) -> None:
    """Steps 3 and 4: the lab target is reset first, and the campaign run starts once it is ready.
    A reset that fails pauses the benchmark run (3a1)."""
    target = db.get_one(Target, repetition.target_id)
    row = db.scalar(select(LabDeployment).where(LabDeployment.target_id == target.id))
    if row is None:
        _pause(db, run, NOT_A_LAB_TARGET)
        return
    repetition.status = RepetitionStatus.RESETTING
    repetition.started_at = datetime.now(UTC)
    run.status_message = (
        f"Resetting {target.name} for {repetition.strategy_key}, "
        f"repetition {repetition.repetition}."
    )
    db.commit()
    # A lab target that a reset left not ready is reset again here: that is what resuming a paused
    # benchmark run means (UC-11.4, 3a1). Only the reset itself decides whether it can be used.
    deployment.reset_for_benchmark(db, row)
    db.refresh(row)
    if row.state == LabState.NOT_READY:  # 3a1
        repetition.status = RepetitionStatus.PLANNED
        repetition.started_at = None
        db.commit()
        _pause(db, run, RESET_FAILED.format(name=target.name))
        return
    _launch(db, run, repetition, target)


def _launch(
    db: Session, run: BenchmarkRun, repetition: BenchmarkRepetition, target: Target
) -> None:
    """Step 4: an ordinary campaign run of type "benchmark", with this strategy's suites and the
    run's own budget, sent by the run engine of FR-5.4."""
    strategy = next(s for s in run.strategies if s["key"] == repetition.strategy_key)
    suites = (run.versions.get("suites") or {}).get(strategy["key"], [])
    codes = {suite["code"] for suite in suites}
    # Only this strategy's tests: another strategy's suites are a different experiment.
    tests = [test for test in run.versions.get("tests", []) if codes & set(test.get("suites", []))]
    campaign_run = CampaignRun(
        organization_id=run.organization_id,
        campaign_id=None,
        target_id=target.id,
        number=repetition.order_no,
        run_type=RunType.BENCHMARK,
        trigger=RunTrigger.MANUAL,
        status=RunStatus.QUEUED,
        status_message="Waiting for a worker.",
        launched_by_id=run.created_by_id,
        settings={
            "benchmark_run_id": str(run.id),
            "strategy": strategy["key"],
            "repetition": repetition.repetition,
            "adaptive_agent": strategy["adaptive_agent"],
            "judge_every_attempt": run.judge_every_attempt,
            "repetitions": 1,  # a benchmark measures the strategies, not reproducibility
        },
        versions={"suites": suites, "tests": tests, "threat_model": None},
        attempt_budget=run.attempt_budget,
        request_rate=target.max_request_rate,
    )
    db.add(campaign_run)
    db.flush()
    repetition.campaign_run_id = campaign_run.id
    repetition.status = RepetitionStatus.RUNNING
    run.status_message = (
        f"{strategy['key']} on {target.name}, repetition {repetition.repetition} "
        f"({_done(db, run) + 1} of {len(run.repetition_rows)})."
    )
    db.commit()
    lifecycle.publish_status(campaign_run)
    if not lifecycle.dispatch(db, campaign_run):  # the Task Queue can't be reached
        lifecycle.cancel_unqueued(db, campaign_run.id)
        repetition.status = RepetitionStatus.INCOMPLETE
        repetition.reason = "The background workers couldn't be reached."
        db.commit()
        _pause(db, run, "The background workers couldn't be reached, so the run is paused.")


def _done(db: Session, run: BenchmarkRun) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                BenchmarkRepetition.benchmark_run_id == run.id,
                BenchmarkRepetition.status.in_(
                    [RepetitionStatus.COMPLETED, RepetitionStatus.INCOMPLETE]
                ),
            )
        )
        or 0
    )


def on_campaign_run_end(db: Session, campaign_run: CampaignRun) -> None:
    """The `on_run_end` hook: this campaign run belonged to a benchmark, so its repetition is
    finished — completed, or incomplete when it was stopped (4a1) — and the next one begins."""
    repetition = db.scalar(
        select(BenchmarkRepetition).where(BenchmarkRepetition.campaign_run_id == campaign_run.id)
    )
    if repetition is None or repetition.status != RepetitionStatus.RUNNING:
        return
    complete = campaign_run.status == RunStatus.COMPLETED
    repetition.status = RepetitionStatus.COMPLETED if complete else RepetitionStatus.INCOMPLETE
    repetition.reason = None if complete else campaign_run.status_message
    repetition.ended_at = datetime.now(UTC)
    repetition.attempts_sent = campaign_run.attempts_sent
    repetition.cost_usd = cost_of_run(db, campaign_run.id)
    db.commit()
    advance(db, repetition.benchmark_run_id)


# ---------------------------------------------------------------- the controls


def _pause(db: Session, run: BenchmarkRun, why: str) -> None:
    run.status, run.status_message = BenchmarkStatus.PAUSED, why
    audit.record(
        db,
        organization_id=run.organization_id,
        action="benchmark.paused",
        summary=f"Paused the benchmark run {run.code}: {why}",
        item=audit.Item("benchmark_run", run.id, run.code),
        source_address=None,
    )
    db.commit()
    _tell(db, run, f"Benchmark run {run.code} is paused", why)


def _finish(db: Session, run: BenchmarkRun) -> None:
    """Step 7: every repetition has ended, so the analyst is told. The evaluation of UC-11.5 comes
    with FR-11.4, which reads these repetitions."""
    run.status, run.status_message = BenchmarkStatus.COMPLETED, FINISHED
    run.ended_at = datetime.now(UTC)
    audit.record(
        db,
        organization_id=run.organization_id,
        action="benchmark.completed",
        summary=f"The benchmark run {run.code} finished",
        item=audit.Item("benchmark_run", run.id, run.code),
        details={"repetitions": len(run.repetition_rows), "incomplete": _incomplete(db, run)},
        source_address=None,
    )
    db.commit()
    _tell(
        db,
        run,
        f"Benchmark run {run.code} finished",
        f"Every repetition of {run.name} has ended. Its results are ready to read.",
    )


def _incomplete(db: Session, run: BenchmarkRun) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                BenchmarkRepetition.benchmark_run_id == run.id,
                BenchmarkRepetition.status == RepetitionStatus.INCOMPLETE,
            )
        )
        or 0
    )


def _tell(db: Session, run: BenchmarkRun, subject: str, text: str) -> None:
    """Whoever saved the benchmark run hears about it (UC-11.4 step 7)."""
    from app.modules.m09_reporting.notifications import notify

    if run.created_by_id is None:
        return
    notify(
        db,
        event="benchmark_run_finished",
        user_ids=[run.created_by_id],
        organization_id=run.organization_id,
        text=text,
        subject=subject,
        link=f"/lab/benchmarks/{run.code}",
    )


def resume(db: Session, membership: Membership, user: User, code: str) -> BenchmarkRun:
    """UC-11.4, 3a1 and 4b1: the analyst dealt with the cause and the run goes on from where it
    stopped. The repetitions that finished are untouched."""
    deployment.may_use(db, membership)
    run = row_of(db, membership.organization_id, code)
    if run.status != BenchmarkStatus.PAUSED:
        raise ConflictError("This benchmark run isn't paused.", code="not_paused")
    changed = _model_changed(db, run)
    if changed:
        raise ConflictError(MODELS_CHANGED.format(task=changed), code="models_changed")
    run.status, run.status_message = BenchmarkStatus.RUNNING, "Going on where it stopped."
    audit.record(
        db,
        organization_id=run.organization_id,
        actor=user,
        action="benchmark.resumed",
        summary=f"Resumed the benchmark run {run.code}",
        item=audit.Item("benchmark_run", run.id, run.code),
    )
    db.commit()
    _go(db, run)
    db.refresh(run)
    return run


def stop(db: Session, membership: Membership, user: User, code: str) -> BenchmarkRun:
    """The analyst stops the experiment. The campaign run that is going is stopped with it, and
    everything that finished is kept."""
    deployment.may_use(db, membership)
    run = row_of(db, membership.organization_id, code)
    if run.status not in (BenchmarkStatus.RUNNING, BenchmarkStatus.PAUSED):
        raise ConflictError("This benchmark run isn't going.", code="not_running")
    going = _in_progress(db, run)
    if going is not None:
        going.status = RepetitionStatus.INCOMPLETE
        going.reason = f"Stopped with the benchmark run by {user.name}."
        going.ended_at = datetime.now(UTC)
        if going.campaign_run_id is not None:
            campaign_run = db.get(CampaignRun, going.campaign_run_id)
            if campaign_run is not None and campaign_run.status in (
                RunStatus.QUEUED,
                RunStatus.RUNNING,
                RunStatus.PAUSED,
            ):
                lifecycle.stop(db, campaign_run, user)
    run.status = BenchmarkStatus.STOPPED
    run.status_message = STOPPED_BY.format(name=user.name)
    run.ended_at = datetime.now(UTC)
    audit.record(
        db,
        organization_id=run.organization_id,
        actor=user,
        action="benchmark.stopped",
        summary=f"Stopped the benchmark run {run.code}",
        item=audit.Item("benchmark_run", run.id, run.code),
        details={"completed": _done(db, run)},
    )
    db.commit()
    return run


# ---------------------------------------------------------------- reading


def row_of(db: Session, organization_id: uuid.UUID, code: str) -> BenchmarkRun:
    number = code.upper().removeprefix("BR-").lstrip("0") or "0"
    if not number.isdigit():
        raise NotFoundError("There is no benchmark run with that code.")
    run = db.scalar(
        scoped_select(BenchmarkRun, organization_id).where(BenchmarkRun.number == int(number))
    )
    if run is None:
        raise NotFoundError("There is no benchmark run with that code.")
    return run


def listing(db: Session, organization_id: uuid.UUID) -> list[BenchmarkRun]:
    return list(
        db.scalars(
            scoped_select(BenchmarkRun, organization_id).order_by(BenchmarkRun.number.desc())
        )
    )
