"""FR-11.3 (M11) Benchmark Runs: UC-11.3 Configure Benchmark Run (1a, 2a, 5a) and UC-11.4 Execute
Benchmark Run (3a, 4a, 4b) end to end.

The lab target is the stub of tests/m11_lab/test_lab_deployment.py, so nothing is sent anywhere:
the attempts of each campaign run carry the dummy messages of templates.yaml and the stub answers
them.
"""

import uuid

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m05_campaigns.models import CampaignRun, RunStatus, RunType
from app.modules.m11_lab import benchmark
from app.modules.m11_lab.models import (
    BenchmarkRepetition,
    BenchmarkRun,
    BenchmarkStatus,
    LabDeployment,
    LabState,
    RepetitionStatus,
)
from tests.m11_lab.test_lab_deployment import KEY, LabSide, analyst, deploy, lab, zone  # noqa: F401

URL = "/api/v1/lab/benchmarks"
SUITE = "QUICK-REGRESSION"
OTHER = "LLM01-PROMPT-INJECTION"


def body(**changes) -> dict:
    return {
        "name": "Static suites against the adaptive agent",
        "target_ids": [],
        "strategies": [
            {"key": "A", "name": "Static suites", "suites": [SUITE], "adaptive_agent": False},
            {
                "key": "B",
                "name": "The same suites again",
                "suites": [SUITE],
                "adaptive_agent": False,
            },
        ],
        "attempt_budget": 40,
        "repetitions": 2,
        "judge_every_attempt": False,
        **changes,
    }


@pytest.fixture
def lab_target(analyst, db):  # noqa: F811
    """The RAG chatbot, deployed and ready, with the built-in test suites loaded."""
    from app.modules.m04_tests.library import sync_built_in_library
    from app.modules.m04_tests.suites import sync_built_in_suites

    sync_built_in_library(db)
    sync_built_in_suites(db)
    db.flush()
    return deploy(analyst).json()["target_id"]


def save(client, target_id, **changes):
    return client.post(URL, json=body(target_ids=[target_id], **changes))


def estimate(client, target_id, **changes):
    return client.post(f"{URL}/estimate", json=body(target_ids=[target_id], **changes))


def detail(client, code: str) -> dict:
    response = client.get(f"{URL}/{code}")
    assert response.status_code == 200
    return response.json()


def rows(db, code: str = None) -> list[BenchmarkRepetition]:
    return list(db.scalars(select(BenchmarkRepetition).order_by(BenchmarkRepetition.order_no)))


def actions(db) -> list[str]:
    return list(db.scalars(select(AuditLogEntry.action).order_by(AuditLogEntry.seq)))


# ---------------------------------------------------------------- the configuration (UC-11.3)


def test_the_estimate_counts_every_run_of_the_experiment(analyst, lab_target):  # noqa: F811
    found = estimate(analyst, lab_target).json()

    # one lab target × two strategies × two repetitions
    assert found["runs"] == 4
    assert found["attempts"] > 0
    assert found["minutes"] >= 1
    assert found["warnings"] == []


def test_the_estimate_names_a_monthly_limit_it_would_pass(analyst, lab_target, db, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "default_monthly_campaign_runs", 2)

    found = estimate(analyst, lab_target).json()

    assert any("campaign runs" in warning for warning in found["warnings"])


def test_a_benchmark_run_is_saved_as_a_draft_with_its_plan(analyst, lab_target, db):  # noqa: F811
    response = save(analyst, lab_target)

    assert response.status_code == 201
    found = response.json()
    assert found["code"] == "BR-001"
    assert found["status"] == BenchmarkStatus.DRAFT
    assert [s["key"] for s in found["strategies"]] == ["A", "B"]
    assert (found["runs_total"], found["runs_done"]) == (4, 0)
    assert found["estimate"]["runs"] == 4
    # UC-11.4 step 1: the order is random and interleaved, and fixed now
    places = [row["order_no"] for row in found["repetition_rows"]]
    assert places == [1, 2, 3, 4]
    assert found["order_seed"] is not None
    assert "benchmark.saved" in actions(db)


def test_a_benchmark_needs_at_least_two_strategies(analyst, lab_target):  # noqa: F811
    one = save(
        analyst,
        lab_target,
        strategies=[{"key": "A", "name": "Only one", "suites": [SUITE], "adaptive_agent": False}],
    )

    assert one.status_code == 422


def test_only_lab_targets_can_be_benchmarked(analyst, db, lab_target):  # noqa: F811
    from tests.m05_campaigns.test_campaigns import add_target

    ordinary = add_target(db, db.scalar(select(LabDeployment.organization_id)))

    refused = save(analyst, str(ordinary.id))

    assert refused.status_code == 422
    assert "Only lab targets" in refused.json()["error"]["details"][0]["message"]


