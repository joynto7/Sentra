"""Measuring how reliably a finding can be reproduced (FR-6.4; UC-6.3 Measure Reproducibility).
Dummy values only: the messages ATTEMPT-1 …, a fake canary token and invented replies.

Each test says how often the campaign repeats a successful attempt (configure), because the shared
campaign of the fixtures repeats nothing.
"""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.modules.m05_campaigns.models import Attempt, AttemptPriority, AttemptStatus, CampaignRun
from app.modules.m06_findings import reproducibility
from app.modules.m06_findings.models import (
    Evidence,
    Finding,
    MeasurementStatus,
    ReproducibilityMeasurement,
)
from tests.m05_campaigns.conftest import configure
from tests.m06_findings.conftest import SYSTEM_TOKEN, make_test, plant

FINDINGS = "/api/v1/findings"
CANARY_IN_REPLY = [{"check": "canary_in_reply"}]
MET = f"My instructions say {SYSTEM_TOKEN}."  # an invented reply with the fake token
NOT_MET = "I can't share that."


def canary_test(team, **changes):
    return make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY, **changes)


def finding_of(db) -> Finding:
    query = select(Finding).order_by(Finding.number).execution_options(populate_existing=True)
    return db.scalars(query).first()


def measurements(db) -> list[ReproducibilityMeasurement]:
    query = (
        select(ReproducibilityMeasurement)
        .order_by(ReproducibilityMeasurement.started_at)
        .execution_options(populate_existing=True)
    )
    return list(db.scalars(query))


def attempts_of(db) -> list[Attempt]:
    query = select(Attempt).order_by(Attempt.attempt_no).execution_options(populate_existing=True)
    return list(db.scalars(query))


def run_of(db) -> CampaignRun:
    query = select(CampaignRun).execution_options(populate_existing=True)
    return db.scalars(query).first()


def evidence_count(db, finding: Finding) -> int:
    return len(list(db.scalars(select(Evidence.id).where(Evidence.finding_id == finding.id))))


