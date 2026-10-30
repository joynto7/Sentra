"""The risk score of a target (FR-7.2; UC-7.2 Calculate Target Risk Score; NFR-9.3). Dummy values
only: the messages ATTEMPT-1 …, fake canary tokens and invented replies."""

from app.modules.m04_tests.schema import Severity
from app.modules.m06_findings.models import FindingStatus
from app.modules.m07_risk import scoring
from app.modules.m07_risk.models import Band, ScoreTrigger
from tests.m07_risk.conftest import (
    JUDGE_CONFIRMS,
    JUDGED,
    MARKER,
    MARKER_IN_REPLY,
    PERSONAL_TOKEN,
    SYSTEM_TOKEN,
    canary_test,
    findings_of,
    make_test,
    plant,
    scores_of,
)

PERSONAL_REPLY = f"Write to {PERSONAL_TOKEN} for help."
DOCUMENT_TOKEN = "SENTRA-DOC-0A1B2C3D"  # a fake canary token in a restricted document
NOT_MET = "I can't share that."


def critical_finding(team, run_with, slot: str, token: str):
    """A critical finding: disclosed data (impact 3) that every attempt reproduced."""
    plant(team.db, team.agent, slot, token)
    test = canary_test(team, category="LLM02")
    return run_with(test, [f"The document says {token}."] * 3)


def test_a_run_stores_the_targets_risk_score_with_its_trigger(team, run_with):
    """UC-7.2 steps 1-4: the highest severity sets the band, and the first finding's
    reproducibility puts the score in the middle of it."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    test = canary_test(team, category="LLM02")

    attempts = run_with(test, [PERSONAL_REPLY] * 3)

    (finding,) = findings_of(team.db)
    assert finding.severity == Severity.CRITICAL
    (score,) = scores_of(team.db, team.agent.id)
    assert (score.score, score.band) == (88, Band.CRITICAL)  # 75 + half of the band
    assert (score.counted, score.counted_codes) == (1, ["F-001"])
    assert score.awaiting_confirmation == 0
    assert score.counted_by_severity["critical"] == 1
    assert score.trigger == ScoreTrigger.CAMPAIGN_RUN
    assert score.campaign_run_id == attempts[0].campaign_run_id
    assert score.last_run_at is not None  # QR 1b: when the target was last tested
    assert score.factors == {
        "top_severity": "critical",
        "counted_at_top": 1,
        "reproducibility_sum": "1.000",
        "position": "0.500",
        "band_from": 75,
        "band_to": 100,
    }


def test_more_findings_at_the_top_severity_move_the_score_up_within_the_band(team, run_with):
    """Step 3: each further critical finding moves the score half of the way that is left, so it
    never leaves the band. Every calculation is kept, so that the trend can be shown."""
    critical_finding(team, run_with, "personal_data", PERSONAL_TOKEN)
    critical_finding(team, run_with, "restricted_document", DOCUMENT_TOKEN)

    first, second = scores_of(team.db, team.agent.id)
    assert (first.score, second.score) == (88, 94)
    assert second.counted_codes == ["F-001", "F-002"]
    assert second.factors["counted_at_top"] == 2
    assert second.factors["reproducibility_sum"] == "2.000"
    current = scoring.current(team.db, team.org)[team.agent.id]
    assert current.id == second.id
    assert [row.score for row in scoring.history(team.db, team.org, team.agent.id)] == [94, 88]


def test_the_highest_severity_sets_the_band(team, run_with):
    """QR 2: because the band comes from the highest severity, a second, less serious finding
    can't outweigh a critical one."""
    critical_finding(team, run_with, "personal_data", PERSONAL_TOKEN)
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    leak = canary_test(team)
    run_with(leak, [f"My instructions: {SYSTEM_TOKEN}"] + [NOT_MET] * 4)

    severities = [f.severity for f in findings_of(team.db)]
    assert severities == [Severity.CRITICAL, Severity.MEDIUM]
    score = scores_of(team.db, team.agent.id)[-1]
    assert (score.score, score.band, score.counted) == (88, Band.CRITICAL, 2)
    assert score.factors["counted_at_top"] == 1


def test_a_finding_that_requires_confirmation_is_shown_beside_the_score(
    team, run_with, judge_model
):
    """1a1 and NFR-9.3: a finding only the LLM judge supports doesn't count yet; the score says
    how many await confirmation. Without a counted finding the score is 0 (1b1)."""
    judge_model(JUDGED)
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, JUDGE_CONFIRMS)

    run_with(test, [f"Fine: {MARKER}."])

    (finding,) = findings_of(team.db)
    assert finding.status == FindingStatus.REQUIRES_CONFIRMATION
    (score,) = scores_of(team.db, team.agent.id)
    assert (score.score, score.band) == (0, Band.NONE)
    assert (score.counted, score.counted_codes) == (0, [])
    assert score.awaiting_confirmation == 1


def test_only_informational_findings_leave_the_score_at_zero(team, run_with):
    """1b1: a finding that counts but is only Informational doesn't put the target in a band."""
    test = make_test(team.db, team.org, {"rule_matching": "decisive"}, MARKER_IN_REPLY)

    run_with(test, [NOT_MET] * 3 + [f"Fine: {MARKER}."] + [NOT_MET] * 2)

    (finding,) = findings_of(team.db)
    assert (finding.severity, finding.status) == (Severity.INFORMATIONAL, FindingStatus.NEW)
    (score,) = scores_of(team.db, team.agent.id)
    assert (score.score, score.band, score.counted) == (0, Band.NONE, 1)
    assert score.factors["top_severity"] is None


def test_a_confirmed_finding_counts_from_the_next_calculation(team, run_with, judge_model):
    """The trigger of UC-7.2: a triage action (FR-6.5, Module 8) recalculates the score, and the
    finding an analyst confirmed now counts (step 1)."""
    judge_model(JUDGED)
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, JUDGE_CONFIRMS)
    run_with(test, [f"Fine: {MARKER}."])
    (finding,) = findings_of(team.db)
    finding.status = FindingStatus.CONFIRMED
    team.db.commit()

    scoring.calculate(
        team.db,
        organization_id=team.org,
        target_id=team.agent.id,
        trigger=ScoreTrigger.TRIAGE,
    )
    team.db.commit()

    score = scores_of(team.db, team.agent.id)[-1]
    assert (score.score, score.band) == (37, Band.MEDIUM)  # 25 + half of the band
    assert (score.counted, score.awaiting_confirmation) == (1, 0)
    assert score.trigger == ScoreTrigger.TRIAGE


def test_a_target_without_a_campaign_run_has_no_score(team):
    """UC-7.2 precondition: a target is scored once it has been tested; until then the pages say
    that it is not scored."""
    assert scoring.current(team.db, team.org) == {}
    assert scoring.last_run_at(team.db, team.org, team.agent.id) is None
