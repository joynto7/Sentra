"""FR-8.4 and FR-8.5 (M8): UC-8.6 Retest Remediation and UC-8.7 Compare Before and After.

When every fix of an approved proposal is in effect, Sentra repeats the attempts that proved the
finding — as often as the measurement its severity is based on repeated them — sends the target's
requests of normal use beside them, and compares before with after. A finding is marked as fixed
and verified only when every repeated attempt was evaluated and none of them succeeded.

Nothing leaves the tests: the retest run goes through the real run engine with a stub sender, the
requests of normal use go through the Target Connector's mock transport, and the finding, its
evidence and the policy come from the fixtures with their dummy values.
"""

import httpx
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m02_targets.models import TargetBenignRequest
from app.modules.m05_campaigns import lifecycle
from app.modules.m05_campaigns.models import (
    Attempt,
    CampaignRun,
    EndReason,
    RunStatus,
    RunTrigger,
    RunType,
)
from app.modules.m06_findings.models import FindingStatus
from app.modules.m07_risk.models import RiskScore
from app.modules.m08_remediation import policies
from app.modules.m08_remediation.benign import GENERIC
from app.modules.m08_remediation.models import (
    BenignOutcome,
    BenignReview,
    Remediation,
    RemediationStatus,
    Retest,
    RetestBenignCheck,
    RetestStatus,
    RetestVerdict,
)
from app.modules.m09_reporting.models import Notification
from app.workers.connector import connector
from tests.m01_users.test_organizations import log_in
from tests.m05_campaigns.conftest import StubSender, reply
from tests.m08_remediation.conftest import API, REVEALED, retest_engine
from tests.m08_remediation.test_policies import TERMS, deploy, ready
from tests.m08_remediation.test_rollback import confirm, confirm_password, roll_back
from tests.m08_remediation.test_shield import DEVELOPER, code_of

REFUSED = "I can't share my instructions. Can I help you with your account instead?"
NORMAL_USE = [
    "What is the status of my last order?",
    "Can you explain your refund rules in two sentences?",
    "Thank you, that is all I needed.",
]


def sending(monkeypatch, *answers: str) -> StubSender:
    """The stub sender of the retest run: each attempt gets the next answer, the last one again
    when they run out."""
    return retest_engine(
        monkeypatch,
        StubSender(lambda attempt: reply(answers[min(attempt.attempt_no, len(answers)) - 1])),
    )


def target_answers(monkeypatch, *bodies) -> list[httpx.Request]:
    """How the target answers the requests of normal use: a text, or an httpx.Response of its
    own (a refusal of the gateway, for instance). Returns the requests it received."""
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = bodies[min(len(seen), len(bodies)) - 1]
        if isinstance(body, httpx.Response):
            return body
        return httpx.Response(200, json={"choices": [{"message": {"content": body}}]})

    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(answer))
    return seen


def normal_use(team, *texts: str) -> None:
    """The target's own Benign Request Set (Screen 22), as its owner wrote it."""
    for position, text in enumerate(texts, start=1):
        team.db.add(TargetBenignRequest(target_id=team.agent.id, position=position, text=text))
    team.db.commit()


def retest_now(team, finding, model, monkeypatch, *answers: str) -> StubSender:
    """Everything up to the moment the gateway confirms the version that carries the fixes: the
    retest starts by itself then (UC-8.4 step 6), with `answers` as the target's replies."""
    credential = ready(team, finding, model, monkeypatch)
    assert deploy(team, finding, terms=TERMS).status_code == 201
    sender = sending(monkeypatch, *(answers or (REFUSED,)))
    target_answers(monkeypatch, "Your last order was delivered on Tuesday.")
    confirm(team, credential, 1, 4)
    team.db.expire_all()
    return sender


def retest_of(team) -> Retest | None:
    return team.db.scalars(
        select(Retest).order_by(Retest.number.desc()).execution_options(populate_existing=True)
    ).first()


def run_of(team, retest: Retest) -> CampaignRun:
    return team.db.get(CampaignRun, retest.campaign_run_id)