def test_a_lab_target_that_is_not_ready_cannot_be_benchmarked(analyst, db, lab_target):  # noqa: F811
    db.scalar(select(LabDeployment)).state = LabState.NOT_READY
    db.flush()

    refused = save(analyst, lab_target)

    assert refused.status_code == 422
    assert "isn't ready" in refused.json()["error"]["details"][0]["message"]


def test_a_strategy_cannot_use_an_agent_that_has_no_model(analyst, lab_target, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "llm_model", "")

    refused = save(
        analyst,
        lab_target,
        strategies=[
            {"key": "A", "name": "Static", "suites": [SUITE], "adaptive_agent": False},
            {"key": "B", "name": "Adaptive", "suites": [SUITE], "adaptive_agent": True},
        ],
    )

    assert refused.status_code == 422
    assert "adaptive testing agent" in refused.json()["error"]["details"][0]["message"]


def test_a_benchmark_run_can_repeat_an_earlier_one(analyst, lab_target, db):  # noqa: F811
    first = save(analyst, lab_target).json()

    again = save(analyst, lab_target, baseline_code=first["code"])

    assert again.status_code == 201
    assert again.json()["baseline_code"] == first["code"]


def test_a_strategy_that_names_an_unknown_suite_is_refused(analyst, lab_target):  # noqa: F811
    refused = save(
        analyst,
        lab_target,
        strategies=[
            {"key": "A", "name": "Static", "suites": [SUITE], "adaptive_agent": False},
            {"key": "B", "name": "Typo", "suites": ["NO-SUCH-SUITE"], "adaptive_agent": False},
        ],
    )

    assert refused.status_code == 422
    assert "NO-SUCH-SUITE" in refused.json()["error"]["details"][0]["message"]


def test_only_a_security_analyst_saves_a_benchmark_run(client, db, zone):  # noqa: F811
    from app.modules.m01_users.models import Role
    from tests.m01_users.test_organizations import log_in
    from tests.m01_users.test_permissions import organization_with

    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    log_in(client, "maya@example.com")

    assert client.get(URL).status_code == 200  # reading is open to every member
    assert save(client, str(uuid.uuid4())).status_code == 403


# ---------------------------------------------------------------- the execution (UC-11.4)


def test_starting_it_fixes_the_versions_and_runs_the_first_repetition(analyst, lab_target, db):  # noqa: F811
    code = save(analyst, lab_target).json()["code"]

    response = analyst.post(f"{URL}/{code}/start")

    assert response.status_code == 200
    found = response.json()
    assert found["status"] in (BenchmarkStatus.RUNNING, BenchmarkStatus.COMPLETED)
    assert found["versions"]["lab_targets"][0]["name"]
    assert all(v["id"] and v["code"] for v in found["versions"]["tests"])
    assert "models" in found["versions"]
    assert "benchmark.started" in actions(db)
    # Every repetition is one campaign run of type "benchmark", one after another.
    made = db.scalars(select(CampaignRun).where(CampaignRun.run_type == RunType.BENCHMARK)).all()
    assert made and all(run.campaign_id is None for run in made)
    assert all(run.attempt_budget == 40 for run in made)


def test_every_repetition_runs_and_the_run_finishes(analyst, lab_target, db):  # noqa: F811
    code = save(analyst, lab_target, repetitions=1).json()["code"]

    analyst.post(f"{URL}/{code}/start")

    found = detail(analyst, code)
    assert found["status"] == BenchmarkStatus.COMPLETED
    assert found["runs_done"] == found["runs_total"] == 2
    assert {row["status"] for row in found["repetition_rows"]} == {RepetitionStatus.COMPLETED}
    assert "benchmark.completed" in actions(db)
    # Each repetition is a real campaign run that planned this strategy's tests. It sends nothing
    # here, because the attempt templates of templates.yaml are Joynto's and the repository holds
    # no attack content (CLAUDE.md), so every test is skipped with its reason.
    made = db.scalars(select(CampaignRun).where(CampaignRun.run_type == RunType.BENCHMARK)).all()
    assert len(made) == 2
    for run in made:
        assert run.status == RunStatus.COMPLETED
        assert [test["code"] for test in run.versions["tests"]]
        assert run.plan


def test_each_repetition_starts_from_a_reset_lab_target(analyst, lab_target, db, zone):  # noqa: F811
    before = zone.resets

    code = save(analyst, lab_target, repetitions=1).json()["code"]
    analyst.post(f"{URL}/{code}/start")

    # UC-11.4 step 3: one reset per repetition, before its campaign run.
    assert zone.resets - before == 2
    row = db.scalar(select(LabDeployment))
    assert (row.state, row.resets) == (LabState.READY, 2)


