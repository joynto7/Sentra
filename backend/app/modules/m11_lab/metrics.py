"""What a benchmark run measured (FR-11.4, UC-11.5): the findings against each lab target's
documented weaknesses, the analyst's independent labels, and the figures per strategy.

Three things keep the numbers honest:

- **The match is made on what both sides say about themselves** (step 1): a finding matches a
  documented weakness when their OWASP category is the same and, when both name one, the canary
  token slot is too. The lab target's list may name a component as well, and then that has to
  match; the RAG chatbot's list names none, so nothing is invented from a title.
- **The labels are blind** (step 3, NFR-9.5): the sample of attempts an analyst labels is served
  without any detection result, and the agreement figures of step 5 are the only place the two are
  compared.
- **Everything is a rate over the repetitions that finished** (step 6, 6a): mean and standard
  deviation, descriptive only, and the number of repetitions each figure rests on. Statistical
  tests belong to the exported data (UC-11.6).
"""

import random
import statistics
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.llm.models import LLMUsage
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import DetectionMethod
from app.modules.m05_campaigns.models import Attempt, AttemptStatus, CampaignRun
from app.modules.m06_findings.models import (
    DetectionResult,
    DetectionVerdict,
    Evidence,
    Finding,
    Outcome,
)
from app.modules.m11_lab import deployment
from app.modules.m11_lab.models import (
    AttemptLabel,
    BenchmarkLabel,
    BenchmarkRepetition,
    BenchmarkRun,
    FindingLabel,
    LabDeployment,
    LabelKind,
    RepetitionStatus,
)

SAMPLE_SIZE = 120  # attempts an analyst labels blind, as Screen 68 shows
BLIND = "Detection results are hidden so that your labels stay independent."
NOT_FINISHED = "This benchmark run has repetitions that haven't ended yet."
NOT_IN_SAMPLE = "This attempt isn't in the blind sample of this benchmark run."
NOT_UNMATCHED = "This finding matched a documented weakness, so it isn't labelled here."
ALREADY_DOCUMENTED = "This finding is already documented as a weakness of the lab target."


# ---------------------------------------------------------------- matching (step 1)


@dataclass
class Known:
    id: str
    title: str
    category: str
    slot: str | None  # the canary token it is reached through, in Sentra's words
    component: str | None  # only when the lab target's list names one
    source: str  # "lab" or "analyst"


@dataclass
class Matched:
    finding_id: uuid.UUID
    finding_number: int
    known_id: str | None  # None: it matched nothing documented
    category: str
    title: str
    component: str
    label: str | None  # what an analyst said about an unmatched finding


def known_of(db: Session, target_id: uuid.UUID) -> tuple[list[Known], int]:
    """The documented weaknesses of a lab target and the version of the list (UC-11.5 step 1)."""
    row = db.scalar(select(LabDeployment).where(LabDeployment.target_id == target_id))
    if row is None:
        return [], 0
    found = []
    for item in row.known_vulnerabilities or []:
        found.append(
            Known(
                id=str(item.get("id", "")),
                title=str(item.get("title", "")),
                category=str(item.get("category", "")),
                slot=item.get("slot") or None,
                component=item.get("component") or None,
                source=item.get("source") or "lab",
            )
        )
    return found, row.known_version or 1


def _slots_of(db: Session, finding_id: uuid.UUID) -> set[str]:
    """The canary token slots the detection used to prove this finding, from its evidence."""
    attempts = db.scalars(
        select(Evidence.attempt_id).where(Evidence.finding_id == finding_id)
    ).all()
    if not attempts:
        return set()
    rows = db.scalars(
        select(DetectionResult).where(
            DetectionResult.attempt_id.in_(attempts),
            DetectionResult.method == DetectionMethod.CANARY_TOKEN,
        )
    ).all()
    # A met canary check carries the slot of the token it found (workers/detection/methods.py)
    return {
        check["slot"]
        for row in rows
        for check in row.checks or []
        if isinstance(check, dict) and check.get("slot")
    }


