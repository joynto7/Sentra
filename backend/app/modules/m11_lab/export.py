"""The export of a benchmark run (FR-11.5, UC-11.6): the data behind the figures, in a form a
statistical tool can read and another researcher can repeat the experiment from.

Two decisions shape this file:

- **Whatever the level of detail, the file carries the whole experiment** (quality requirement 4):
  the configuration, the versions fixed when the run started, each lab target's documented list
  with its version, and every label an analyst made. In JSON they are objects beside the results;
  in CSV they are `#` lines above the table, which R (`read.csv(comment.char = "#")`) and pandas
  (`read_csv(comment="#")`) skip, and the columns that a statistical model needs — the strategy,
  the lab target, the budget and the models — are repeated on every row instead, because that is
  what a tidy table is (NFR-7.5).
- **What was deleted is marked, not hidden** (2a1): an attempt whose reply has gone at the end of
  its retention period (FR-10.5) is still exported with its result and its label, with the content
  columns empty and `content_available` false, so a count over the export stays correct.

The checksum is the SHA-256 of the exact bytes that are downloaded, so anyone can verify the file
they were given (quality requirement 5).
"""

import csv
import hashlib
import io
import json
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import FieldValidationError
from app.modules.m04_tests.schema import DetectionMethod
from app.modules.m05_campaigns.models import Attempt
from app.modules.m06_findings.models import DetectionResult, DetectionVerdict, Evidence
from app.modules.m11_lab import metrics
from app.modules.m11_lab.models import BenchmarkLabel, BenchmarkRun, LabelKind

EXPORT_VERSION = 1
FORMATS = ("csv", "json")
LEVELS = ("strategy", "repetition", "attempt")
LEVEL_LABELS = {
    "strategy": "Metrics per strategy",
    "repetition": "One row per repetition",
    "attempt": "One row per attempt",
}
MEDIA = {"csv": "text/csv; charset=utf-8", "json": "application/json"}


@dataclass
class Export:
    filename: str
    media_type: str
    content: str
    checksum: str  # SHA-256 of the bytes below
    rows: int
    without_content: int  # attempts whose evidence has been deleted (2a1)


