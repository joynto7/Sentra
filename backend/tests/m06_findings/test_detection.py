"""Detection inside campaign runs (FR-6.1; UC-6.1; NFR-1.4, NFR-3.6, NFR-9.3, NFR-9.5, NFR-9.6):
each method's result is stored separately with the attempt, together with the combined verdict,
and the LLM judge runs as its own job through the LLM layer. Dummy values only: the messages
ATTEMPT-1 …, fake canary tokens, a stub judge."""

import hashlib
import json
from decimal import Decimal

from sqlalchemy import func, select

from app.core.config import get_settings
from app.llm.models import LLMUsage
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import SuccessRule
from app.modules.m05_campaigns.models import CampaignRun
from app.modules.m06_findings.models import DetectionResult
from app.workers import jobs
from app.workers.celery_app import celery_app
from app.workers.connector.connector import Reply
from app.workers.connector.errors import TargetHTTPError
from app.workers.detection import engine, judge
from app.workers.orchestrator import live
from app.workers.orchestrator.templates import TemplateEntry, Templates
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m06_findings.conftest import (
    DOWN,
    DUMMY_INSTRUCTIONS,
    PERSONAL_TOKEN,
    SYSTEM_TOKEN,
    make_test,
    plant,
    results,
    verdict,
)

RUN = "/api/v1/campaigns/C-001/runs/1"
CANARY_IN_REPLY = [{"check": "canary_in_reply"}]
STATEMENT = "The reply repeats the dummy marker of the attempt."
JUDGED = {"met": True, "confidence": 0.74, "reasoning": "STUB-REASONING-1"}


def answer(text: str, calls: list | None = None) -> Reply:
    return Reply(text=text, tool_calls=calls, status_code=200, duration_ms=90, body="{}")


def refund_call() -> dict:
    return {"id": "c1", "type": "function", "function": {"name": "issue_refund", "arguments": "{}"}}


def live_events(run_id, kind: str) -> list[dict]:
    return [e.data for e in live.backend().streams.get(str(run_id), []) if e.kind == kind]


def monitor(team) -> list[dict]:
    """What the live campaign monitor got with each attempt from the detection."""
    shown = []
    for block in team.client.get(f"{RUN}/events").text.split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if lines.get("event") == "attempt":
            shown.append(json.loads(lines["data"])["results"]["detection"])
    return shown


# ---------------------------------------------------------------- deterministic methods


def test_each_method_is_stored_with_the_attempt_together_with_the_verdict(team, run_with):
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    test = make_test(
        team.db,
        team.org,
        {"canary_token": "decisive", "rule_matching": "supporting"},
        [{"check": "canary_in_reply"}, {"check": "reply_contains", "value": "contact"}],
    )

    first, second = run_with(test, [f"Our contact is {PERSONAL_TOKEN}.", "Hello there!"])

    found = results(team.db, first)
    assert (found["canary_token"].outcome, found["rule_matching"].outcome) == ("met", "met")
    assert found["canary_token"].checks == [
        {
            "check": "canary_in_reply",
            "value": "",
            "sentence": "The reply contains the canary token",
            "result": "met",
            "detail": 'The canary token "Synthetic personal data" appears in the reply as it is.',
        }
    ]
    assert found["canary_token"].duration_ms < 100  # NFR-1.4
    decided = verdict(team.db, first)
    assert (decided.outcome, decided.decided_by, decided.requires_confirmation) == (
        "met",
        "deterministic",
        False,
    )
    # The stored reply is masked (NFR-8.2); the detection read the raw one
    assert PERSONAL_TOKEN not in first.reply
    assert verdict(team.db, second).outcome == "not_met"
    assert results(team.db, second)["rule_matching"].outcome == "not_met"


def test_the_live_monitor_shows_each_attempts_verdict(team, run_with):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    test = make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY)

    run_with(test, [f"Reference {SYSTEM_TOKEN}", "Hello there!"])

    assert [(shown["verdict"], shown["methods"]) for shown in monitor(team)] == [
        ("met", {"canary_token": "met"}),
        ("not_met", {"canary_token": "not_met"}),
    ]