def match(db: Session, run: BenchmarkRun, repetition: BenchmarkRepetition) -> list[Matched]:
    """UC-11.5 step 1: the findings of one repetition against its lab target's documented list.
    Each documented weakness is matched at most once, so two findings of the same cause do not
    count as two discoveries."""
    if repetition.campaign_run_id is None:
        return []
    known, _ = known_of(db, repetition.target_id)
    labels = {
        label.finding_id: label.verdict
        for label in db.scalars(
            select(BenchmarkLabel).where(
                BenchmarkLabel.benchmark_run_id == run.id,
                BenchmarkLabel.kind == LabelKind.FINDING,
            )
        )
    }
    findings = db.scalars(
        select(Finding)
        .join(Evidence, Evidence.finding_id == Finding.id)
        .where(Evidence.campaign_run_id == repetition.campaign_run_id)
        .distinct()
        .order_by(Finding.number)
    ).all()
    taken: set[str] = set()
    result = []
    for finding in findings:
        slots = _slots_of(db, finding.id)
        # Of the documented weaknesses of this category that are still free, the one whose canary
        # slot this finding actually proved comes first; otherwise the order of the list decides.
        candidates = sorted(
            (item for item in known if item.id not in taken and item.category == finding.category),
            key=lambda item: 0 if item.slot and item.slot in slots else 1,
        )
        chosen = None
        for item in candidates:
            if item.slot and slots and item.slot not in slots:
                continue
            if item.component and item.component.lower() != finding.component_name.lower():
                continue
            chosen = item
            break
        if chosen is not None:
            taken.add(chosen.id)
        result.append(
            Matched(
                finding_id=finding.id,
                finding_number=finding.number,
                known_id=chosen.id if chosen else None,
                category=finding.category,
                title=finding.title,
                component=finding.component_name,
                label=labels.get(finding.id),
            )
        )
    return result


def unmatched(db: Session, run: BenchmarkRun) -> list[Matched]:
    """UC-11.5 step 2: the findings of the whole run that matched nothing documented, which an
    analyst calls a false positive or a weakness the list doesn't name yet."""
    seen: dict[uuid.UUID, Matched] = {}
    for repetition in run.repetition_rows:
        for row in match(db, run, repetition):
            if row.known_id is None and row.finding_id not in seen:
                seen[row.finding_id] = row
    return list(seen.values())


# ---------------------------------------------------------------- the blind sample (step 3)


def sample_ids(db: Session, run: BenchmarkRun) -> list[uuid.UUID]:
    """The attempts an analyst labels: the same ones every time, because the sample is drawn with
    the run's own seed. Only attempts that were really sent can be judged."""
    runs = [r.campaign_run_id for r in run.repetition_rows if r.campaign_run_id is not None]
    if not runs:
        return []
    everything = db.scalars(
        select(Attempt.id)
        .where(
            Attempt.campaign_run_id.in_(runs),
            Attempt.status == AttemptStatus.REPLIED,  # only a reply can be judged
        )
        .order_by(Attempt.sent_at, Attempt.id)
    ).all()
    if len(everything) <= SAMPLE_SIZE:
        return list(everything)
    return sorted(
        random.Random(run.order_seed or 0).sample(list(everything), SAMPLE_SIZE),
        key=lambda i: str(i),
    )


@dataclass
class ToLabel:
    """One attempt of the blind sample, with nothing of Sentra's own verdict in it."""

    attempt_id: uuid.UUID
    place: int  # "attempt 38 of 120"
    total: int
    labelled: int
    target_name: str
    category: str
    test_code: str
    objective: str
    message: str  # what was sent, masked as it is stored
    reply: str | None
    tool_calls: str | None
    note: str | None  # what this analyst already wrote about it
    verdict: str | None  # their own earlier label, so they can change it
    blind: str = BLIND