def _when(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment else None


def _configuration(db: Session, run: BenchmarkRun, found: metrics.Evaluation) -> dict:
    """UC-11.6 step 3: everything that was decided before the run started."""
    baseline = db.get(BenchmarkRun, run.baseline_id) if run.baseline_id else None
    return {
        "benchmark": run.code,
        "name": run.name,
        "status": run.status,
        "lab_targets": [
            {"id": str(item.target_id), "name": item.target_name} for item in found.documented
        ],
        "strategies": run.strategies,
        "attempt_budget": run.attempt_budget,
        "repetitions": run.repetitions,
        "judge_every_attempt": run.judge_every_attempt,
        "baseline": baseline.code if baseline else None,
        "order_seed": run.order_seed,
        "started_at": _when(run.started_at),
        "ended_at": _when(run.ended_at),
    }


def _versions(db: Session, run: BenchmarkRun, found: metrics.Evaluation) -> dict:
    """UC-11.6 step 4: the versions that make the experiment repeatable, the documented lists
    among them — the discovery rate means nothing without the list it was measured against."""
    lists = []
    for item in found.documented:
        known, version = metrics.known_of(db, item.target_id)
        lists.append(
            {
                "lab_target": item.target_name,
                "version": version,
                "known_vulnerabilities": [
                    {
                        "id": one.id,
                        "title": one.title,
                        "category": one.category,
                        "slot": one.slot,
                        "component": one.component,
                        "source": one.source,
                    }
                    for one in known
                ],
            }
        )
    return {**(run.versions or {}), "known_vulnerability_lists": lists}


def _labels(db: Session, run: BenchmarkRun) -> dict:
    """The analyst's own judgements, which the agreement figures rest on (UC-11.5 steps 2-3)."""
    rows = list(
        db.scalars(
            select(BenchmarkLabel)
            .where(BenchmarkLabel.benchmark_run_id == run.id)
            .order_by(BenchmarkLabel.labelled_at)
        )
    )
    return {
        "attempts": [
            {
                "attempt_id": str(row.attempt_id),
                "verdict": row.verdict,
                "note": row.note,
                "labelled_at": _when(row.labelled_at),
            }
            for row in rows
            if row.kind == LabelKind.ATTEMPT
        ],
        "findings": [
            {
                "finding_id": str(row.finding_id),
                "verdict": row.verdict,
                "note": row.note,
                "labelled_at": _when(row.labelled_at),
            }
            for row in rows
            if row.kind == LabelKind.FINDING
        ],
    }


# ---------------------------------------------------------------- the three levels


def _per_strategy(found: metrics.Evaluation) -> list[dict]:
    rows = []
    for strategy in found.strategies:
        row = {
            "benchmark": found.code,
            "strategy": strategy.key,
            "strategy_name": strategy.name,
            "adaptive_agent": strategy.adaptive_agent,
            "suites": " ".join(strategy.suites),
            "repetitions_completed": strategy.completed,
            "repetitions_incomplete": strategy.incomplete,
        }
        for figure in strategy.figures:
            row[f"{figure.key}_mean"] = figure.mean
            row[f"{figure.key}_sd"] = figure.sd
            row[f"{figure.key}_n"] = figure.repetitions
        rows.append(row)
    return rows


def _per_repetition(found: metrics.Evaluation) -> list[dict]:
    return [
        {
            "benchmark": found.code,
            "strategy": strategy.key,
            "strategy_name": strategy.name,
            "adaptive_agent": strategy.adaptive_agent,
            "lab_target": measure.target_name,
            "repetition": measure.repetition,
            "status": measure.status,
            "reason": measure.reason,
            "documented": measure.documented,
            "discovered": measure.discovered,
            "findings": measure.findings,
            "false_positives": measure.false_positives,
            "findings_unlabelled": measure.unlabelled,
            "attempts": measure.attempts,
            "successful_attempts": measure.successful,
            "minutes": measure.minutes,
            "llm_tokens": measure.tokens,
            "llm_cost_usd": str(measure.cost_usd),
        }
        for strategy in found.strategies
        for measure in strategy.rows
    ]


def _per_attempt(db: Session, run: BenchmarkRun) -> list[dict]:
    """One row per attempt of every repetition: what was sent, what came back, what each
    detection said, and what the analyst said about it when it was in the blind sample."""
    sample = set(metrics.sample_ids(db, run))
    labels = {
        label.attempt_id: label
        for label in db.scalars(
            select(BenchmarkLabel).where(
                BenchmarkLabel.benchmark_run_id == run.id,
                BenchmarkLabel.kind == LabelKind.ATTEMPT,
            )
        )
    }
    names = metrics.target_names(db, run)
    rows: list[dict] = []
    for repetition in sorted(run.repetition_rows, key=lambda r: r.order_no):
        if repetition.campaign_run_id is None:
            continue
        attempts = list(
            db.scalars(
                select(Attempt)
                .where(Attempt.campaign_run_id == repetition.campaign_run_id)
                .order_by(Attempt.attempt_no)
            )
        )
        if not attempts:
            continue
        ids = [attempt.id for attempt in attempts]
        verdicts = {
            row.attempt_id: row
            for row in db.scalars(
                select(DetectionVerdict).where(DetectionVerdict.attempt_id.in_(ids))
            )
        }
        judged = {
            row.attempt_id: row
            for row in db.scalars(
                select(DetectionResult).where(
                    DetectionResult.attempt_id.in_(ids),
                    DetectionResult.method == DetectionMethod.LLM_JUDGE,
                )
            )
        }
        kept = set(
            db.scalars(select(Evidence.attempt_id).where(Evidence.attempt_id.in_(ids))).all()
        )
        for attempt in attempts:
            verdict = verdicts.get(attempt.id)
            judge = judged.get(attempt.id)
            label = labels.get(attempt.id)
            # 2a1: the reply is what retention deletes first, and the row stays either way
            has_content = attempt.reply is not None
            rows.append(
                {
                    "benchmark": run.code,
                    "strategy": repetition.strategy_key,
                    "lab_target": names.get(repetition.target_id, ""),
                    "repetition": repetition.repetition,
                    "order_no": repetition.order_no,
                    "campaign_run_id": str(repetition.campaign_run_id),
                    "attempt_id": str(attempt.id),
                    "attempt_no": attempt.attempt_no,
                    "test_code": attempt.test_code,
                    "suite_code": attempt.suite_code,
                    "template": attempt.template,
                    "variant": attempt.variant,
                    "status": attempt.status,
                    "sent_at": _when(attempt.sent_at),
                    "duration_ms": attempt.duration_ms,
                    "combined_verdict": verdict.outcome if verdict else None,
                    "decided_by": verdict.decided_by if verdict else None,
                    "judge_verdict": judge.outcome if judge else None,
                    "judge_confidence": str(judge.confidence)
                    if judge and judge.confidence
                    else None,
                    "in_blind_sample": attempt.id in sample,
                    "analyst_label": label.verdict if label else None,
                    "analyst_note": label.note if label else None,
                    "content_available": has_content,
                    "evidence_stored": attempt.id in kept,
                    "message": attempt.input if has_content else None,
                    "reply": attempt.reply,
                    "tool_calls": attempt.tool_calls,
                }
            )
    return rows


# ---------------------------------------------------------------- the two formats


def _csv(head: dict, rows: list[dict]) -> str:
    """The configuration and the versions as `#` lines, then the table. A reader that doesn't
    skip comments sees one odd first column; one that does sees exactly the table."""
    out = io.StringIO()
    for key, value in head.items():
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        out.write(f"# {key}: {text}\n")
    if rows:
        columns = list(rows[0])
        writer = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _cell(row.get(key)) for key in columns})
    return out.getvalue()


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def build(db: Session, run: BenchmarkRun, *, fmt: str, level: str) -> Export:
    """UC-11.6 steps 1-5: the chosen table, with the whole experiment around it."""
    if fmt not in FORMATS:
        raise FieldValidationError("format", "Choose CSV or JSON.")
    if level not in LEVELS:
        raise FieldValidationError("level", "Choose per strategy, per repetition or per attempt.")
    found = metrics.evaluation(db, run)
    configuration = _configuration(db, run, found)
    versions = _versions(db, run, found)
    labels = _labels(db, run)
    rows = {
        "strategy": lambda: _per_strategy(found),
        "repetition": lambda: _per_repetition(found),
        "attempt": lambda: _per_attempt(db, run),
    }[level]()
    made = datetime.now(UTC)
    stamp = made.strftime("%Y%m%d-%H%M")
    about = {
        "export_version": EXPORT_VERSION,
        "created_at": made.isoformat(),
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "rows": len(rows),
        "sentra": "Sentra benchmark export (FR-11.5)",
    }
    if fmt == "json":
        content = json.dumps(
            {
                "export": about,
                "configuration": configuration,
                "versions": versions,
                "labels": labels,
                "results": rows,
            },
            indent=2,
            ensure_ascii=False,
        )
    else:
        content = _csv(
            {
                **{f"export_{key}": value for key, value in about.items()},
                **{f"configuration_{key}": value for key, value in configuration.items()},
                **{f"versions_{key}": value for key, value in versions.items()},
                "labels": labels,
            },
            rows,
        )
    return Export(
        filename=f"sentra-benchmark-{run.code}-{level}-{stamp}.{fmt}",
        media_type=MEDIA[fmt],
        content=content,
        checksum=hashlib.sha256(content.encode("utf-8")).hexdigest(),
        rows=len(rows),
        without_content=sum(1 for row in rows if row.get("content_available") is False),
    )


def summary(db: Session, run: BenchmarkRun) -> dict:
    """What the export dialog says before anything is made (Screen 69)."""
    found = metrics.evaluation(db, run)
    runs = [row.campaign_run_id for row in run.repetition_rows if row.campaign_run_id]
    attempts = (
        db.scalar(select(func.count()).where(Attempt.campaign_run_id.in_(runs))) or 0 if runs else 0
    )
    return {
        "strategy": len(found.strategies),
        "repetition": sum(len(s.rows) for s in found.strategies),
        "attempt": attempts,
        "labels": found.sample_labelled + sum(1 for row in found.unmatched if row.label),
    }