def attempts_of(team, run: CampaignRun) -> list[Attempt]:
    return list(
        team.db.scalars(
            select(Attempt)
            .where(Attempt.campaign_run_id == run.id)
            .order_by(Attempt.attempt_no)
            .execution_options(populate_existing=True)
        )
    )


def checks_of(team) -> list[RetestBenignCheck]:
    return list(
        team.db.scalars(
            select(RetestBenignCheck)
            .order_by(RetestBenignCheck.position)
            .execution_options(populate_existing=True)
        )
    )


def remediation_of(team) -> Remediation:
    return team.db.scalars(
        select(Remediation)
        .order_by(Remediation.version.desc())
        .execution_options(populate_existing=True)
    ).first()


def actions(team) -> list[str]:
    return [
        one.action for one in team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq))
    ]


def scores(team) -> list[RiskScore]:
    return list(
        team.db.scalars(
            select(RiskScore)
            .order_by(RiskScore.calculated_at, RiskScore.id)
            .execution_options(populate_existing=True)
        )
    )


# ---------------------------------------------------------------- steps 1 to 3: what it sends


def test_a_confirmed_deployment_starts_the_retest_with_the_same_requests(
    team, confirmed, model, monkeypatch
):
    """Steps 1-3: the retest repeats the attempt that proved the finding, as often as the
    campaign repeated a successful one, as a run of its own without a campaign."""
    before = attempts_of(team, team.db.scalars(select(CampaignRun)).first())

    retest_now(team, confirmed, model, monkeypatch)

    retest = retest_of(team)
    assert retest is not None
    assert (retest.test_code, retest.repetitions) == (confirmed.test_code, 5)
    assert retest.replayed == [str(before[0].id)]
    assert retest.policy_version == 1  # what it verifies (UC-8.7 step 4)
    run = run_of(team, retest)
    assert (run.run_type, run.trigger, run.campaign_id) == (
        RunType.RETEST,
        RunTrigger.REMEDIATION,
        None,
    )
    assert run.launched_by_id is None  # Sentra starts a retest, not a person
    again = attempts_of(team, run)
    assert len(again) == 5 and {one.input for one in again} == {before[0].input}
    assert [one.test_code for one in again] == [confirmed.test_code] * 5
    assert len({one.session_id for one in again}) == 5  # each one in its own conversation
    # the planned attempts, plus room for the retries of a target that can't be reached (NFR-2.3)
    assert run.attempt_budget == 5 + len(get_settings().run_retry_delays)


def test_the_figures_before_the_fix_are_frozen_when_the_retest_starts(
    team, confirmed, model, monkeypatch
):
    """UC-8.7 step 2: what the measurement before the fix found, kept with the retest so that the
    comparison a person reads never moves under them."""
    retest_now(team, confirmed, model, monkeypatch)

    retest = retest_of(team)
    # The measurement repeated its successful attempt five times (FR-6.4, the fixture's campaign)
    assert (retest.before_successes, retest.before_attempts) == (5, 5)
    assert retest.risk_before == scores(team)[0].score
    assert retest.risk_band_before == scores(team)[0].band


def test_no_repeated_attempt_succeeds_so_the_finding_is_fixed_and_verified(
    team, confirmed, model, monkeypatch
):
    """Steps 4-6: the comparison is stored, the finding is closed, the proposal is effective, the
    risk score is calculated again and the people who waited are told."""
    sender = retest_now(team, confirmed, model, monkeypatch)

    assert sender.sent == ["ATTEMPT-1"] * 5
    retest = retest_of(team)
    assert (retest.status, retest.verdict) == (RetestStatus.COMPLETED, RetestVerdict.CLOSED)
    assert (retest.after_successes, retest.after_attempts) == (0, 5)
    assert team.db.get(CampaignRun, retest.campaign_run_id).status == RunStatus.COMPLETED
    team.db.refresh(confirmed)
    assert confirmed.status == FindingStatus.FIXED_AND_VERIFIED
    assert remediation_of(team).status == RemediationStatus.EFFECTIVE
    assert "no repeated attempt succeeded after it (0 of 5)" in retest.conclusion
    assert "5 of 5" in retest.conclusion
    assert scores(team)[-1].trigger == "remediation" and retest.risk_after is not None
    assert actions(team)[-1] == "retest.finished"
    finished = team.db.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "retest.finished")
    ).first()
    assert finished.details["after"] == "0 of 5" and finished.details["before"] == "5 of 5"
    told = team.db.scalars(
        select(Notification).where(Notification.event == "retest_finished")
    ).all()
    assert told and all(one.link == f"/remediation/{confirmed.code}/retest" for one in told)