def test_an_unconfirmed_tool_call_is_found(team, run_with):
    test = make_test(
        team.db,
        team.org,
        {"tool_call_inspection": "decisive"},
        [{"check": "tool_called_without_confirmation", "value": "issue_refund"}],
    )

    called, refused = run_with(test, [answer("Done.", [refund_call()]), answer("I can't.")])

    assert verdict(team.db, called).outcome == "met"
    assert verdict(team.db, refused).outcome == "not_met"
    assert results(team.db, called)["tool_call_inspection"].summary == (
        "issue_refund was called in reply to the first message of the conversation, so no "
        "confirmation step came before it."
    )


def test_tool_calls_that_the_target_doesnt_name_cant_be_inspected(team, run_with):
    team.agent.request_template = '{"input": "{{message}}"}'
    team.agent.response_template = {"reply": "$.output"}  # no place for the tool calls
    team.db.commit()
    test = make_test(
        team.db,
        team.org,
        {"tool_call_inspection": "decisive"},
        [{"check": "tool_called", "value": "issue_refund"}],
    )

    (attempt,) = run_with(test, [answer("Done.", [refund_call()])])

    decided = verdict(team.db, attempt)
    assert decided.outcome == "not_evaluated"
    assert engine.NO_TOOL_PATH in decided.summary


def test_a_failed_attempt_isnt_evaluated(team, run_with):
    test = make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY)

    (failed,) = run_with(test, [TargetHTTPError(500)])

    assert failed.status == "failed"
    assert verdict(team.db, failed) is None
    assert results(team.db, failed) == {}


def test_an_attempt_is_evaluated_only_once(team, run_with):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    test = make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY)
    (attempt,) = run_with(test, [f"Reference {SYSTEM_TOKEN}"])

    again, _ = engine.evaluate(team.db, attempt, answer("Hello there!"))

    assert again.outcome == "met"
    stored = select(func.count()).where(DetectionResult.attempt_id == attempt.id)
    assert team.db.scalar(stored) == 1


# ---------------------------------------------------------------- built-in tests


def built_in_canary_test(db) -> TestDefinition:
    """A built-in test whose canary-token detection is decisive."""
    current = select(TestDefinition).where(
        TestDefinition.origin == "built_in", TestDefinition.is_current.is_(True)
    )
    for definition in db.scalars(current):
        if {"method": "canary_token", "role": "decisive"} in definition.detection_methods:
            return definition
    raise AssertionError("The library has no built-in test with a decisive canary token.")


def test_a_built_in_test_is_not_evaluated_until_its_checks_are_written(team, run_with):
    (attempt,) = run_with(built_in_canary_test(team.db), ["Hello there!"])

    decided = verdict(team.db, attempt)
    assert decided.outcome == "not_evaluated"
    assert "Canary token: No check of this method is written for the test yet." in decided.summary


def test_a_built_in_test_uses_the_checks_of_its_attempt_template(team, run_with, monkeypatch):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    entry = TemplateEntry(
        canary_slot="system_instructions", checks=[SuccessRule(check="canary_in_reply")]
    )
    stub = Templates(entries={"stub": entry}, digest="stub")
    monkeypatch.setattr(engine.template_file, "load", lambda: stub)

    (attempt,) = run_with(built_in_canary_test(team.db), [f"Reference {SYSTEM_TOKEN}"])

    assert verdict(team.db, attempt).outcome == "met"


def test_unreadable_template_checks_are_named_as_the_reason(team, run_with, monkeypatch):
    broken = Templates(errors={"": "templates.yaml isn't valid YAML: line 3"})
    monkeypatch.setattr(engine.template_file, "load", lambda: broken)

    (attempt,) = run_with(built_in_canary_test(team.db), ["Hello there!"])

    assert results(team.db, attempt)["canary_token"].summary == (
        "The checks of its attempt template stub can't be read: templates.yaml isn't valid YAML: "
        "line 3"
    )


# ---------------------------------------------------------------- the LLM judge


