"""The Security Lab (FR-11.1, FR-11.2): the lab catalogue, deploying a lab target in the
organization and resetting it (UC-11.1, UC-11.2, Screen 65).

Only a Security Analyst of the organization uses the lab, and each organization sees only its own
lab targets (NFR-3.3). Users can't register Lab zone addresses themselves (UC-11.1, quality
requirement 4): this is the only door into the Lab zone.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership, current_user
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets.models import Target
from app.modules.m11_lab import benchmark, deployment, metrics
from app.modules.m11_lab.models import BenchmarkRun
from app.modules.m11_lab.schemas import (
    AgreementOut,
    BaselineOut,
    BenchmarkDetail,
    BenchmarkIn,
    BenchmarkItem,
    DocumentedOut,
    EstimateOut,
    EvaluationOut,
    FigureOut,
    KnownVulnerability,
    LabCardOut,
    LabelIn,
    LabOut,
    MatchedOut,
    MeasureOut,
    RepetitionOut,
    StrategyMetricsOut,
    StrategyOut,
    ToLabelOut,
)

router = APIRouter(prefix="/lab", tags=["M11 Security Lab"])


def _out(card: deployment.Card) -> LabCardOut:
    return LabCardOut(**card.__dict__)


@router.get("")
def security_lab(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> LabOut:
    """Screen 65: the lab catalogue with the readiness of every lab target this organization has
    deployed (UC-11.1 step 1, UC-11.2 step 1). Every member may read it."""
    found = deployment.cards(db, membership.organization_id)
    return LabOut(cards=[_out(card) for card in found.cards], isolation=found.isolation)


@router.post("/targets/{key}/deploy", status_code=201)
def deploy_lab_target(
    key: str,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> LabCardOut:
    """UC-11.1: the lab target becomes a verified target of this organization, with its canary
    tokens and its connection tested. A lab target the organization already has comes back as it
    is (1a1); a Lab zone that isn't running answers `409 lab_zone_down` with what to start (2a1)."""
    return _out(deployment.deploy(db, membership, user, key))