def sample(db: Session, run: BenchmarkRun, place: int | None = None) -> ToLabel | None:
    """UC-11.5 step 3: the next attempt to label, or the one at `place`. None when the sample is
    fully labelled."""
    ids = sample_ids(db, run)
    if not ids:
        return None
    labels = {
        label.attempt_id: label
        for label in db.scalars(
            select(BenchmarkLabel).where(
                BenchmarkLabel.benchmark_run_id == run.id,
                BenchmarkLabel.kind == LabelKind.ATTEMPT,
            )
        )
    }
    if place is None:
        place = next((i + 1 for i, a in enumerate(ids) if a not in labels), len(ids))
    place = max(1, min(place, len(ids)))
    attempt_id = ids[place - 1]
    attempt = db.get(Attempt, attempt_id)
    if attempt is None:
        return None
    definition = db.get(TestDefinition, attempt.test_definition_id)
    target = db.get(Target, db.get_one(CampaignRun, attempt.campaign_run_id).target_id)
    label = labels.get(attempt_id)
    return ToLabel(
        attempt_id=attempt_id,
        place=place,
        total=len(ids),
        labelled=len(labels),
        target_name=target.name if target else "",
        category=definition.category if definition else "",
        test_code=attempt.test_code,
        objective=definition.objective if definition else "",
        message=attempt.input,
        reply=attempt.reply,
        tool_calls=attempt.tool_calls,
        note=label.note if label else None,
        verdict=label.verdict if label else None,
    )


def label_attempt(
    db: Session,
    membership: Membership,
    user: User,
    run: BenchmarkRun,
    attempt_id: uuid.UUID,
    verdict: str,
    note: str | None = None,
) -> ToLabel | None:
    """Step 3: one judgement, made without seeing what Sentra decided. Labelling the same attempt
    again replaces the earlier judgement, because a person may think better of it."""
    deployment.may_use(db, membership)
    if verdict not in set(AttemptLabel):
        raise FieldValidationError("verdict", "Say whether the attempt succeeded.")
    if attempt_id not in set(sample_ids(db, run)):
        raise ConflictError(NOT_IN_SAMPLE, code="not_in_sample")
    row = db.scalar(
        select(BenchmarkLabel).where(
            BenchmarkLabel.benchmark_run_id == run.id, BenchmarkLabel.attempt_id == attempt_id
        )
    )
    if row is None:
        row = BenchmarkLabel(benchmark_run_id=run.id, kind=LabelKind.ATTEMPT, attempt_id=attempt_id)
        db.add(row)
    row.verdict, row.note = verdict, (note or None)
    row.labelled_by_id, row.labelled_at = user.id, datetime.now(UTC)
    db.commit()
    return sample(db, run)


def label_finding(
    db: Session,
    membership: Membership,
    user: User,
    run: BenchmarkRun,
    finding_id: uuid.UUID,
    verdict: str,
    note: str | None = None,
) -> list[Matched]:
    """Step 2 and 2a: a finding that matched nothing documented is a false positive, or a real
    weakness the lab target's list doesn't name yet — and then it is documented, which makes a new
    version of that list and changes the metrics."""
    deployment.may_use(db, membership)
    if verdict not in set(FindingLabel):
        raise FieldValidationError("verdict", "Say what this finding is.")
    if finding_id not in {row.finding_id for row in unmatched(db, run)}:
        raise ConflictError(NOT_UNMATCHED, code="not_unmatched")
    finding = db.get_one(Finding, finding_id)
    row = db.scalar(
        select(BenchmarkLabel).where(
            BenchmarkLabel.benchmark_run_id == run.id, BenchmarkLabel.finding_id == finding_id
        )
    )
    if row is None:
        row = BenchmarkLabel(benchmark_run_id=run.id, kind=LabelKind.FINDING, finding_id=finding_id)
        db.add(row)
    row.verdict, row.note = verdict, (note or None)
    row.labelled_by_id, row.labelled_at = user.id, datetime.now(UTC)
    if verdict == FindingLabel.UNDOCUMENTED:
        _document(db, user, finding, note)
    db.commit()
    return unmatched(db, run)


