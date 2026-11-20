"""Shared set-up of the campaign run tests (FR-5.4, FR-5.6, FR-5.7).

No test sends anything to a target. The run's plan is a stub with the dummy messages ATTEMPT-1,
ATTEMPT-2 …, and the send loop is a stub sender that takes each attempt's budget as the Target
Connector would and answers with an invented reply or a connector error.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.modules.m01_users.models import Role
from app.modules.m02_targets import verification
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.suites import sync_built_in_suites
from app.modules.m05_campaigns import planning
from app.modules.m05_campaigns.models import Attempt
from app.workers import jobs
from app.workers.connector.connector import Reply
from app.workers.orchestrator import engine, send_loop
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import organization_with
from tests.m05_campaigns.test_campaigns import add_target, campaign

CAMPAIGNS = "/api/v1/campaigns"


def run_url(number: int = 1, path: str = "", code: str = "C-001") -> str:
    return f"{CAMPAIGNS}/{code}/runs/{number}{path}"


def reply(text: str = "Hello! How can I help you today?") -> Reply:
    return Reply(text=text, tool_calls=None, status_code=200, duration_ms=120, body="{}")


def clock(delta: timedelta) -> str:
    """A clock time in UTC, e.g. for a time window that opens in two hours."""
    return (datetime.now(UTC) + delta).strftime("%H:%M")


def plan_attempts(count: int):
    """A stub of UC-5.4 step 2: `count` attempts of the run's first test, with the messages
    ATTEMPT-1 … ATTEMPT-n; the run's other tests are skipped."""

    def plan(db, run, target) -> planning.Plan:
        first = run.versions["tests"][0]
        result = planning.Plan(templates={"file": "stub", "entries": {}})
        for test in run.versions["tests"]:
            planned = test is first
            result.tests.append(
                {
                    "code": test["code"],
                    "version": test["version"],
                    "name": test["code"],
                    "suites": test["suites"],
                    "template": "stub",
                    "status": "planned" if planned else "skipped",
                    "reason": None if planned else "Not part of this test.",
                    "attempts": count if planned else 0,
                }
            )
        for number in range(1, count + 1):
            attempt = Attempt(
                organization_id=run.organization_id,
                campaign_run_id=run.id,
                attempt_no=number,
                test_definition_id=uuid.UUID(first["id"]),
                test_code=first["code"],
                suite_code=first["suites"][0],
                template="stub",
                variant=1,
                input=f"ATTEMPT-{number}",
                session_id=f"session-{number}",
            )
            db.add(attempt)
            result.attempts.append(attempt)
        return result

    return plan


class StubSender:
    """Stands in for the send loop. It takes each attempt's budget as the Target Connector does
    right before a request, then answers with answer(attempt): a Reply or a connector error.
    during(run, attempt) runs after each attempt, e.g. a stop through the API's service."""

    def __init__(self, answer=None, during=None) -> None:
        self.answer = answer or (lambda attempt: reply())
        self.during = during
        self.sent: list[str] = []

    def __call__(self, run: engine.RunContext) -> None:
        while (attempt := run.next_attempt()) is not None:
            run.send_options(attempt)["budget"].take()
            self.sent.append(attempt.input)
            outcome = self.answer(attempt)
            if isinstance(outcome, Exception):
                run.failed(attempt, outcome)
            else:
                run.replied(attempt, outcome)
            if self.during is not None:
                self.during(run, attempt)


def configure(db, code: str = "C-001", **changes):
    """Changes the campaign's settings before a run is launched; a run copies them at launch. A
    test that measures reproducibility (FR-6.4) says so here, e.g. configure(db, repetitions=5)."""
    from app.modules.m05_campaigns.models import Campaign

    number = int(code.removeprefix("C-"))
    found = db.scalar(select(Campaign).where(Campaign.number == number))
    for name, value in changes.items():
        setattr(found, name, value)
    db.commit()
    return found


def confirmed(target, method) -> verification.Outcome:
    return verification.Outcome(True, "sentra-verification=found", "The token was found.")


@pytest.fixture
def team(client, db, monkeypatch):
    """Halcyon Bank: Arif (Security Analyst, logged in), Maya (AI Application Developer), Sofia
    (Security Manager) and Tom (administrator). The bank has a verified tool-using agent with a
    safe rate of 20 per minute, the built-in tests and suites, and campaign C-001 with a budget
    of 10 attempts and no time window. The ownership check before each run finds the token."""
    # Like the sessions of the API and the workers (database.SessionLocal), so the tests see what
    # a worker sees.
    db.expire_on_commit = False
    db.autoflush = False
    jobs.DEFERRED.clear()
    sync_built_in_library(db)
    sync_built_in_suites(db)
    org = organization_with(
        db,
        client,
        {
            "arif@example.com": Role.SECURITY_ANALYST,
            "maya@example.com": Role.TARGET_OWNER,
            "sofia@example.com": Role.SECURITY_MANAGER,
        },
    )
    agent = add_target(db, org)
    log_in(client, "arif@example.com")
    created = client.post(
        CAMPAIGNS,
        json=campaign(
            agent.id,
            attempt_budget=10,
            request_rate=20,
            repetitions=1,  # FR-6.4 measures nothing here; configure() turns it on per test
            window_start=None,
            window_end=None,
            time_zone="UTC",
        ),
    )
    assert created.status_code == 201
    monkeypatch.setattr(verification, "_check", confirmed)
    monkeypatch.setattr(engine, "sleep", lambda seconds: None)
    yield SimpleNamespace(client=client, db=db, org=org, agent=agent)
    jobs.DEFERRED.clear()


@pytest.fixture
def use(monkeypatch):
    """use(sender, attempts=3): the run's plan has `attempts` attempts, and `sender` (a
    StubSender by default) stands in for the send loop."""

    def install(sender=None, attempts: int = 3):
        sender = sender if sender is not None else StubSender()
        monkeypatch.setattr(send_loop, "send_attempts", sender)
        monkeypatch.setattr(planning, "plan", plan_attempts(attempts))
        return sender

    return install
