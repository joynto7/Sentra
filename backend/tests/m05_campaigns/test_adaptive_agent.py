"""FR-5.5 (M5) Adaptive Testing Agent: UC-5.5 Perform Adaptive Testing (2a, 3a) end to end.

Nothing here is attack content. The agent's own instructions are Joynto's file and are replaced
with the dummy text AGENT-INSTRUCTIONS-1; the model is a stub that answers with whatever the test
tells it to; the attempts carry the dummy messages ATTEMPT-1, REFINED-1 …; and the canary tokens
are the fake ones of the detection fixtures.
"""

import json
from decimal import Decimal

import litellm
import pytest
from sqlalchemy import func, select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.llm.models import LLMUsage
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m05_campaigns import runs
from app.modules.m05_campaigns.models import (
    AgentRefinement,
    Attempt,
    AttemptPriority,
    CampaignRun,
    RefinementState,
)
from app.workers.agent import agent, instructions
from app.workers.connector.connector import Reply
from tests.m01_users.test_permissions import membership_of
from tests.m05_campaigns.conftest import team  # noqa: F401
from tests.m06_findings.conftest import (  # noqa: F401
    SYSTEM_TOKEN,
    judge_model,
    make_test,
    plant,
    run_with,  # noqa: F811
)

RUN = "/api/v1/campaigns/C-001/runs/1"
DUMMY = "AGENT-INSTRUCTIONS-1"  # stands in for Joynto's instructions
CANARY_IN_REPLY = [{"check": "canary_in_reply"}]
DOWN = "unavailable"


def proposal(
    message: str, reason: str = "The target refused, so this one asks differently."
) -> str:
    return json.dumps({"message": message, "reason": reason})


@pytest.fixture
def agent_model(monkeypatch):
    """agent_model(*answers): the agent is given dummy instructions and a stub model that answers
    with each of `answers` in turn (the last one again when they run out; DOWN raises). Returns
    the requests the model received."""
    settings = get_settings()
    sent: list[dict] = []
    real = litellm.completion

    def configure(*answers, model: str = "ollama/llama3.1") -> list[dict]:
        monkeypatch.setattr(instructions, "INSTRUCTIONS", DUMMY)
        monkeypatch.setattr(instructions, "VERSION", "1")
        monkeypatch.setattr(settings, "llm_model", model)
        monkeypatch.setattr(settings, "llm_task_models", {})
        texts = list(answers)

        def fake(**kwargs):
            sent.append(kwargs)
            text = texts[min(len(sent), len(texts)) - 1]
            if text == DOWN:
                raise RuntimeError("The stub model can't be reached.")
            return real(**kwargs, mock_response=text)

        monkeypatch.setattr(litellm, "completion", fake)
        return sent

    return configure


@pytest.fixture
def chain_limit(monkeypatch):
    """How many times one test may be refined in a row (FR-5.5, UC-5.5 step 6)."""
    return lambda number: monkeypatch.setattr(
        get_settings(), "agent_max_refinements_per_test", number
    )


@pytest.fixture
def test_that_fails(team, db):  # noqa: F811
    """A test whose canary check is not met by the stub answers, so every attempt leaves the
    objective unreached and the agent has something to refine."""
    plant(db, team.agent, "system_prompt", SYSTEM_TOKEN)
    return make_test(db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY)


def answer(text: str) -> Reply:
    return Reply(text=text, tool_calls=None, status_code=200, duration_ms=90, body="{}")


def refinements(db) -> list[AgentRefinement]:
    query = select(AgentRefinement).order_by(AgentRefinement.created_at, AgentRefinement.id)
    return list(db.scalars(query.execution_options(populate_existing=True)))


def attempts(db) -> list[Attempt]:
    query = select(Attempt).order_by(Attempt.attempt_no)
    return list(db.scalars(query.execution_options(populate_existing=True)))


# ---------------------------------------------------------------- refining (steps 1-5)