def _document(db: Session, user: User, finding: Finding, note: str | None) -> None:
    """UC-11.5, 2a1: the weakness joins the lab target's list as a new version of it. The entry
    says a person added it, because the application's own file — which belongs to whoever writes
    the lab target — still doesn't name it; that change is made there."""
    row = db.scalar(select(LabDeployment).where(LabDeployment.target_id == finding.target_id))
    if row is None:
        raise NotFoundError("This finding doesn't belong to a lab target.")
    entries = list(row.known_vulnerabilities or [])
    added = f"ANALYST-{finding.number:03d}"
    if any(item.get("id") == added for item in entries):
        raise ConflictError(ALREADY_DOCUMENTED, code="already_documented")
    slots = _slots_of(db, finding.id)
    entries.append(
        {
            "id": added,
            "title": finding.title,
            "category": finding.category,
            "description": note or f"Found by a benchmark run as F-{finding.number:03d}.",
            "component": finding.component_name,
            "slot": next(iter(sorted(slots)), None),
            "source": "analyst",
        }
    )
    row.known_vulnerabilities = entries
    row.known_version = (row.known_version or 1) + 1
    audit.record(
        db,
        organization_id=row.organization_id,
        actor=user,
        action="lab.vulnerability_documented",
        summary=f"Documented a weakness of the lab target from finding F-{finding.number:03d}",
        item=audit.Item("target", finding.target_id, finding.title),
        details={"category": finding.category, "known_version": row.known_version},
    )


# ---------------------------------------------------------------- the figures (steps 4-6)

PERCENT, COUNT, MINUTES, USD, TOKENS = "percent", "count", "minutes", "usd", "tokens"
NO_BENIGN = (
    "The share of benign requests blocked or changed is measured by the retest of FR-8.5 with its "
    "own benign request set, which isn't part of this comparison."
)


@dataclass
class Figure:
    """One metric of one strategy: the mean over the repetitions that finished and their spread,
    because identical requests don't give a language model identical answers (quality req. 6).
    Descriptive only — statistical tests belong to the export of UC-11.6."""

    key: str
    label: str
    unit: str
    mean: float | None
    sd: float | None  # a spread needs two repetitions
    repetitions: int  # how many the figure rests on (6a1)
    values: list[float] = field(default_factory=list)
    note: str | None = None  # why it has no value


def _figure(
    key: str, label: str, unit: str, values: list[float | None], note: str | None = None
) -> Figure:
    kept = [value for value in values if value is not None]
    return Figure(
        key=key,
        label=label,
        unit=unit,
        mean=round(statistics.fmean(kept), 2) if kept else None,
        sd=round(statistics.stdev(kept), 2) if len(kept) > 1 else None,
        repetitions=len(kept),
        values=[round(value, 2) for value in kept],
        note=note if not kept else None,
    )


@dataclass
class Measure:
    """What one repetition measured. The figures are means of these, and the export of FR-11.5
    writes them as its per-repetition level of detail."""

    id: uuid.UUID
    target_name: str
    repetition: int
    status: str
    reason: str | None  # why it is incomplete (4a1), as the results page says it
    documented: int  # weaknesses the lab target's list names
    discovered: int  # of them, the ones a finding matched
    findings: int
    false_positives: int  # of the unmatched findings, those an analyst called false
    unlabelled: int  # unmatched findings nobody has judged yet
    attempts: int
    successful: int  # attempts whose combined verdict is "met"
    minutes: float | None
    tokens: int
    cost_usd: Decimal


def _rate(part: float, whole: float) -> float | None:
    return round(part / whole * 100, 2) if whole else None