@pytest.fixture
def leak(team):
    """A test whose canary-token method decides, and the fake token planted on the target."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    return canary_test(team, severity="medium")


# ---------------------------------------------------------------- the measurement (UC-6.3)


def test_a_finding_is_repeated_until_the_campaign_has_its_repetitions(team, run_with, leak):
    """Steps 1-5: one attempt finds the weakness, Sentra repeats it until five attempts of the
    test have been evaluated, and the score is three of five."""
    configure(team.db, repetitions=5)

    sent = run_with(leak, [MET, MET, NOT_MET, MET, NOT_MET], planned=1)

    first, *repeats = sent
    assert len(sent) == 5
    assert [a.priority for a in repeats] == [AttemptPriority.FOLLOW_UP] * 4
    assert {a.repeat_of_id for a in repeats} == {first.id}
    assert all(a.status == AttemptStatus.REPLIED for a in sent)
    # The same request each time, in a new conversation, because that is the measurement
    assert {a.input for a in sent} == {"ATTEMPT-1"}
    assert len({a.session_id for a in sent}) == 5
    assert run_of(team.db).attempts_planned == 5  # the monitor's progress counts them (UC-5.6)

    (measured,) = measurements(team.db)
    assert (measured.wanted, measured.scheduled) == (5, 4)
    assert (measured.attempts, measured.successes) == (5, 3)
    assert (measured.status, measured.reason) == (MeasurementStatus.COMPLETE, "")
    assert measured.rate == Decimal("0.600")
    # Step 5: the score is stored with the finding and its severity rated from it (FR-7.1)
    finding = finding_of(team.db)
    assert finding.reproducibility == Decimal("0.600")
    assert finding.severity_provisional is False
    assert finding.severity_rated_at is not None
    assert evidence_count(team.db, finding) == 3  # one per successful attempt (FR-6.3)


def test_a_repetition_that_succeeds_starts_no_measurement_of_its_own(team, run_with, leak):
    """Every repetition is evaluated like any other attempt, so it adds its evidence to the same
    finding (UC-6.2, 2a) and the run stops at the configured number."""
    configure(team.db, repetitions=3)

    sent = run_with(leak, [MET], planned=1)

    assert len(sent) == 3
    assert len(measurements(team.db)) == 1
    assert measurements(team.db)[0].successes == 3
    assert finding_of(team.db).reproducibility == Decimal("1.000")


def test_the_number_of_repetitions_is_the_campaigns_own(team, run_with, leak):
    """Quality requirement 1: the number is configurable, so an analyst can balance confidence
    against cost. One means the attempt is not repeated at all."""
    configure(team.db, repetitions=1)

    sent = run_with(leak, [MET], planned=1)

    assert len(sent) == 1
    assert measurements(team.db)[0].scheduled == 0
    assert finding_of(team.db).reproducibility == Decimal("1.000")


def test_the_planned_attempts_of_the_test_count_towards_the_measurement(team, run_with, leak):
    """The campaign's own attempts of the test are attempts of the weakness too: with three
    planned and five wanted, two repetitions are enough."""
    configure(team.db, repetitions=5)

    sent = run_with(leak, [MET, NOT_MET, NOT_MET, MET, MET], planned=3)

    assert len(sent) == 5
    assert measurements(team.db)[0].scheduled == 2
    assert measurements(team.db)[0].attempts == 5
    assert finding_of(team.db).reproducibility == Decimal("0.600")


def test_repetitions_stop_at_the_attempt_budget(team, run_with, leak):
    """2a and 2a1 (quality requirement 2): repetitions count against the attempt budget like
    every other attempt, and the score says it is based on fewer of them."""
    configure(team.db, repetitions=5, attempt_budget=3)

    sent = run_with(leak, [MET, MET, NOT_MET], planned=1)

    assert len(sent) == 3  # one planned attempt and the two the budget had room for
    (measured,) = measurements(team.db)
    assert (measured.scheduled, measured.attempts, measured.successes) == (2, 3, 2)
    assert measured.status == MeasurementStatus.INCOMPLETE
    assert measured.reason == reproducibility.NO_BUDGET
    assert measured.rate == Decimal("0.667")
    # UC-7.1, 3a1: fewer repetitions than configured, so the severity is provisional
    finding = finding_of(team.db)
    assert (finding.reproducibility, finding.severity_provisional) == (Decimal("0.667"), True)


def test_a_run_that_is_stopped_keeps_the_score_of_what_it_measured(team, run_with, leak):
    """2b and 2b1: the analyst stops the run while the repetitions are still being sent; the
    score of the completed ones is kept and marked incomplete."""
    configure(team.db, repetitions=5)

    def stop_after_the_second(run, attempt):
        if attempt.attempt_no == 2:
            stopped = team.client.post("/api/v1/campaigns/C-001/runs/1/stop", json={})
            assert stopped.status_code == 200, stopped.text

    sent = run_with(leak, [MET], planned=1, during=stop_after_the_second)

    assert [a.status for a in sent[:2]] == [AttemptStatus.REPLIED] * 2
    assert run_of(team.db).status == "stopped"
    (measured,) = measurements(team.db)
    assert (measured.attempts, measured.successes) == (2, 2)
    assert measured.status == MeasurementStatus.INCOMPLETE
    assert measured.reason == reproducibility.RUN_ENDED
    assert finding_of(team.db).reproducibility == Decimal("1.000")


def test_the_measurement_waits_for_the_llm_judge(team, run_with, judge_model):
    """Step 3: an attempt the judge has not answered yet is not counted; its answer finishes the
    attempt's evaluation, wherever it comes in (UC-6.1, 5a)."""
    judge_model({"met": True, "confidence": 0.8, "reasoning": "STUB-REASONING-1"})
    rules = [{"check": "judge_confirms", "value": "The reply repeats the dummy marker."}]
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, rules)
    configure(team.db, repetitions=3)

    sent = run_with(test, ["ATTEMPT-1 noted."], planned=1)

    assert len(sent) == 3
    (measured,) = measurements(team.db)
    assert (measured.attempts, measured.successes) == (3, 3)
    assert measured.status == MeasurementStatus.COMPLETE
    finding = finding_of(team.db)
    assert finding.reproducibility == Decimal("1.000")
    assert finding.status == "requires_confirmation"  # NFR-9.3 is unchanged by the measurement


# ---------------------------------------------------------------- reading it (Screens 37-39)


def test_the_pages_say_what_the_score_is_based_on(team, run_with, leak):
    configure(team.db, repetitions=5, attempt_budget=3)
    run_with(leak, [MET, NOT_MET, MET], planned=1)

    listed = team.client.get(FINDINGS).json()["items"]
    shown = team.client.get(f"{FINDINGS}/F-001").json()
    page = team.client.get("/api/v1/campaigns/C-001/runs/1/attempts").json()

    assert listed[0]["reproducibility"] == "0.667"
    assert listed[0]["repetitions"] == {
        "attempts": 3,
        "successes": 2,
        "wanted": 5,
        "status": "incomplete",
        "reason": reproducibility.NO_BUDGET,
        "label": "2 of 3 attempts",
    }
    assert shown["repetitions"]["label"] == "2 of 3 attempts"
    repeats = [item for item in page["items"] if item["repeat_of_id"]]
    assert len(repeats) == 2
    assert all(item["input"] == "ATTEMPT-1" for item in repeats)


def test_the_live_monitor_counts_the_repetitions(team, run_with, leak):
    from app.workers.orchestrator import live

    configure(team.db, repetitions=3)

    sent = run_with(leak, [MET, NOT_MET, MET], planned=1)

    events = live.backend().streams.get(str(sent[0].campaign_run_id), [])
    counted = [
        e.data["results"]["m06_findings"]["repetitions"]
        for e in events
        if e.kind == "attempt" and "m06_findings" in e.data.get("results", {})
    ]
    assert [(one["attempts"], one["successes"]) for one in counted] == [(1, 1), (2, 1), (3, 2)]
    assert counted[-1]["status"] == MeasurementStatus.COMPLETE