def test_an_attempt_that_still_succeeds_keeps_the_finding_open(team, confirmed, model, monkeypatch):
    """5a and 5a1: the weakness is not closed, so the finding stays open and the proposal is
    ineffective; the developer can ask for a revision or roll the policy back."""
    retest_now(team, confirmed, model, monkeypatch, REFUSED, REVEALED)

    retest = retest_of(team)
    assert retest.verdict == RetestVerdict.STILL_OPEN
    assert (retest.after_successes, retest.after_attempts) == (4, 5)
    team.db.refresh(confirmed)
    assert confirmed.status == FindingStatus.CONFIRMED
    assert remediation_of(team).status == RemediationStatus.INEFFECTIVE
    assert "The weakness is still there" in retest.conclusion
    assert f"{confirmed.code} stays open" in retest.conclusion


def test_an_incomplete_measurement_closes_nothing(team, confirmed, model, monkeypatch):
    """Quality requirement 5 and the failed end condition: a run that ended before every repeated
    attempt was evaluated leaves the finding as it was, and the retest says so."""

    def stop_after_two(context, attempt):
        if attempt.attempt_no == 2:
            run = lifecycle.lock(team.db, context.run.id)
            lifecycle.end(
                team.db,
                run,
                RunStatus.STOPPED,
                EndReason.STOPPED_BY_USER,
                "Stopped by the test after two attempts.",
            )
            team.db.commit()

    credential = ready(team, confirmed, model, monkeypatch)
    assert deploy(team, confirmed, terms=TERMS).status_code == 201
    retest_engine(monkeypatch, StubSender(during=stop_after_two))
    target_answers(monkeypatch, "Your last order was delivered on Tuesday.")
    confirm(team, credential, 1, 4)
    team.db.expire_all()

    retest = retest_of(team)
    assert retest.verdict == RetestVerdict.INCONCLUSIVE
    assert (retest.after_successes, retest.after_attempts) == (0, 2)
    team.db.refresh(confirmed)
    assert confirmed.status == FindingStatus.CONFIRMED
    assert remediation_of(team).status == RemediationStatus.APPLYING
    assert "doesn't say whether the weakness is closed" in retest.conclusion
    assert retest.message == "3 of 5 repeated attempts weren't evaluated."


# ---------------------------------------------------------------- step 1 and step 4: normal use


def test_the_targets_own_requests_of_normal_use_are_sent_and_judged(
    team, confirmed, model, monkeypatch
):
    """Step 1 and step 4: every example of the target's set is sent once, and what the policy did
    with it is read from the answer — its refusal, or the mask it leaves behind."""
    normal_use(team, *NORMAL_USE)
    credential = ready(team, confirmed, model, monkeypatch)
    assert deploy(team, confirmed, terms=TERMS).status_code == 201
    sending(monkeypatch, REFUSED)
    seen = target_answers(
        monkeypatch,
        "Your last order was delivered on Tuesday.",
        httpx.Response(403, json={"error": policies.GUARDRAIL_MESSAGE}),
        f"Our refund rules {policies.MASK} apply within 30 days.",
    )
    confirm(team, credential, 1, 4)
    team.db.expire_all()

    retest = retest_of(team)
    assert len(seen) == 3  # one request per example, in its own conversation
    checks = checks_of(team)
    assert [one.text for one in checks] == list(NORMAL_USE)
    assert [one.outcome for one in checks] == [
        BenignOutcome.ANSWERED,
        BenignOutcome.BLOCKED,
        BenignOutcome.CHANGED,
    ]
    assert checks[1].status_code == 403 and "refused the request" in checks[1].what_happened
    assert "removed something from the answer" in checks[2].what_happened
    assert checks[0].reply == "Your last order was delivered on Tuesday."
    assert (retest.benign_total, retest.benign_blocked, retest.benign_changed) == (3, 1, 1)
    assert retest.benign_generic is False
    assert "Of 3 requests of normal use, 1 was refused and 1 was changed" in retest.conclusion