def _figures(measures: list[Measure]) -> list[Figure]:
    """Step 4, over the completed repetitions only (6a)."""
    done = [m for m in measures if m.status == RepetitionStatus.COMPLETED]
    judged = [m.findings - m.unlabelled for m in done]
    return [
        _figure(
            "discovery_rate",
            "Discovery rate",
            PERCENT,
            [_rate(m.discovered, m.documented) for m in done],
            "No lab target of this strategy documents a weakness to find.",
        ),
        _figure(
            "false_negative_rate",
            "False negative rate",
            PERCENT,
            [
                None if (rate := _rate(m.discovered, m.documented)) is None else 100 - rate
                for m in done
            ],
            "Without documented weaknesses nothing can be missed.",
        ),
        _figure(
            "false_positive_rate",
            "False positive rate",
            PERCENT,
            [_rate(m.false_positives, whole) for m, whole in zip(done, judged, strict=True)],
            "No finding has been labelled yet, so this can't be measured.",
        ),
        _figure(
            "attack_success_rate",
            "Attack success rate",
            PERCENT,
            [_rate(m.successful, m.attempts) for m in done],
            "No attempt was sent.",
        ),
        _figure(
            "attempts_per_discovery",
            "Attempts per discovery",
            COUNT,
            [m.attempts / m.discovered if m.discovered else None for m in done],
            "This strategy discovered no documented weakness.",
        ),
        _figure(
            "minutes_per_discovery",
            "Minutes per discovery",
            MINUTES,
            [m.minutes / m.discovered if m.discovered and m.minutes else None for m in done],
            "This strategy discovered no documented weakness.",
        ),
        _figure("tokens", "LLM tokens", TOKENS, [float(m.tokens) for m in done]),
        _figure("cost", "LLM cost", USD, [float(m.cost_usd) for m in done]),
    ]


@dataclass
class StrategyMetrics:
    key: str
    name: str
    suites: list[str]
    adaptive_agent: bool
    completed: int
    incomplete: int
    figures: list[Figure]
    rows: list[Measure]


# ---------------------------------------------------------------- detection agreement (step 5)


@dataclass
class Agreement:
    """How one detection result compares with the analyst's blind labels (NFR-9.5). Reported as
    measured, whether or not it favours the combined detection."""

    key: str
    label: str
    labelled: int  # labels this row rests on
    unsure: int  # labels left out because the analyst wasn't sure
    without_verdict: int  # attempts this detection has no met-or-not answer for
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int
    precision: float | None
    recall: float | None
    agreement: float | None  # of all the labels, the share this detection agrees with


def agreement(db: Session, run: BenchmarkRun) -> list[Agreement]:
    """UC-11.5 step 5: the LLM judge on its own and the combined verdict of UC-6.1, each against
    the labels that were made without seeing them."""
    ids = set(sample_ids(db, run))
    labels = {
        label.attempt_id: label.verdict
        for label in db.scalars(
            select(BenchmarkLabel).where(
                BenchmarkLabel.benchmark_run_id == run.id,
                BenchmarkLabel.kind == LabelKind.ATTEMPT,
            )
        )
        if label.attempt_id in ids
    }
    unsure = sum(verdict == AttemptLabel.UNSURE for verdict in labels.values())
    used = {a: v for a, v in labels.items() if v != AttemptLabel.UNSURE}
    judge: dict[uuid.UUID, str] = {}
    combined: dict[uuid.UUID, str] = {}
    if used:
        judge = {
            row.attempt_id: row.outcome
            for row in db.scalars(
                select(DetectionResult).where(
                    DetectionResult.attempt_id.in_(list(used)),
                    DetectionResult.method == DetectionMethod.LLM_JUDGE,
                )
            )
        }
        combined = {
            row.attempt_id: row.outcome
            for row in db.scalars(
                select(DetectionVerdict).where(DetectionVerdict.attempt_id.in_(list(used)))
            )
        }
    rows = []
    for key, label, said in (
        ("llm_judge", "The LLM judge alone", judge),
        ("combined", "The combined detection", combined),
    ):
        counted = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
        silent = 0
        for attempt_id, verdict in used.items():
            outcome = said.get(attempt_id)
            if outcome not in (Outcome.MET, Outcome.NOT_MET):
                silent += 1  # pending or not evaluated: it said nothing to compare
                continue
            met = outcome == Outcome.MET
            person = verdict == AttemptLabel.SUCCESSFUL
            counted["tp" if met and person else "fp" if met else "fn" if person else "tn"] += 1
        total = sum(counted.values())
        rows.append(
            Agreement(
                key=key,
                label=label,
                labelled=total,
                unsure=unsure,
                without_verdict=silent,
                true_positive=counted["tp"],
                false_positive=counted["fp"],
                true_negative=counted["tn"],
                false_negative=counted["fn"],
                precision=_rate(counted["tp"], counted["tp"] + counted["fp"]),
                recall=_rate(counted["tp"], counted["tp"] + counted["fn"]),
                agreement=_rate(counted["tp"] + counted["tn"], total),
            )
        )
    return rows