def test_a_reset_that_fails_pauses_the_benchmark_run(analyst, lab_target, db, zone):  # noqa: F811
    code = save(analyst, lab_target, repetitions=1).json()["code"]
    zone.reachable = False

    analyst.post(f"{URL}/{code}/start")

    found = detail(analyst, code)
    assert found["status"] == BenchmarkStatus.PAUSED
    assert "couldn't be reset" in found["status_message"]
    assert found["runs_done"] == 0  # nothing ran on a lab target that wasn't reset
    assert "benchmark.paused" in actions(db)


def test_a_paused_run_goes_on_where_it_stopped(analyst, lab_target, db, zone):  # noqa: F811
    code = save(analyst, lab_target, repetitions=1).json()["code"]
    zone.reachable = False
    analyst.post(f"{URL}/{code}/start")
    assert detail(analyst, code)["status"] == BenchmarkStatus.PAUSED

    zone.reachable = True
    response = analyst.post(f"{URL}/{code}/resume")

    assert response.status_code == 200
    found = detail(analyst, code)
    assert found["status"] == BenchmarkStatus.COMPLETED
    assert found["runs_done"] == 2


def test_a_model_that_changed_pauses_the_run(analyst, lab_target, db, monkeypatch):  # noqa: F811
    code = save(analyst, lab_target, repetitions=1).json()["code"]
    analyst.post(f"{URL}/{code}/start")
    db.scalar(select(BenchmarkRun)).status = BenchmarkStatus.RUNNING  # as if more were left
    db.add(
        BenchmarkRepetition(
            benchmark_run_id=db.scalar(select(BenchmarkRun.id)),
            target_id=uuid.UUID(lab_target),
            strategy_key="A",
            repetition=9,
            order_no=99,
            status=RepetitionStatus.PLANNED,
        )
    )
    db.commit()
    monkeypatch.setattr(get_settings(), "llm_model", "ollama/llama3.1")

    benchmark.advance(db, db.scalar(select(BenchmarkRun.id)))

    found = detail(analyst, code)
    assert found["status"] == BenchmarkStatus.PAUSED
    assert "would not be comparable" in found["status_message"]
    assert analyst.post(f"{URL}/{code}/resume").status_code == 409


def test_stopping_it_keeps_what_finished(analyst, lab_target, db, zone):  # noqa: F811
    code = save(analyst, lab_target, repetitions=1).json()["code"]
    zone.reachable = False
    analyst.post(f"{URL}/{code}/start")  # pauses on the first reset

    response = analyst.post(f"{URL}/{code}/stop")

    assert response.status_code == 200
    found = detail(analyst, code)
    assert found["status"] == BenchmarkStatus.STOPPED
    assert "repetitions that finished are kept" in found["status_message"]
    assert "benchmark.stopped" in actions(db)
    assert analyst.post(f"{URL}/{code}/start").status_code == 409


def test_the_analyst_is_told_when_the_run_has_finished(analyst, lab_target, db):  # noqa: F811
    from app.modules.m01_users.models import User
    from app.modules.m09_reporting.models import Notification

    code = save(analyst, lab_target, repetitions=1).json()["code"]
    analyst.post(f"{URL}/{code}/start")

    priya = db.scalar(select(User.id).where(User.email == "priya@example.com"))
    found = db.scalars(
        select(Notification).where(
            Notification.user_id == priya, Notification.event == "benchmark_run_finished"
        )
    ).all()
    assert len(found) == 1
    assert code in found[0].subject


def test_a_run_that_was_started_is_not_started_again(analyst, lab_target):  # noqa: F811
    code = save(analyst, lab_target, repetitions=1).json()["code"]
    analyst.post(f"{URL}/{code}/start")

    again = analyst.post(f"{URL}/{code}/start")

    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_started")


def test_the_list_shows_every_benchmark_run_newest_first(analyst, lab_target):  # noqa: F811
    save(analyst, lab_target)
    save(analyst, lab_target)

    found = analyst.get(URL).json()

    assert [item["code"] for item in found] == ["BR-002", "BR-001"]


def test_another_organization_sees_no_benchmark_run(analyst, lab_target, client, db, zone):  # noqa: F811
    save(analyst, lab_target)
    from tests.m01_users.test_organizations import create, log_in, new_user

    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    create(client, "Kestrel Logistics")

    assert client.get(URL).json() == []
    assert client.get(f"{URL}/BR-001").status_code == 404