def test_without_a_set_of_its_own_a_generic_one_is_used_and_said_to_be_less_reliable(
    team, confirmed, model, monkeypatch
):
    """1a1: Sentra sends a generic set of ordinary requests and marks the comparison."""
    retest_now(team, confirmed, model, monkeypatch)

    retest = retest_of(team)
    assert retest.benign_generic is True
    assert retest.benign_total == len(GENERIC)
    assert [one.text for one in checks_of(team)] == list(GENERIC)
    assert "no Benign Request Set of its own" in retest.conclusion


def test_a_target_that_cannot_be_reached_stops_the_requests_of_normal_use(
    team, confirmed, model, monkeypatch
):
    """The retest keeps what it measured: a target in trouble is not asked 50 times."""
    normal_use(team, *NORMAL_USE)
    credential = ready(team, confirmed, model, monkeypatch)
    assert deploy(team, confirmed, terms=TERMS).status_code == 201
    sending(monkeypatch, REFUSED)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(refuse))
    confirm(team, credential, 1, 4)
    team.db.expire_all()

    retest = retest_of(team)
    assert retest.benign_total == 1 and retest.benign_failed == 1
    assert checks_of(team)[0].outcome == BenignOutcome.FAILED
    assert retest.verdict == RetestVerdict.CLOSED  # the attack half was measured in full


# ---------------------------------------------------------------- UC-8.7: what a person reads