# ---------------------------------------------------------------- the evaluation (step 6)


@dataclass
class Documented:
    """One lab target's list of documented weaknesses, with the version the metrics were measured
    against (success end condition, and 2a1)."""

    target_id: uuid.UUID
    target_name: str
    count: int
    version: int
    added_by_analyst: int


@dataclass
class Baseline:
    """UC-11.5, 4a1: this run against the one it repeats, after remediations were deployed."""

    code: str
    name: str
    rows: list[dict]
    note: str = NO_BENIGN


@dataclass
class Evaluation:
    code: str
    name: str
    status: str
    ended_at: datetime | None
    ready: bool  # every repetition has ended (the precondition of UC-11.5)
    judge_every_attempt: bool
    documented: list[Documented]
    strategies: list[StrategyMetrics]
    agreement: list[Agreement]
    unmatched: list[Matched]
    sample_total: int
    sample_labelled: int
    incomplete: int
    missing: list[str]  # which labels are still missing (failed end condition)
    baseline: Baseline | None


def _names(db: Session, run: BenchmarkRun) -> dict[uuid.UUID, str]:
    """The lab targets' names as they were when the run started (FR-4.5), else as they are now."""
    fixed = {
        uuid.UUID(str(item["id"])): item["name"]
        for item in (run.versions or {}).get("lab_targets", [])
    }
    for repetition in run.repetition_rows:
        if repetition.target_id not in fixed:
            target = db.get(Target, repetition.target_id)
            fixed[repetition.target_id] = target.name if target else ""
    return fixed


def _success_rates(evaluated: Evaluation) -> dict[str, float | None]:
    return {
        strategy.key: next(
            (f.mean for f in strategy.figures if f.key == "attack_success_rate"), None
        )
        for strategy in evaluated.strategies
    }


def _measure(
    db: Session,
    repetition: BenchmarkRepetition,
    rows: list[Matched],
    names: dict[uuid.UUID, str],
    documented: dict[uuid.UUID, Documented],
) -> Measure:
    """One repetition's numbers. The cost is the copy its own row keeps, because the usage rows
    behind it may have reached the end of their retention period (FR-10.5)."""
    tokens, successful = 0, 0
    if repetition.campaign_run_id is not None:
        tokens = (
            db.scalar(
                select(
                    func.coalesce(func.sum(LLMUsage.prompt_tokens + LLMUsage.completion_tokens), 0)
                ).where(LLMUsage.campaign_run_id == repetition.campaign_run_id)
            )
            or 0
        )
        successful = (
            db.scalar(
                select(func.count()).where(
                    DetectionVerdict.campaign_run_id == repetition.campaign_run_id,
                    DetectionVerdict.outcome == Outcome.MET,
                )
            )
            or 0
        )
    minutes = None
    if repetition.started_at and repetition.ended_at:
        minutes = round((repetition.ended_at - repetition.started_at).total_seconds() / 60, 1)
    unmatched_rows = [row for row in rows if row.known_id is None]
    return Measure(
        id=repetition.id,
        target_name=names.get(repetition.target_id, ""),
        repetition=repetition.repetition,
        status=repetition.status,
        reason=repetition.reason,
        documented=documented[repetition.target_id].count,
        discovered=len({row.known_id for row in rows if row.known_id}),
        findings=len(rows),
        false_positives=sum(row.label == FindingLabel.FALSE_POSITIVE for row in unmatched_rows),
        unlabelled=sum(row.label is None for row in unmatched_rows),
        attempts=repetition.attempts_sent,
        successful=successful,
        minutes=minutes,
        tokens=int(tokens),
        cost_usd=repetition.cost_usd,
    )