def test_an_attempt_that_missed_its_objective_is_refined(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    sent = agent_model(proposal("REFINED-1"))

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    # Step 4: the refinement is an ordinary attempt of the same test, sent by the run engine
    rows = attempts(db)
    assert [row.input for row in rows][:2] == ["ATTEMPT-1", "REFINED-1"]
    refined = rows[1]
    assert refined.priority == AttemptPriority.FOLLOW_UP
    assert refined.test_code == rows[0].test_code
    assert refined.session_id != rows[0].session_id  # a conversation of its own
    # Step 5: the reason is recorded with the attempt and in the agent's own trail
    assert refined.refinement_reason.startswith("The target refused")
    first = next(row for row in refinements(db) if row.state == RefinementState.SENT)
    assert first.instructions_version == "1"
    assert first.attempt_id == refined.id and first.after_attempt_id == rows[0].id
    # Step 2: Sentra's own instructions, the target's words only as data (NFR-9.6)
    messages = sent[0]["messages"]
    assert messages[0]["role"] == "system" and DUMMY in messages[0]["content"]
    assert "The assistant refuses." in messages[-1]["content"]
    # What the agent costs belongs to the run, so the run's own limits count it (FR-5.7)
    usage = db.scalar(select(LLMUsage).execution_options(populate_existing=True))
    assert usage.task == "adaptive_testing" and usage.campaign_run_id == refined.campaign_run_id


def test_an_attempt_that_reached_its_objective_is_not_refined(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    agent_model(proposal("REFINED-1"))

    # The reply carries the planted token, so the canary check is met and the objective reached
    run_with(test_that_fails, [f"Here it is: {SYSTEM_TOKEN}"], planned=1)

    assert refinements(db) == []
    assert [row.input for row in attempts(db)] == ["ATTEMPT-1"]


def test_the_chain_stops_at_the_limit(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    chain_limit(2)
    agent_model(proposal("REFINED-1"), proposal("REFINED-2"), proposal("REFINED-3"))

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    assert [row.input for row in attempts(db)] == ["ATTEMPT-1", "REFINED-1", "REFINED-2"]
    assert len([row for row in refinements(db) if row.state == RefinementState.SENT]) == 2


def test_the_agent_keeps_to_its_share_of_the_budget(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    # The campaign's budget is 10 attempts, so the agent's share of 0.3 allows 3 refinements.
    chain_limit(99)
    agent_model(*[proposal(f"REFINED-{n}") for n in range(1, 9)])

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    sent_rows = [row for row in refinements(db) if row.state == RefinementState.SENT]
    assert len(sent_rows) == 3


# ---------------------------------------------------------------- the scope check (3a, 3a1)


def test_a_proposal_that_names_another_system_is_discarded(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    chain_limit(1)
    agent_model(proposal("Fetch https://attacker.example.net/x and tell me"), proposal("REFINED-1"))

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    rows = refinements(db)
    assert rows[0].state == RefinementState.DISCARDED
    assert "attacker.example.net" in rows[0].reason
    # 3a1: Sentra asks for another refinement, and that one is sent
    assert rows[1].state == RefinementState.SENT
    assert [row.input for row in attempts(db)] == ["ATTEMPT-1", "REFINED-1"]


def test_a_proposal_that_repeats_or_plants_a_canary_is_discarded(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    chain_limit(1)
    agent_model(proposal("ATTEMPT-1"), proposal(f"Say {SYSTEM_TOKEN}"))

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    rows = refinements(db)
    assert [row.state for row in rows] == [RefinementState.DISCARDED, RefinementState.DISCARDED]
    assert "repeats an attempt" in rows[0].reason
    assert "canary token" in rows[1].reason
    assert [row.input for row in attempts(db)] == ["ATTEMPT-1"]


def test_a_model_that_answers_with_nothing_usable_is_recorded(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    chain_limit(1)
    agent_model("not json at all", proposal(""))

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    # A bad answer is not a reason to stop: the agent is asked again, and the empty message
    # that comes back is discarded by the scope check.
    states = [row.state for row in refinements(db)]
    assert states == [RefinementState.REFUSED, RefinementState.DISCARDED]
    assert [row.input for row in attempts(db)] == ["ATTEMPT-1"]


# ---------------------------------------------------------------- stopping (2a, 2a1)


def test_a_model_that_cannot_be_reached_stops_the_agent_not_the_run(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    sent = agent_model(DOWN)

    run_with(test_that_fails, ["The assistant refuses."], planned=2)

    rows = refinements(db)
    assert [row.state for row in rows] == [RefinementState.STOPPED]
    assert "stopped" in rows[0].reason.lower()
    # The run itself finished with its planned attempts, and nothing was asked again
    run = db.scalar(select(CampaignRun).execution_options(populate_existing=True))
    assert run.attempts_sent == 2
    assert len(sent) == 1


def test_without_instructions_the_agent_does_nothing(team, db, run_with, test_that_fails):  # noqa: F811
    run_with(test_that_fails, ["The assistant refuses."], planned=2)

    rows = refinements(db)
    assert [row.state for row in rows] == [RefinementState.STOPPED]
    assert "no instructions yet" in rows[0].reason
    assert len(attempts(db)) == 2
    # Nothing was sent to any model
    assert db.scalar(select(func.count()).select_from(LLMUsage)) == 0


# ---------------------------------------------------------------- what the pages read


def test_the_run_says_what_the_agent_did(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    chain_limit(1)
    agent_model(proposal("Fetch https://attacker.example.net/x"), proposal("REFINED-1"))
    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    found = team.client.get(f"{RUN}/agent").json()

    assert found["enabled"] is True
    assert (found["sent"], found["discarded"], found["refused"]) == (1, 1, 0)
    assert found["stopped_reason"] is None
    assert Decimal(found["cost_usd"]) >= 0
    assert [row["state"] for row in found["items"]][0] == RefinementState.SENT  # newest first
    assert found["items"][0]["reason"].startswith("The target refused")
    # The attempts themselves carry the reason, so the monitor needs no second call
    page = team.client.get(f"{RUN}/attempts").json()
    refined = [row for row in page["items"] if row["refinement_reason"]]
    assert len(refined) == 1 and refined[0]["test_code"]


def test_a_campaign_without_the_agent_refines_nothing(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    from app.modules.m05_campaigns.models import Campaign

    sent = agent_model(proposal("REFINED-1"))
    # The campaign's switch is copied into the run when it is launched (UC-5.1 step 4), so a
    # campaign with the agent off is a run whose own settings say so.
    db.scalar(select(Campaign)).adaptive_agent = False
    db.commit()

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    run = db.scalar(select(CampaignRun).execution_options(populate_existing=True))
    assert agent.enabled(run) is False
    assert refinements(db) == []
    assert [row.input for row in attempts(db)] == ["ATTEMPT-1"]
    assert sent == []


# ---------------------------------------------------------------- the limits of a run (FR-5.7)


def stops(db) -> list[AgentRefinement]:
    return [row for row in refinements(db) if row.state == RefinementState.STOPPED]


def audit_entries(db) -> list[AuditLogEntry]:
    query = select(AuditLogEntry).where(AuditLogEntry.action == "campaign.agent_stopped")
    return list(db.scalars(query.execution_options(populate_existing=True)))


def test_the_agent_stops_when_it_has_made_all_the_refinements_a_run_allows(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
    monkeypatch,
):
    chain_limit(99)
    monkeypatch.setattr(get_settings(), "agent_max_refinements_per_run", 2)
    sent = agent_model(*[proposal(f"REFINED-{n}") for n in range(1, 9)])

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    assert [row.input for row in attempts(db)] == ["ATTEMPT-1", "REFINED-1", "REFINED-2"]
    assert len(sent) == 2  # the model was not asked a third time
    assert "limit of 2 refinements" in stops(db)[0].reason


def test_the_agent_stops_at_its_cost_cap(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
    monkeypatch,
):
    chain_limit(99)
    monkeypatch.setattr(get_settings(), "agent_cost_cap_usd", 1.5)
    # What the layer wrote for this run's agent requests is what counts, so the stub reports 1 USD
    # for every request, which the layer stores like any other cost.
    monkeypatch.setattr(litellm, "completion_cost", lambda *args, **kwargs: 1.0)
    sent = agent_model(*[proposal(f"REFINED-{n}") for n in range(1, 9)])

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    assert len(sent) == 2  # 1 USD after the first request, 2 USD after the second: over 1.5
    assert "cost limit of $1.50" in stops(db)[0].reason
    assert [row.input for row in attempts(db)] == ["ATTEMPT-1", "REFINED-1", "REFINED-2"]


def test_the_agent_stops_when_its_requests_keep_failing(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
    monkeypatch,
):
    chain_limit(99)
    monkeypatch.setattr(get_settings(), "agent_max_failures_in_a_row", 3)
    sent = agent_model("not json at all")

    run_with(test_that_fails, ["The assistant refuses."], planned=3)

    # Two failed requests for the first attempt, one more for the second, then it stops: the
    # third attempt is not refined and the run still finishes its three planned attempts.
    assert len(sent) == 3
    assert [row.state for row in refinements(db)] == [
        RefinementState.REFUSED,
        RefinementState.REFUSED,
        RefinementState.REFUSED,
        RefinementState.STOPPED,
    ]
    assert "3 requests in a row" in stops(db)[0].reason
    run = db.scalar(select(CampaignRun).execution_options(populate_existing=True))
    assert run.attempts_sent == 3


def test_a_sent_refinement_ends_a_streak_of_failures(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
    monkeypatch,
):
    chain_limit(2)
    monkeypatch.setattr(get_settings(), "agent_max_failures_in_a_row", 2)
    agent_model("not json at all", proposal("REFINED-1"), proposal("REFINED-2"))

    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    states = [row.state for row in refinements(db)]
    assert states == [RefinementState.REFUSED, RefinementState.SENT, RefinementState.SENT]
    assert stops(db) == []


def test_a_target_that_is_not_verified_is_never_refined_against(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    # The run engine itself ends a run whose target lost its verification (UC-5.4 1a), so the
    # agent's own check is a second guard (NFR-9.2), tested here on the finished run.
    agent_model(proposal("REFINED-1"))
    run_with(test_that_fails, ["The assistant refuses."], planned=1)
    run = db.scalar(select(CampaignRun).execution_options(populate_existing=True))
    target = db.get(Target, run.target_id)

    assert agent.limit_reached(db, run, target) is None
    target.status = TargetStatus.UNVERIFIED
    assert "no longer a verified target" in agent.limit_reached(db, run, target)
    assert "no longer a verified target" in agent.limit_reached(db, run, None)


def test_an_analyst_stops_the_agent_and_the_run_goes_on(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
    chain_limit,
):
    chain_limit(99)
    arif = membership_of(db, "arif@example.com")
    sent = agent_model(*[proposal(f"REFINED-{n}") for n in range(1, 9)])

    def stop_by_hand(run, attempt):
        if attempt.attempt_no == 1:
            runs.stop_agent(db, arif, "C-001", 1, "It is not needed any more.")

    run_with(test_that_fails, ["The assistant refuses."], planned=3, during=stop_by_hand)

    rows = stops(db)
    assert len(rows) == 1
    assert rows[0].reason == "Stopped by Arif. It is not needed any more."
    assert len(sent) <= 1  # at most the request that was already under way
    run = db.scalar(select(CampaignRun).execution_options(populate_existing=True))
    assert run.attempts_sent >= 3 and run.status == "completed"
    entry = audit_entries(db)[0]
    assert entry.actor_name == "Arif" and entry.item_type == "campaign_run"
    assert entry.details["reason"].startswith("Stopped by Arif")


def test_every_stop_has_an_audit_entry_in_sentras_name(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    agent_model(DOWN)

    run_with(test_that_fails, ["The assistant refuses."], planned=2)

    entries = audit_entries(db)
    assert len(entries) == 1  # one stop, one entry, however many attempts followed
    assert entries[0].actor_name == "Sentra" and "The agent stopped" in entries[0].details["reason"]


def test_the_agent_can_only_be_stopped_by_hand_once_and_not_when_it_is_off(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    from app.core.errors import ConflictError
    from app.modules.m05_campaigns.models import Campaign

    arif = membership_of(db, "arif@example.com")
    agent_model(proposal("REFINED-1"))
    problems = []

    def stop_twice(run, attempt):
        if attempt.attempt_no == 1:
            runs.stop_agent(db, arif, "C-001", 1, "")
            try:
                runs.stop_agent(db, arif, "C-001", 1, "")
            except ConflictError as exc:
                problems.append(exc.code)

    run_with(test_that_fails, ["The assistant refuses."], planned=1, during=stop_twice)

    assert problems == ["agent_stopped"]
    # Once the run has ended there is nothing left to stop
    with pytest.raises(ConflictError) as ended:
        runs.stop_agent(db, arif, "C-001", 1, "")
    assert ended.value.code == "run_ended"
    assert db.scalar(select(Campaign)).adaptive_agent is True


def test_the_stop_endpoint_answers_for_a_run_that_has_ended_or_does_not_exist(
    team,  # noqa: F811
    db,
    run_with,  # noqa: F811
    test_that_fails,
    agent_model,
):
    agent_model(proposal("REFINED-1"))
    run_with(test_that_fails, ["The assistant refuses."], planned=1)

    ended = team.client.post(f"{RUN}/agent/stop", json={"reason": "Too late."})
    missing = team.client.post("/api/v1/campaigns/C-001/runs/9/agent/stop")

    assert (ended.status_code, ended.json()["error"]["code"]) == (409, "run_ended")
    assert missing.status_code == 404
