"""Shared set-up of the detection tests (FR-6.1).

The runs are the campaign runs of tests/m05_campaigns/conftest.py: no request leaves the tests,
the attempts carry the dummy messages ATTEMPT-1, ATTEMPT-2 …, and a stub sender answers them with
invented replies. Each run uses a custom test made here with dummy checks, and the target's canary
tokens are fake. The LLM judge reaches a stub model through the LLM layer: LiteLLM answers with
its mock reply, so no request leaves the tests either.
"""

import json
import uuid
from datetime import UTC, datetime

import litellm
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.m02_targets.models import TargetCanary
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns import planning
from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.modules.m06_findings.models import DetectionResult, DetectionVerdict
from app.workers.detection import judge_instructions
from app.workers.orchestrator import send_loop
from tests.m05_campaigns.conftest import StubSender, reply, team  # noqa: F401

SYSTEM_TOKEN = "SENTRA-SYS-0A1B2C3D"  # a fake canary token
PERSONAL_TOKEN = "canary.0a1b2c3d@example.com"  # a fake synthetic e-mail address
DUMMY_INSTRUCTIONS = "JUDGE-INSTRUCTIONS-1"  # stands in for Joynto's instructions
DOWN = "unavailable"  # a stub answer: the model can't be reached


def make_test(db, organization_id, methods: dict[str, str], rules: list[dict], **changes):
    """A custom test of the organization with the given detection methods (method: role) and
    success rules."""
    data = {
        "code": f"HB-DET-{uuid.uuid4().hex[:3].upper()}",
        "version": 1,
        "is_current": True,
        "origin": "custom",
        "organization_id": organization_id,
        "name": "Detection test with dummy checks",
        "category": "LLM07",
        "severity": "medium",
        "objective": "Checks the detection engine with dummy values only.",
        "prerequisites": "A target with a fake canary token.",
        "target_types": ["tool_using_agent"],
        "success_condition": "The reply contains the dummy marker.",
        "detection_methods": [{"method": m, "role": r} for m, r in methods.items()],
        "success_rules": rules,
        "attempt_template": "stub",
        "recommended_mitigation": "Nothing: this test only exercises the detection engine.",
        "atlas": [],
        "content_hash": "0" * 64,
        "change_note": "test",
    }
    definition = TestDefinition(**(data | changes))
    db.add(definition)
    db.commit()
    return definition


def plant(db, target, slot: str, token: str) -> TargetCanary:
    canary = TargetCanary(
        target_id=target.id,
        slot=slot,
        token=token,
        source="generated",
        planted_at=datetime.now(UTC),
    )
    db.add(canary)
    db.commit()
    return canary


@pytest.fixture
def run_with(team, monkeypatch):  # noqa: F811
    """run_with(test, answers): launches C-001 with one attempt of `test` per answer, with the
    messages ATTEMPT-1 …; an answer is the target's reply text, a Reply or a connector error.
    Returns the run's attempts once the run has ended."""

    def launch(definition: TestDefinition, answers: list) -> list[Attempt]:
        def plan(db, run, target) -> planning.Plan:
            result = planning.Plan(templates={"file": "stub", "entries": {}})
            result.tests.append(
                {
                    "code": definition.code,
                    "version": definition.version,
                    "name": definition.name,
                    "suites": [],
                    "template": "stub",
                    "status": "planned",
                    "reason": None,
                    "attempts": len(answers),
                }
            )
            for number in range(1, len(answers) + 1):
                attempt = Attempt(
                    organization_id=run.organization_id,
                    campaign_run_id=run.id,
                    attempt_no=number,
                    test_definition_id=definition.id,
                    test_code=definition.code,
                    template="stub",
                    variant=1,
                    input=f"ATTEMPT-{number}",
                    session_id=f"session-{number}",
                )
                db.add(attempt)
                result.attempts.append(attempt)
            return result

        def answer(attempt):
            given = answers[attempt.attempt_no - 1]
            return reply(given) if isinstance(given, str) else given

        monkeypatch.setattr(planning, "plan", plan)
        monkeypatch.setattr(send_loop, "send_attempts", StubSender(answer))
        response = team.client.post("/api/v1/campaigns/C-001/runs")
        assert response.status_code == 202, response.text
        query = (
            select(Attempt)
            .join(CampaignRun, CampaignRun.id == Attempt.campaign_run_id)
            .where(CampaignRun.number == response.json()["number"])
            .order_by(Attempt.attempt_no)
        )
        return list(team.db.scalars(query.execution_options(populate_existing=True)))

    return launch


@pytest.fixture
def judge_model(monkeypatch):
    """judge_model(*answers): a stub judge. Joynto's instructions are replaced by a dummy text, a
    model is configured, and LiteLLM answers each request with the next mock answer (the last one
    again when they run out; DOWN raises an error instead). Returns the requests it received."""
    settings = get_settings()
    sent: list[dict] = []
    real = litellm.completion

    def configure(*answers, model: str = "ollama/llama3.1") -> list[dict]:
        monkeypatch.setattr(judge_instructions, "INSTRUCTIONS", DUMMY_INSTRUCTIONS)
        monkeypatch.setattr(settings, "llm_model", model)
        monkeypatch.setattr(settings, "llm_task_models", {})
        texts = [a if isinstance(a, str) else json.dumps(a) for a in answers]

        def fake(**kwargs):
            sent.append(kwargs)
            text = texts[min(len(sent), len(texts)) - 1]
            if text == DOWN:
                raise RuntimeError("The stub model can't be reached.")
            return real(**kwargs, mock_response=text)

        monkeypatch.setattr(litellm, "completion", fake)
        return sent

    return configure


def results(db, attempt) -> dict[str, DetectionResult]:
    query = select(DetectionResult).where(DetectionResult.attempt_id == attempt.id)
    return {r.method: r for r in db.scalars(query.execution_options(populate_existing=True))}


def verdict(db, attempt) -> DetectionVerdict:
    query = select(DetectionVerdict).where(DetectionVerdict.attempt_id == attempt.id)
    return db.scalar(query.execution_options(populate_existing=True))