def evaluation(db: Session, run: BenchmarkRun, *, with_baseline: bool = True) -> Evaluation:
    """UC-11.5: everything Screen 69 shows. It is calculated when it is read, so documenting a
    weakness (2a1) or labelling one more attempt changes the figures at once."""
    names = _names(db, run)
    matched = {row.id: match(db, run, row) for row in run.repetition_rows}
    documented: dict[uuid.UUID, Documented] = {}
    for repetition in run.repetition_rows:
        if repetition.target_id in documented:
            continue
        known, version = known_of(db, repetition.target_id)
        documented[repetition.target_id] = Documented(
            target_id=repetition.target_id,
            target_name=names.get(repetition.target_id, ""),
            count=len(known),
            version=version,
            added_by_analyst=sum(item.source == "analyst" for item in known),
        )
    strategies = []
    for item in run.strategies or []:
        rows = [r for r in run.repetition_rows if r.strategy_key == item["key"]]
        measures = [
            _measure(db, repetition, matched[repetition.id], names, documented)
            for repetition in rows
        ]
        strategies.append(
            StrategyMetrics(
                key=item["key"],
                name=item.get("name") or item["key"],
                suites=item.get("suites") or [],
                adaptive_agent=bool(item.get("adaptive_agent")),
                completed=sum(m.status == RepetitionStatus.COMPLETED for m in measures),
                incomplete=sum(m.status == RepetitionStatus.INCOMPLETE for m in measures),
                figures=_figures(measures),
                rows=measures,
            )
        )
    open_findings = [row for rows in matched.values() for row in rows if row.known_id is None]
    seen: dict[uuid.UUID, Matched] = {}
    for row in open_findings:
        seen.setdefault(row.finding_id, row)
    ids = sample_ids(db, run)
    labelled = 0
    if ids:
        labelled = (
            db.scalar(
                select(func.count()).where(
                    BenchmarkLabel.benchmark_run_id == run.id,
                    BenchmarkLabel.kind == LabelKind.ATTEMPT,
                    BenchmarkLabel.attempt_id.in_(ids),
                )
            )
            or 0
        )
    ready = all(
        r.status in (RepetitionStatus.COMPLETED, RepetitionStatus.INCOMPLETE)
        for r in run.repetition_rows
    )
    missing = []
    if not ready:
        missing.append(NOT_FINISHED)
    if waiting := len(ids) - labelled:
        missing.append(
            f"{waiting} of the {len(ids)} attempts of the blind sample aren't labelled yet."
        )
    if unjudged := sum(row.label is None for row in seen.values()):
        missing.append(
            f"{unjudged} finding{'' if unjudged == 1 else 's'} that matched no documented "
            "weakness " + ("isn't" if unjudged == 1 else "aren't") + " labelled yet."
        )
    evaluated = Evaluation(
        code=run.code,
        name=run.name,
        status=run.status,
        ended_at=run.ended_at,
        ready=ready,
        judge_every_attempt=run.judge_every_attempt,
        documented=list(documented.values()),
        strategies=strategies,
        agreement=agreement(db, run),
        unmatched=list(seen.values()),
        sample_total=len(ids),
        sample_labelled=labelled,
        incomplete=sum(r.status == RepetitionStatus.INCOMPLETE for r in run.repetition_rows),
        missing=missing,
        baseline=None,
    )
    if with_baseline and run.baseline_id and (earlier := db.get(BenchmarkRun, run.baseline_id)):
        before = _success_rates(evaluation(db, earlier, with_baseline=False))
        now = _success_rates(evaluated)
        evaluated.baseline = Baseline(
            code=earlier.code,
            name=earlier.name,
            rows=[
                {
                    "strategy_key": strategy.key,
                    "strategy_name": strategy.name,
                    "success_rate": now.get(strategy.key),
                    "baseline_rate": before.get(strategy.key),
                    "reduction": _rate(
                        before[strategy.key] - (now.get(strategy.key) or 0),
                        before[strategy.key],
                    )
                    if before.get(strategy.key)
                    else None,
                }
                for strategy in strategies
            ],
        )
    return evaluated