def test_the_comparison_page_shows_before_and_after_with_every_figure_in_words(
    team, confirmed, model, monkeypatch
):
    """UC-8.7 steps 2-4 and its quality requirements: rates over repeated attempts, every chart
    also as a figure in words (NFR-4.3), and the conclusion in plain language (NFR-4.2)."""
    normal_use(team, *NORMAL_USE)
    retest_now(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    page = team.client.get(f"{API}/{confirmed.code}/retest")

    assert page.status_code == 200, page.text
    body = page.json()
    assert body["verdict_label"] == "Fixed and Verified" and body["status"] == "completed"
    assert body["finding"]["code"] == confirmed.code
    attack = body["figures"]["attack_success"]
    assert (attack["before_words"], attack["after_words"]) == (
        "5 of 5 attempts (100 %)",
        "0 of 5 attempts (0 %)",
    )
    assert (attack["before_rate"], attack["after_rate"]) == (100.0, 0.0)
    assert body["figures"]["normal_use"]["affected_words"] == "0 of 3 requests (0 %)"
    assert body["figures"]["risk_score"]["before"] is not None
    assert body["policy_version"] == 1 and body["repetitions"] == 5
    assert body["attempts_repeated"] == 1 and body["test_code"] == confirmed.test_code
    assert body["run_code"].startswith("R-")
    assert len(body["benign_checks"]) == 3
    assert body["conclusion"] == retest_of(team).conclusion


def test_a_person_says_whether_an_answer_the_fix_changed_still_does_its_job(
    team, confirmed, model, monkeypatch
):
    """UC-8.7 step 3: "Looks fine" is kept with the example and with the person who said it."""
    normal_use(team, *NORMAL_USE)
    retest_now(team, confirmed, model, monkeypatch)
    check = checks_of(team)[0]

    log_in(team.client, DEVELOPER)
    said = team.client.post(
        f"{API}/{confirmed.code}/retest/benign/{check.id}", json={"judgement": "fine"}
    )

    assert said.status_code == 200, said.text
    first = said.json()["benign_checks"][0]
    assert (first["review"], first["review_label"]) == (BenignReview.FINE, "Looks fine")
    assert first["reviewed_by"] == "Maya" and first["reviewed_at"]
    refused = team.client.post(
        f"{API}/{confirmed.code}/retest/benign/{check.id}", json={"judgement": "maybe"}
    )
    assert refused.status_code == 422


def test_the_remediation_pages_say_that_a_finding_was_retested(team, confirmed, model, monkeypatch):
    """Screens 45 and 46: the newest retest of a finding, and its "Retesting" count."""
    retest_now(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    listed = team.client.get(API).json()
    page = team.client.get(f"{API}/{confirmed.code}").json()

    row = next(one for one in listed["rows"] if one["finding"]["code"] == confirmed.code)
    assert row["retest"]["verdict_label"] == "Fixed and Verified"
    assert row["retest"]["running"] is False and listed["retesting"] == 0
    assert page["retests"][0]["number"] == 1 and page["retests"][0]["version"] == 1
    assert page["in_effect"] == "Every fix of this proposal is in effect."


# ---------------------------------------------------------------- UC-8.8 and starting it again


def test_a_rollback_marks_the_comparison_it_proved_as_out_of_date(
    team, confirmed, model, monkeypatch
):
    """UC-8.8 step 5 with FR-8.5: what the removed version had proved is not in the traffic any
    more, so the finding is open again and its comparison says that it is out of date."""
    retest_now(team, confirmed, model, monkeypatch)
    team.db.refresh(confirmed)
    assert confirmed.status == FindingStatus.FIXED_AND_VERIFIED

    confirm_password(team)
    rolled = roll_back(team, to_version=0, reason="The guardrail blocks legitimate questions.")

    assert rolled.status_code == 200, rolled.text
    team.db.expire_all()
    retest = retest_of(team)
    assert retest.out_of_date is True
    team.db.refresh(confirmed)
    assert confirmed.status == FindingStatus.REOPENED
    assert remediation_of(team).status == RemediationStatus.APPROVED


def test_a_retest_that_could_not_run_can_be_started_again(team, confirmed, model, monkeypatch):
    """Step 2 and the failed end condition: the organization's monthly limits hold for a retest
    too, and a retest that could not run says why and can be started again."""
    settings = get_settings()
    monkeypatch.setattr(settings, "default_monthly_campaign_runs", 1)  # the campaign run used it
    credential = ready(team, confirmed, model, monkeypatch)
    assert deploy(team, confirmed, terms=TERMS).status_code == 201
    confirm(team, credential, 1, 4)
    team.db.expire_all()

    failed = retest_of(team)
    assert failed.status == RetestStatus.FAILED and failed.campaign_run_id is None
    assert "monthly limit of 1 campaign runs is reached" in failed.message
    assert "retest.failed" in actions(team)
    team.db.refresh(confirmed)
    assert confirmed.status == FindingStatus.CONFIRMED  # nothing is closed by a retest that failed

    monkeypatch.setattr(settings, "default_monthly_campaign_runs", 100)
    sending(monkeypatch, REFUSED)
    target_answers(monkeypatch, "Your last order was delivered on Tuesday.")
    log_in(team.client, DEVELOPER)
    answered = team.client.post(f"{API}/{confirmed.code}/retest")

    assert answered.status_code == 202, answered.text
    assert answered.json()["verdict_label"] == "Fixed and Verified"
    assert retest_of(team).number == 2


def test_sentra_starts_a_retest_by_itself_and_not_twice(team, confirmed, model, monkeypatch):
    """There is no "request retest": asking for one that is not waiting is refused."""
    retest_now(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    refused = team.client.post(f"{API}/{confirmed.code}/retest")

    assert refused.status_code == 409 and code_of(refused) == "retest_not_waiting"
    assert len(team.db.scalars(select(Retest)).all()) == 1