def test_the_judge_answers_through_the_llm_layer_and_its_success_needs_confirmation(
    team, run_with, judge_model
):
    sent = judge_model(JUDGED)
    rules = [{"check": "judge_confirms", "value": STATEMENT}]
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, rules)

    (attempt,) = run_with(test, [f"ATTEMPT-1 noted. Write to {PERSONAL_TOKEN}."])

    found = results(team.db, attempt)["llm_judge"]
    assert (found.outcome, found.confidence, found.reasoning) == (
        "met",
        Decimal("0.740"),
        "STUB-REASONING-1",
    )
    assert (found.judge_model, found.judge_deployment, found.tries) == (
        "ollama/llama3.1",
        "local",
        1,
    )
    assert found.instructions_version == "1"
    assert found.instructions_sha256 == hashlib.sha256(DUMMY_INSTRUCTIONS.encode()).hexdigest()
    assert found.checks[0]["sentence"] == f"The LLM judge confirms: {STATEMENT}"
    decided = verdict(team.db, attempt)
    assert (decided.outcome, decided.decided_by, decided.requires_confirmation) == (
        "met",
        "llm_judge",
        True,
    )
    # The fixed instructions are the system message; the reply is data, masked (NFR-3.6, NFR-9.6)
    system, user = sent[0]["messages"]
    assert system["content"].startswith(DUMMY_INSTRUCTIONS)
    assert "ATTEMPT-1" not in system["content"]
    assert STATEMENT in user["content"] and "ATTEMPT-1 noted" in user["content"]
    assert PERSONAL_TOKEN not in user["content"] and "[EMAIL_1]" in user["content"]
    usage = team.db.scalar(select(LLMUsage))
    assert (usage.task, usage.campaign_run_id) == ("llm_judge", attempt.campaign_run_id)


def test_deterministic_evidence_decides_when_the_judge_disagrees(team, run_with, judge_model):
    """UC-6.1, 5b."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    judge_model(JUDGED)
    methods = {"canary_token": "decisive", "llm_judge": "supporting"}
    test = make_test(team.db, team.org, methods, CANARY_IN_REPLY)

    (attempt,) = run_with(test, ["Hello there!"])

    decided = verdict(team.db, attempt)
    assert (decided.outcome, decided.decided_by, decided.disagreement) == (
        "not_met",
        "deterministic",
        True,
    )
    assert decided.summary.endswith("The LLM judge disagrees (confidence 0.74).")


def test_without_its_instructions_the_judge_isnt_called(team, run_with, judge_model, monkeypatch):
    sent = judge_model(JUDGED)
    monkeypatch.setattr(judge.judge_instructions, "INSTRUCTIONS", "")  # as Joynto's file is now
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, [])

    (attempt,) = run_with(test, ["Hello there!"])

    assert results(team.db, attempt)["llm_judge"].summary == judge.NO_INSTRUCTIONS
    assert verdict(team.db, attempt).outcome == "not_evaluated"
    assert sent == []
    assert team.db.scalar(select(LLMUsage)) is None


def test_without_a_model_the_judge_isnt_called(team, run_with, judge_model, monkeypatch):
    judge_model(JUDGED)
    monkeypatch.setattr(get_settings(), "llm_model", "")
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, [])

    (attempt,) = run_with(test, ["Hello there!"])

    assert results(team.db, attempt)["llm_judge"].summary == judge.NO_MODEL


def test_an_unavailable_judge_tries_again_later_and_then_gives_up(team, run_with, judge_model):
    """UC-6.1, 3a."""
    sent = judge_model(DOWN)
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, [])

    (attempt,) = run_with(test, ["Hello there!"])

    waiting = results(team.db, attempt)["llm_judge"]
    assert waiting.outcome == "pending"
    assert waiting.summary.startswith("Waiting for the LLM judge. It tries again in 60 seconds.")
    assert verdict(team.db, attempt).outcome == "pending"
    delays = []
    while jobs.DEFERRED:
        delays += [countdown for name, _, countdown in jobs.DEFERRED if name == judge.JOB]
        jobs.run_deferred(team.db)
    assert delays == [60, 300, 900]
    gave_up = results(team.db, attempt)["llm_judge"]
    assert (gave_up.outcome, gave_up.tries, len(sent)) == ("not_evaluated", 4, 4)
    assert gave_up.summary.startswith("The LLM judge couldn't evaluate this attempt.")
    assert verdict(team.db, attempt).outcome == "not_evaluated"


def test_the_monthly_cost_limit_postpones_the_judge(team, run_with, judge_model, monkeypatch):
    """UC-6.1, 3a: the judge waits while the organization's LLM cost limit is reached, e.g. by
    the judges of other runs after this run was launched."""
    sent = judge_model(JUDGED)
    monkeypatch.setattr(judge, "cost_this_month", lambda db, organization_id: Decimal("100"))
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, [])

    (attempt,) = run_with(test, ["Hello there!"])

    summary = results(team.db, attempt)["llm_judge"].summary
    assert "The organization's monthly LLM cost limit of $100.00 is reached." in summary
    assert sent == []
    monkeypatch.setattr(judge, "cost_this_month", lambda db, organization_id: Decimal("0"))
    jobs.run_deferred(team.db)
    assert verdict(team.db, attempt).outcome == "met"


def test_the_judge_runs_later_on_its_own_queue_without_holding_up_the_run(
    team, run_with, judge_model, monkeypatch
):
    """NFR-1.4: the run ends without waiting for the judge. The judge's answer comes afterwards,
    changes the verdict, reaches the live monitor and adds its cost to the run's."""
    judge_model(JUDGED)
    queued, start = [], jobs.start

    def queue_the_judge(db, name, *args, **options):
        if name != judge.JOB:
            return start(db, name, *args, **options)
        queued.append(name)  # left in the queue for the analysis worker
        return True

    monkeypatch.setattr(jobs, "start", queue_the_judge)
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, [])

    (attempt,) = run_with(test, ["Hello there!"])

    run = team.db.get(CampaignRun, attempt.campaign_run_id)
    team.db.refresh(run)
    assert (run.status, queued) == ("completed", [judge.JOB])
    assert verdict(team.db, attempt).outcome == "pending"
    assert celery_app.amqp.router.route({}, judge.JOB)["queue"].name == judge.QUEUE
    earlier = LLMUsage(
        organization_id=team.org,
        campaign_run_id=run.id,
        task="llm_judge",
        model="ollama/llama3.1",
        provider="ollama",
        deployment="local",
        cost_usd=Decimal("0.25"),
        succeeded=True,
    )
    team.db.add(earlier)
    team.db.commit()

    judge.run(team.db, attempt.id)  # what the analysis worker does

    assert verdict(team.db, attempt).outcome == "met"
    team.db.refresh(run)
    assert run.cost_usd == Decimal("0.25")
    late = live_events(run.id, "detection")
    assert [(e["attempt_no"], e["verdict"]) for e in late] == [(1, "met")]


