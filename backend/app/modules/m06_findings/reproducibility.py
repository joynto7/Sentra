"""How reliably a finding can be reproduced (FR-6.4; UC-6.3 Measure Reproducibility).

The behaviour of an LLM varies between identical requests, so one successful attempt says little.
Once a finding is recorded, Sentra repeats the attempt behind it until the campaign's number of
repetitions is reached, counts how many of those attempts succeeded and keeps the score with the
finding, as successful attempts divided by total attempts (step 4).

The repetitions are ordinary attempts of the run: the send loop sends them within the request
rate, they count against the attempt budget and they follow every safety limit of FR-5.7 (quality
requirement 2). They are evaluated like any other attempt, so a repetition that succeeds adds its
evidence to the same finding (UC-6.2, 2a) and starts no measurement of its own.

A measurement belongs to one finding in one campaign run and ends
- **complete**, when as many attempts of the finding's test have been evaluated in that run as the
  campaign asks for;
- **incomplete**, when the remaining attempt budget had no room for the rest (2a1), or the run was
  paused, stopped or finished first (2b1). What was measured is kept, and the score says so.

Everything here is driven by the run's own attempts, so it needs no clock and no job of its own:
m06_findings/hooks.py calls it for every evaluated attempt and once when the run ends.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.m05_campaigns.models import (
    ACTIVE,
    Attempt,
    AttemptPriority,
    AttemptStatus,
    CampaignRun,
)
from app.modules.m06_findings.models import (
    DetectionVerdict,
    Evidence,
    EvidenceKind,
    Finding,
    MeasurementStatus,
    Outcome,
    ReproducibilityMeasurement,
)

log = logging.getLogger("uvicorn.error")
TRIES = 3  # of adding the repetitions, when another worker numbers an attempt at the same moment
NO_BUDGET = "The remaining attempt budget had no room for the rest of the repetitions."
RUN_ENDED = "The campaign run ended before the rest of the repetitions were sent."
NOTHING_LEFT = "No attempt of this test was left to send."


def now() -> datetime:
    return datetime.now(UTC)


def wanted_of(run: CampaignRun) -> int:
    """How often the campaign repeats a successful attempt (FR-6.4, configurable in the builder).
    The run's own settings, so a later change of the campaign doesn't change a measurement."""
    return max(1, int((run.settings or {}).get("repetitions") or 1))


# ---------------------------------------------------------------- the measurement (UC-6.3)


def after_attempt(db: Session, attempt: Attempt) -> dict | None:
    """Every evaluated attempt of a run: it starts or extends the measurement of the finding the
    attempt supports (steps 1-2), counts the attempt (step 3) and, when the last repetition has
    been evaluated, stores the score and rates the finding again (steps 4-5). Returns what the
    live campaign monitor shows with the attempt."""
    run = db.get(CampaignRun, attempt.campaign_run_id)
    if run is None:
        return None
    supported = _finding_of(db, attempt)
    if supported is not None:
        _start(db, run, supported, attempt)
    shown = None
    for row in _measuring(db, run, attempt.test_code):
        shown = _count(db, run, row) or shown
    return shown


def close_open(db: Session, run: CampaignRun) -> None:
    """2b1, when the run has ended: what was measured is the score of each measurement that is
    still open, marked incomplete with the reason."""
    for row in _measuring(db, run):
        _count(db, run, row, ended=True)


def _finding_of(db: Session, attempt: Attempt) -> Finding | None:
    """The finding this attempt supports, which is the one its evidence belongs to (UC-6.2). An
    attempt that met no success condition supports none."""
    finding_id = db.scalar(
        select(Evidence.finding_id).where(
            Evidence.attempt_id == attempt.id, Evidence.kind == EvidenceKind.ATTEMPT
        )
    )
    return db.get(Finding, finding_id) if finding_id else None


def _measuring(
    db: Session, run: CampaignRun, test_code: str = ""
) -> list[ReproducibilityMeasurement]:
    query = select(ReproducibilityMeasurement).where(
        ReproducibilityMeasurement.campaign_run_id == run.id,
        ReproducibilityMeasurement.status == MeasurementStatus.MEASURING,
    )
    if test_code:
        query = query.where(ReproducibilityMeasurement.test_code == test_code)
    return list(db.scalars(query.order_by(ReproducibilityMeasurement.started_at)))


def _lock(db: Session, row: ReproducibilityMeasurement) -> ReproducibilityMeasurement | None:
    """The measurement's row as the database holds it now. The analysis worker evaluates the LLM
    judge's answers while the run's own worker sends attempts, so both can reach one measurement."""
    return db.scalar(
        select(ReproducibilityMeasurement)
        .where(ReproducibilityMeasurement.id == row.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _start(
    db: Session, run: CampaignRun, finding: Finding, attempt: Attempt
) -> ReproducibilityMeasurement | None:
    """Steps 1-2: the finding's measurement in this run, and the repetitions it still needs."""
    row = db.scalar(
        select(ReproducibilityMeasurement)
        .where(
            ReproducibilityMeasurement.finding_id == finding.id,
            ReproducibilityMeasurement.campaign_run_id == run.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        row = ReproducibilityMeasurement(
            organization_id=finding.organization_id,
            finding_id=finding.id,
            campaign_run_id=run.id,
            test_code=attempt.test_code,
            wanted=wanted_of(run),
            started_at=now(),
        )
        db.add(row)
        db.flush()
    if row.status == MeasurementStatus.MEASURING:
        _schedule(db, run, row, attempt)
        db.commit()
    return row


def _schedule(
    db: Session,
    run: CampaignRun,
    row: ReproducibilityMeasurement,
    attempt: Attempt,
) -> None:
    """Step 1 and 2a: as many repetitions as are still missing, and as the remaining attempt
    budget has room for. Attempts that are already planned keep their place in the budget, so a
    measurement never takes it from the tests that haven't run yet."""
    if run.status not in ACTIVE:  # the judge answered after the run had ended
        return
    evaluated, _ = counts(db, row)
    waiting = _waiting(db, run, row.test_code)
    missing = row.wanted - evaluated - waiting
    if missing <= 0:
        return
    room = max(0, run.attempt_budget - run.attempts_sent - _waiting(db, run))
    add = min(missing, room)
    if add and _repeats(db, run, attempt, add):
        row.scheduled += add
    if add < missing:  # 2a1: the score will be based on fewer repetitions than configured
        row.reason = NO_BUDGET


def _waiting(db: Session, run: CampaignRun, test_code: str = "") -> int:
    """The attempts of the run that are still to be sent: of one test, or of the whole run."""
    query = select(func.count()).where(
        Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.PLANNED
    )
    if test_code:
        query = query.where(Attempt.test_code == test_code)
    return db.scalar(query)


def _repeats(db: Session, run: CampaignRun, attempt: Attempt, count: int) -> bool:
    """The same message again, in a new conversation each time, before the attempts that are still
    planned (AttemptPriority.FOLLOW_UP). Nothing of the attempt is changed: a repetition is the
    same request, because that is what makes the measurement a measurement."""
    for _ in range(TRIES):
        savepoint = db.begin_nested()
        try:
            number = db.scalar(
                select(func.max(Attempt.attempt_no)).where(Attempt.campaign_run_id == run.id)
            )
            for next_number in range(number + 1, number + 1 + count):
                db.add(
                    Attempt(
                        organization_id=attempt.organization_id,
                        campaign_run_id=run.id,
                        attempt_no=next_number,
                        test_definition_id=attempt.test_definition_id,
                        test_code=attempt.test_code,
                        suite_code=attempt.suite_code,
                        template=attempt.template,
                        variant=attempt.variant,
                        priority=AttemptPriority.FOLLOW_UP,
                        repeat_of_id=attempt.id,
                        input=attempt.input,
                        session_id=uuid.uuid4().hex,
                    )
                )
            db.flush()
        except IntegrityError:
            # Another worker numbered an attempt of this run at the same moment: look again.
            savepoint.rollback()
            continue
        savepoint.commit()
        db.execute(
            update(CampaignRun)
            .where(CampaignRun.id == run.id)
            .values(attempts_planned=CampaignRun.attempts_planned + count)
        )
        return True
    log.error("The repetitions of attempt %s couldn't be planned", attempt.id)
    return False


def counts(db: Session, row: ReproducibilityMeasurement) -> tuple[int, int]:
    """Step 3 and 4: the attempts of the finding's test that this run has evaluated, and how many
    of them succeeded. The same attempts the severity rating counts (FR-7.1), inside one run: an
    attempt whose verdict is still waiting for the LLM judge isn't counted yet."""
    evaluated = set(
        db.scalars(
            select(Attempt.id)
            .join(DetectionVerdict, DetectionVerdict.attempt_id == Attempt.id)
            .where(
                Attempt.campaign_run_id == row.campaign_run_id,
                Attempt.test_code == row.test_code,
                DetectionVerdict.outcome.in_((Outcome.MET, Outcome.NOT_MET)),
            )
        )
    )
    mine = set(
        db.scalars(
            select(Evidence.attempt_id).where(
                Evidence.finding_id == row.finding_id, Evidence.kind == EvidenceKind.ATTEMPT
            )
        )
    )
    return len(evaluated), len(evaluated & mine)


def _count(
    db: Session, run: CampaignRun, row: ReproducibilityMeasurement, *, ended: bool = False
) -> dict | None:
    """Steps 3-5: the attempts counted again, and the measurement ended when there is nothing
    left to wait for."""
    row = _lock(db, row)
    if row is None or row.status != MeasurementStatus.MEASURING:
        db.rollback()
        return None
    attempts, successes = counts(db, row)
    row.attempts, row.successes = attempts, successes
    row.rate = (
        (Decimal(successes) / Decimal(attempts)).quantize(Decimal("0.001")) if attempts else None
    )
    # The measurement ends when no attempt of its test is left to send, because every attempt of
    # the test counts towards the score (FR-7.1 counts the same ones). Until then it stays open,
    # so the finding is rated once, on what the whole run tried.
    if ended or not _waiting(db, run, row.test_code):
        complete = attempts >= row.wanted
        reason = "" if complete else row.reason or (RUN_ENDED if ended else NOTHING_LEFT)
        _end(
            db,
            run,
            row,
            MeasurementStatus.COMPLETE if complete else MeasurementStatus.INCOMPLETE,
            reason,
        )
    db.commit()
    return live_data(row)


def _end(
    db: Session, run: CampaignRun, row: ReproducibilityMeasurement, status: str, reason: str
) -> None:
    """Step 5: the score is stored with the finding by the rating, which the new score triggers
    (UC-7.1's own trigger), and the monitor shows it."""
    from app.modules.m07_risk import rating

    row.status, row.reason, row.finished_at = status, reason, now()
    finding = db.get(Finding, row.finding_id)
    if finding is None:
        return
    db.commit()
    rating.rate(db, finding, run=run)


def live_data(row: ReproducibilityMeasurement) -> dict:
    """What the live campaign monitor shows with an attempt (UC-5.6 step 3)."""
    return {
        "repetitions": {
            "attempts": row.attempts,
            "successes": row.successes,
            "wanted": row.wanted,
            "rate": str(row.rate) if row.rate is not None else None,
            "status": row.status,
            "reason": row.reason,
        }
    }


# ---------------------------------------------------------------- reading it


@dataclass(frozen=True)
class Score:
    """What a finding's reproducibility is based on (Screens 37-39)."""

    attempts: int
    successes: int
    wanted: int
    status: str
    reason: str

    def label(self) -> str:
        """ "4 of 5 attempts", as the pages show it beside the score."""
        return f"{self.successes} of {self.attempts} attempts"


def latest(db: Session, finding_ids: set[uuid.UUID]) -> dict[uuid.UUID, Score]:
    """The last measurement of each of these findings, newest first per finding."""
    if not finding_ids:
        return {}
    rows = db.scalars(
        select(ReproducibilityMeasurement)
        .where(ReproducibilityMeasurement.finding_id.in_(finding_ids))
        .order_by(ReproducibilityMeasurement.started_at)
    )
    return {
        row.finding_id: Score(
            attempts=row.attempts,
            successes=row.successes,
            wanted=row.wanted,
            status=row.status,
            reason=row.reason,
        )
        for row in rows
    }


# ---------------------------------------------------------------- the attempts behind the score


@dataclass(frozen=True)
class Counted:
    """One attempt behind a finding's reproducibility score (FR-6.4, M6), as Screen 40 lists it."""

    attempt_id: uuid.UUID
    run_id: uuid.UUID
    attempt_no: int
    sent_at: datetime | None
    outcome: str  # the verdict of UC-6.1: met or not_met
    mine: bool  # its evidence belongs to the finding, which makes it a success
    repeat: bool  # sent again to measure the finding (step 1), not planned by the campaign


def counted(db: Session, finding: Finding) -> list[Counted]:
    """The attempts a finding's reproducibility score counts, in the order they were sent: every
    evaluated attempt of the finding's test against its target, in any of its campaign runs, whose
    verdict is met or not met (UC-6.1 step 5). An attempt the LLM judge hasn't answered yet isn't
    counted. A success is an attempt whose evidence belongs to the finding.

    The severity rating counts exactly these attempts (m07_risk/rating.py, FR-7.1, M7), so the score
    a finding carries and the attempts Screen 40 lists under it are always the same ones."""
    rows = db.execute(
        select(
            Attempt.id,
            Attempt.campaign_run_id,
            Attempt.attempt_no,
            Attempt.sent_at,
            DetectionVerdict.outcome,
            Attempt.repeat_of_id,
        )
        .join(CampaignRun, CampaignRun.id == Attempt.campaign_run_id)
        .join(DetectionVerdict, DetectionVerdict.attempt_id == Attempt.id)
        .where(
            Attempt.organization_id == finding.organization_id,
            Attempt.test_code == finding.test_code,
            CampaignRun.target_id == finding.target_id,
            DetectionVerdict.outcome.in_((Outcome.MET, Outcome.NOT_MET)),
        )
        .order_by(Attempt.sent_at, Attempt.attempt_no)
    ).all()
    mine = set(
        db.scalars(
            select(Evidence.attempt_id).where(
                Evidence.finding_id == finding.id, Evidence.kind == EvidenceKind.ATTEMPT
            )
        )
    )
    return [
        Counted(
            attempt_id=row.id,
            run_id=row.campaign_run_id,
            attempt_no=row.attempt_no,
            sent_at=row.sent_at,
            outcome=str(row.outcome),
            mine=row.id in mine,
            repeat=row.repeat_of_id is not None,
        )
        for row in rows
    ]