@router.post("/targets/{target_id}/reset")
def reset_lab_target(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> LabCardOut:
    """UC-11.2: the lab target goes back to its original state and gets new canary tokens. It is
    marked resetting at once and the work runs on a worker; a campaign run that is in progress
    refuses the reset (1a1)."""
    return _out(deployment.start_reset(db, membership, user, target_id))


@router.get("/targets/{target_id}/vulnerabilities")
def known_vulnerabilities(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[KnownVulnerability]:
    """UC-11.1 step 1: what this lab target is documented to be vulnerable to (FR-11.1), as the
    application itself reported it."""
    found = deployment.vulnerabilities(db, membership.organization_id, target_id)
    return [KnownVulnerability(**item) for item in found]


# ---------------------------------------------------------------- benchmark runs (FR-11.3)


def _draft(data: BenchmarkIn) -> benchmark.Draft:
    return benchmark.Draft(
        name=data.name,
        target_ids=data.target_ids,
        strategies=[
            benchmark.Strategy(
                key=s.key.strip().upper(),
                name=s.name.strip() or f"Strategy {s.key.strip().upper()}",
                suites=s.suites,
                adaptive_agent=s.adaptive_agent,
            )
            for s in data.strategies
        ],
        attempt_budget=data.attempt_budget,
        repetitions=data.repetitions,
        judge_every_attempt=data.judge_every_attempt,
        baseline_code=data.baseline_code,
    )


def _item(db: Session, run: BenchmarkRun) -> BenchmarkItem:
    rows = run.repetition_rows
    done = [r for r in rows if r.status in ("completed", "incomplete")]
    baseline = db.get(BenchmarkRun, run.baseline_id) if run.baseline_id else None
    names = {str(t["id"]): t["name"] for t in (run.versions or {}).get("lab_targets", [])}
    targets = [
        names.get(str(target_id))
        or (db.get(Target, target_id).name if db.get(Target, target_id) else "")
        for target_id in dict.fromkeys(row.target_id for row in rows)
    ]
    return BenchmarkItem(
        code=run.code,
        name=run.name,
        status=run.status,
        status_message=run.status_message,
        strategies=[StrategyOut(**s) for s in run.strategies],
        attempt_budget=run.attempt_budget,
        repetitions=run.repetitions,
        judge_every_attempt=run.judge_every_attempt,
        baseline_code=baseline.code if baseline else None,
        lab_targets=targets,
        runs_total=len(rows),
        runs_done=len(done),
        created_at=run.created_at,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


def _detail(db: Session, run: BenchmarkRun) -> BenchmarkDetail:
    item = _item(db, run)
    names = {str(t["id"]): t["name"] for t in (run.versions or {}).get("lab_targets", [])}
    return BenchmarkDetail(
        **item.model_dump(),
        estimate=run.estimate,
        versions=run.versions,
        order_seed=run.order_seed,
        repetition_rows=[
            RepetitionOut(
                id=row.id,
                target_id=row.target_id,
                target_name=names.get(str(row.target_id))
                or (db.get(Target, row.target_id).name if db.get(Target, row.target_id) else ""),
                strategy_key=row.strategy_key,
                repetition=row.repetition,
                order_no=row.order_no,
                status=row.status,
                reason=row.reason,
                campaign_run_id=row.campaign_run_id,
                started_at=row.started_at,
                ended_at=row.ended_at,
                attempts_sent=row.attempts_sent,
                cost_usd=row.cost_usd,
            )
            for row in run.repetition_rows
        ],
    )


@router.post("/benchmarks/estimate")
def estimate_benchmark(
    data: BenchmarkIn,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> EstimateOut:
    """UC-11.3 step 5: the attempts, the time and the LLM cost of the experiment, with the monthly
    limits it would pass (5a1)."""
    found = benchmark.estimate(db, membership.organization_id, _draft(data))
    return EstimateOut(**found.__dict__)


@router.get("/benchmarks")
def list_benchmarks(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> list[BenchmarkItem]:
    """The "Benchmark runs" tab of Screen 65; every member may read it."""
    return [_item(db, run) for run in benchmark.listing(db, membership.organization_id)]


@router.post("/benchmarks", status_code=201)
def save_benchmark(
    data: BenchmarkIn,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> BenchmarkDetail:
    """UC-11.3 steps 1-6: the experiment is saved as a draft with its estimate, and started by
    `POST /lab/benchmarks/{code}/start`."""
    return _detail(db, benchmark.save(db, membership, user, _draft(data)))


@router.get("/benchmarks/{code}")
def read_benchmark(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> BenchmarkDetail:
    """Screen 67: the configuration, the fixed versions and every repetition with its place in the
    random order (UC-11.4)."""
    return _detail(db, benchmark.row_of(db, membership.organization_id, code))


@router.post("/benchmarks/{code}/start")
def start_benchmark(
    code: str,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> BenchmarkDetail:
    """UC-11.3 step 6 into UC-11.4: the versions are fixed and the first repetition begins."""
    return _detail(db, benchmark.start(db, membership, user, code))


@router.post("/benchmarks/{code}/pause")
def pause_benchmark(
    code: str,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> BenchmarkDetail:
    """UC-11.4: no further repetition starts; the one that is going finishes."""
    return _detail(db, benchmark.pause(db, membership, user, code))


@router.post("/benchmarks/{code}/resume")
def resume_benchmark(
    code: str,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> BenchmarkDetail:
    """UC-11.4, 3a1 and 4b1: it goes on from where it stopped."""
    return _detail(db, benchmark.resume(db, membership, user, code))


@router.post("/benchmarks/{code}/stop")
def stop_benchmark(
    code: str,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> BenchmarkDetail:
    """The analyst stops the experiment; the repetitions that finished are kept."""
    return _detail(db, benchmark.stop(db, membership, user, code))


# ---------------------------------------------------------------- the evaluation (FR-11.4)


def _matched(row: metrics.Matched) -> MatchedOut:
    return MatchedOut(**row.__dict__)


def _evaluation(found: metrics.Evaluation) -> EvaluationOut:
    return EvaluationOut(
        **{
            **found.__dict__,
            "documented": [DocumentedOut(**item.__dict__) for item in found.documented],
            "strategies": [
                StrategyMetricsOut(
                    **{
                        **strategy.__dict__,
                        "figures": [FigureOut(**f.__dict__) for f in strategy.figures],
                        "rows": [MeasureOut(**m.__dict__) for m in strategy.rows],
                    }
                )
                for strategy in found.strategies
            ],
            "agreement": [AgreementOut(**row.__dict__) for row in found.agreement],
            "unmatched": [_matched(row) for row in found.unmatched],
            "baseline": BaselineOut(**found.baseline.__dict__) if found.baseline else None,
        }
    )


@router.get("/benchmarks/{code}/evaluation")
def read_evaluation(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> EvaluationOut:
    """Screen 69 (UC-11.5): the metrics of every strategy with the mean and spread over the
    repetitions, the detection agreement, the version of each list of documented weaknesses, and
    which labels are still missing. It is calculated when it is read, so one more label or a
    newly documented weakness (2a1) changes it at once. Every member may read it."""
    run = benchmark.row_of(db, membership.organization_id, code)
    return _evaluation(metrics.evaluation(db, run))


@router.get("/benchmarks/{code}/findings")
def unmatched_findings(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[MatchedOut]:
    """UC-11.5 step 2: the findings of the run that matched no documented weakness."""
    run = benchmark.row_of(db, membership.organization_id, code)
    return [_matched(row) for row in metrics.unmatched(db, run)]


@router.post("/benchmarks/{code}/findings/{finding_id}/label")
def label_finding(
    code: str,
    finding_id: uuid.UUID,
    data: LabelIn,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[MatchedOut]:
    """UC-11.5 step 2: a false positive, or a real weakness the lab target's list doesn't name
    yet — which documents it as a new version of that list (2a1)."""
    run = benchmark.row_of(db, membership.organization_id, code)
    found = metrics.label_finding(db, membership, user, run, finding_id, data.verdict, data.note)
    return [_matched(row) for row in found]


@router.get("/benchmarks/{code}/sample")
def blind_sample(
    code: str,
    place: int | None = None,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> ToLabelOut | None:
    """Screen 68 (UC-11.5 step 3): the next attempt of the random sample to label, or the one at
    `place`. Nothing in the answer says what Sentra decided (quality requirement 3)."""
    run = benchmark.row_of(db, membership.organization_id, code)
    found = metrics.sample(db, run, place)
    return ToLabelOut(**found.__dict__) if found else None


@router.post("/benchmarks/{code}/sample/{attempt_id}/label")
def label_attempt(
    code: str,
    attempt_id: uuid.UUID,
    data: LabelIn,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ToLabelOut | None:
    """UC-11.5 step 3: successful, unsuccessful or unsure, and the next attempt comes back. A
    second label on the same attempt replaces the first."""
    run = benchmark.row_of(db, membership.organization_id, code)
    found = metrics.label_attempt(db, membership, user, run, attempt_id, data.verdict, data.note)
    return ToLabelOut(**found.__dict__) if found else None