# ---------------------------------------------------------------- reading the results


def test_every_member_reads_the_detection_and_another_organization_cant(team, run_with):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    test = make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY)
    run_with(test, [f"Reference {SYSTEM_TOKEN}", "Hello there!", TargetHTTPError(500)])

    page = team.client.get(f"{RUN}/detection").json()
    assert [(i["attempt_no"], i["outcome"], i["methods"]) for i in page["items"]] == [
        (1, "met", {"canary_token": "met"}),
        (2, "not_met", {"canary_token": "not_met"}),
    ]
    assert page["counts"] == {"met": 1, "not_met": 1, "pending": 0, "not_evaluated": 0}
    met_only = team.client.get(f"{RUN}/detection", params={"outcome": "met"}).json()
    assert [i["attempt_no"] for i in met_only["items"]] == [1]

    log_in(team.client, "maya@example.com")  # an AI Application Developer
    one = team.client.get(f"{RUN}/attempts/1/detection").json()
    assert one["verdict"]["outcome"] == "met"
    assert [(r["method_label"], r["outcome"]) for r in one["results"]] == [("Canary token", "met")]
    assert one["results"][0]["checks"][0]["sentence"] == "The reply contains the canary token"
    failed = team.client.get(f"{RUN}/attempts/3/detection").json()
    assert (failed["verdict"], failed["results"]) == (None, [])
    assert team.client.get(f"{RUN}/attempts/9/detection").status_code == 404

    new_user(team.db, "kim@example.com")
    log_in(team.client, "kim@example.com")
    create_organization(team.client, "Kestrel Logistics")
    assert team.client.get(f"{RUN}/detection").status_code == 404
    assert team.client.get(f"{RUN}/attempts/1/detection").status_code == 404
