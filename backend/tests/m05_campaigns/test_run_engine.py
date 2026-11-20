"""Tests for the run engine of FR-5.4 (M5) Distributed Execution and FR-5.7 (M5) Safety Limits:
UC-5.4 Execute Campaign Run with its alternative flows, the hard limits, pause and stop at the
worker, the extension points and the recovery after a lost worker (NFR-2.2, NFR-2.3).

The send loop is a stub sender (conftest.py): no request leaves the tests."""

import types
import uuid
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core import addresses
from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m02_targets import verification
from app.modules.m02_targets.models import Target, TargetPacing
from app.modules.m05_campaigns import lifecycle, runs
from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.workers import jobs
from app.workers.connector import connector, pacing
from app.workers.connector.errors import TargetHTTPError, TargetOverloaded, TargetUnreachable
from app.workers.orchestrator import engine, hooks, send_loop
from app.workers.orchestrator import templates as template_file
from tests.m01_users.test_permissions import membership_of
from tests.m05_campaigns.conftest import StubSender, plan_attempts, reply, run_url
from tests.m05_campaigns.test_runs import actions, launch, night_campaign, notifications


def the_run(db) -> CampaignRun:
    return db.scalar(select(CampaignRun).execution_options(populate_existing=True))


def attempts(db) -> list[Attempt]:
    return list(
        db.scalars(
            select(Attempt).order_by(Attempt.attempt_no).execution_options(populate_existing=True)
        )
    )


def run_all_deferred(db) -> list[float]:
    """Runs the jobs that wait for their time, as their time comes, until none is left; returns
    how long each one waited."""
    waited = []
    while jobs.DEFERRED:
        waited += [countdown for _, _, countdown in jobs.DEFERRED]
        jobs.run_deferred(db)
    return waited


# ---------------------------------------------------------------- UC-5.4 steps 1-2


def test_the_ownership_is_checked_again_and_a_failure_cancels_the_run(team, use, monkeypatch):
    sender = use()
    monkeypatch.setattr(
        verification,
        "_check",
        lambda target, method: verification.Outcome(False, None, "The token can't be found."),
    )

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("cancelled", "ownership_not_verified")
    assert body["status_message"] == (
        "Cancelled before its first attempt: the ownership of Payments Operations Agent couldn't "
        "be confirmed again. The token can't be found."
    )
    assert sender.sent == []
    assert team.db.scalar(select(Target.status)) == "unverified"
    assert notifications(team.db, "arif@example.com", "campaign_run_completed")[0].startswith(
        "Campaign run R-001-1 of Quarterly assessment"
    )
    assert actions(team.db, team.org) == ["campaign.run_launched", "campaign.run_cancelled"]


def test_a_run_whose_tests_have_no_usable_template_completes_with_the_reasons(team, monkeypatch):
    sender = StubSender()  # with the real planning and a templates file without entries
    monkeypatch.setattr(send_loop, "send_attempts", sender)
    monkeypatch.setattr(template_file, "load", lambda: template_file.parse("templates: {}\n"))

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("completed", "nothing_to_run")
    assert sender.sent == []
    skipped = body["summary"]["skipped_tests"]
    assert len(skipped) == 6
    assert all("has no entry in templates.yaml" in test["reason"] for test in skipped)


def test_the_send_loop_that_isnt_written_yet_stops_the_run_with_a_clear_message(team, use):
    def placeholder(run):
        raise NotImplementedError("The send loop of campaign runs isn't written yet.")

    use(placeholder, attempts=2)

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("stopped", "internal_error")
    assert body["status_message"] == engine.NO_SEND_LOOP
    assert body["summary"]["attempts"]["not_sent"] == 2


# ---------------------------------------------------------------- the hard limits (FR-5.7)


def test_the_run_stops_at_its_attempt_budget(team, use):
    team.db.execute(update(runs.Campaign).values(attempt_budget=2))
    team.db.commit()
    sender = use(attempts=3)

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("completed", "budget_used")
    assert sender.sent == ["ATTEMPT-1", "ATTEMPT-2"]
    assert body["summary"]["attempts"]["not_sent"] == 1


def test_the_database_refuses_an_attempt_beyond_the_budget(team, use):
    use(attempts=1)
    launch(team.client)

    with pytest.raises(IntegrityError):
        team.db.execute(update(CampaignRun).values(attempts_sent=CampaignRun.attempt_budget + 1))
        team.db.flush()


def test_the_requests_use_the_runs_rate_and_its_budget_at_the_last_moment(team, use, monkeypatch):
    """The send options carry the run's controls into the Target Connector (FR-5.6, FR-5.7)."""
    requests = []

    def target(request: httpx.Request) -> httpx.Response:
        requests.append(request.content.decode())
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello!"}}]})

    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(target))
    monkeypatch.setattr(addresses, "resolve", lambda host, port: ["93.184.215.15"])
    seen = {}

    def one_attempt(run: engine.RunContext) -> None:
        attempt = run.next_attempt()
        options = run.send_options(attempt)
        seen.update(rate=options["rate_per_minute"], session=options["session_id"])
        run.replied(attempt, connector.send(run.db, run.target, attempt.input, **options))
        stopped = run.next_attempt()
        runs.stop(run.db, membership_of(run.db, "arif@example.com"), "C-001", 1, "")
        with pytest.raises(engine.RunInterrupted):
            connector.send(run.db, run.target, stopped.input, **run.send_options(stopped))

    use(one_attempt, attempts=2)

    body = launch(team.client).json()

    assert len(requests) == 1 and "ATTEMPT-1" in requests[0]
    assert seen == {"rate": 20, "session": "session-1"}
    assert (body["status"], body["attempts_sent"]) == ("stopped", 1)


def test_a_stop_ends_a_wait_within_half_a_second(team, use, monkeypatch):
    slept = []

    def sleep(seconds):
        slept.append(seconds)
        team.db.execute(update(CampaignRun).values(status="stopped"))
        team.db.commit()

    monkeypatch.setattr(engine, "sleep", sleep)

    def wait_long(run: engine.RunContext) -> None:
        run.next_attempt()
        with pytest.raises(engine.RunInterrupted):
            run.wait(30)

    use(wait_long)
    launch(team.client)

    assert sum(slept) <= engine.STEP_SECONDS  # FR-5.6: within 5 seconds


def test_an_overloaded_target_gets_a_break_and_stops_the_run(team, use):
    sender = use(StubSender(answer=lambda attempt: TargetOverloaded(429, "30")), attempts=5)

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("stopped", "target_overloaded")
    assert body["status_message"] == (
        "Stopped automatically: the target answered 3 times in a row that it is overloaded "
        "(HTTP 429 or 503)."
    )
    assert len(sender.sent) == 3
    pause = team.db.scalar(select(TargetPacing.next_request_at))
    assert pause >= lifecycle.now() + timedelta(seconds=25)
    entry = team.db.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "campaign.run_stopped")
    )
    assert (entry.actor_name, entry.details["reason"]) == ("Sentra", "target_overloaded")
    assert notifications(team.db, "arif@example.com", "campaign_run_completed")


def test_an_unreachable_target_pauses_the_run_which_retries_with_growing_delays(team, use):
    failures = iter([TargetUnreachable("The target can't be reached.")] * 2)
    sender = use(StubSender(answer=lambda attempt: next(failures, None) or reply()))

    paused = launch(team.client).json()

    assert (paused["status"], paused["pause_kind"]) == ("paused", "automatic")
    assert paused["status_message"] == (
        "Paused automatically: The target can't be reached. Sentra tries again in 15 seconds "
        "(retry 1 of 5)."
    )
    assert run_all_deferred(team.db) == [15, 30]
    assert sender.sent == ["ATTEMPT-1", "ATTEMPT-1", "ATTEMPT-1", "ATTEMPT-2", "ATTEMPT-3"]
    run = the_run(team.db)
    assert (run.status, run.end_reason, run.retries) == ("completed", "tests_finished", 0)
    retries = [a for a in attempts(team.db) if a.retry_of_id]
    assert [a.status for a in retries] == ["failed", "replied"]
    assert actions(team.db, team.org).count("campaign.run_paused") == 2


def test_a_target_that_stays_unreachable_stops_the_run_after_the_last_retry(team, use, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_retry_delays", [1, 2])
    use(StubSender(answer=lambda attempt: TargetUnreachable("The target can't be reached.")))

    launch(team.client)

    assert run_all_deferred(team.db) == [1, 2]
    run = the_run(team.db)
    assert (run.status, run.end_reason) == ("stopped", "target_unavailable")
    assert run.status_message.startswith(
        "Stopped automatically: the target still couldn't be reached after 2 retries."
    )


def test_repeated_errors_of_the_target_stop_the_run(team, use, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_max_errors", 3)
    sender = use(StubSender(answer=lambda attempt: TargetHTTPError(500)), attempts=5)

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("stopped", "target_errors")
    assert len(sender.sent) == 3
    failed = team.client.get(run_url(path="/attempts?status=failed")).json()["items"]
    assert (failed[0]["error_kind"], failed[0]["status_code"]) == ("http_error", 500)


def test_a_reply_ends_a_row_of_errors(team, use, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_max_errors", 2)
    answers = iter([TargetHTTPError(500), reply(), TargetHTTPError(500), reply()])
    use(StubSender(answer=lambda attempt: next(answers)), attempts=4)

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("completed", "tests_finished")


def test_a_monthly_limit_stops_a_running_run_and_tells_the_administrators(team, use, monkeypatch):
    monkeypatch.setattr(get_settings(), "default_monthly_attempts", 2)
    sender = use(attempts=4)

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("stopped", "usage_limit_reached")
    assert sender.sent == ["ATTEMPT-1", "ATTEMPT-2"]
    assert body["status_message"].startswith(
        "Stopped automatically: The monthly limit of 2 attempts is reached."
    )
    assert notifications(team.db, "tom@example.com", "usage_limit_warning")


def test_a_target_that_is_no_longer_verified_stops_the_run(team, use):
    def unverify(run, attempt):
        team.db.execute(update(Target).values(status="unverified"))
        team.db.commit()

    sender = use(StubSender(during=unverify))

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("stopped", "ownership_not_verified")
    assert sender.sent == ["ATTEMPT-1"]


def test_a_run_gives_its_worker_back_while_it_waits_for_the_targets_turn(team, use):
    messages = []
    sender = StubSender()

    def turn_later(run: engine.RunContext) -> None:
        if not messages:
            messages.append(run.run.status_message)
            run.next_attempt()
            raise pacing.TooLongToWait(40)
        messages.append(team.db.scalar(select(CampaignRun.status_message)))
        sender(run)

    use(turn_later)

    waiting = launch(team.client).json()

    assert (waiting["status"], waiting["status_message"]) == (
        "running",
        "Waiting for the target's turn: its request rate allows the next attempt in 40 seconds.",
    )
    assert run_all_deferred(team.db) == [40]
    assert messages == ["Running.", "Running."]
    assert sender.sent == ["ATTEMPT-1", "ATTEMPT-2", "ATTEMPT-3"]
    assert the_run(team.db).status == "completed"


# ---------------------------------------------------------------- the time window (FR-5.4)


def test_a_run_outside_its_window_waits_in_the_queue_until_it_opens(team, use):
    sender = use()
    code = night_campaign(team)

    body = launch(team.client, code).json()

    assert (body["status"], body["queue_position"]) == ("queued", None)
    assert body["status_message"].startswith("Waiting for its time window, ")
    assert body["wake_at"] is not None
    assert sender.sent == []
    assert [countdown for _, _, countdown in jobs.DEFERRED] == [lifecycle.MAX_COUNTDOWN_SECONDS]


def test_a_run_ends_when_its_time_window_closes(team, use):
    def close_the_window(run, attempt):
        team.db.execute(
            update(CampaignRun).values(window_ends_at=lifecycle.now() - timedelta(seconds=1))
        )
        team.db.commit()

    sender = use(StubSender(during=close_the_window))

    body = launch(team.client).json()

    assert (body["status"], body["end_reason"]) == ("completed", "time_window_ended")
    assert sender.sent == ["ATTEMPT-1"]


# ---------------------------------------------------------------- extensions (NFR-5.3)


def test_extensions_evaluate_each_reply_and_a_failing_one_doesnt_stop_the_run(
    team, use, monkeypatch
):
    ended = []
    detection = types.ModuleType("app.workers.detection.hooks")
    detection.on_attempt = lambda db, attempt, raw: {"verdict": "seen", "length": len(raw.text)}
    detection.on_run_end = lambda db, run: ended.append(run.id)
    broken = types.ModuleType("app.workers.broken.hooks")

    def fail(db, attempt, raw):
        raise RuntimeError("not ready")

    broken.on_attempt = fail
    monkeypatch.setattr(hooks, "_modules", [detection, broken])
    use(attempts=2)

    body = launch(team.client).json()

    assert body["status"] == "completed"
    assert ended == [the_run(team.db).id]
    first = attempts(team.db)[0]
    assert first.hook_errors == [{"extension": "broken", "error": "RuntimeError: not ready"}]
    events = sse_events(team)
    assert events[0]["results"] == {"detection": {"verdict": "seen", "length": 32}}


def sse_events(team) -> list[dict]:
    import json

    text = team.client.get(run_url(path="/events")).text
    found = []
    for block in text.split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if lines.get("event") == "attempt":
            found.append(json.loads(lines["data"]))
    return found


# ---------------------------------------------------------------- workers (NFR-2.2, NFR-2.3)


def lost_worker_state(team) -> CampaignRun:
    """A run whose worker disappeared while ATTEMPT-2 was on its way: the lease ran out."""
    code = night_campaign(team)
    launch(team.client, code)
    jobs.DEFERRED.clear()
    db = team.db
    run = the_run(db)
    target = db.get(Target, run.target_id)
    plan_attempts(3)(db, run, target)
    db.flush()
    first, second, _ = attempts(db)
    first.status, first.sent_at = "replied", lifecycle.now()
    second.status, second.sent_at = "sending", lifecycle.now()
    run.settings = {**run.settings, "window_start": None, "window_end": None}
    run.status, run.started_at, run.attempts_planned, run.attempts_sent = (
        "running",
        lifecycle.now(),
        3,
        2,
    )
    run.lease_owner, run.lease_until = uuid.uuid4(), lifecycle.now() - timedelta(seconds=1)
    run.dispatch_token, run.wake_at = uuid.uuid4(), None
    db.commit()
    return run


def test_a_restarted_worker_takes_over_a_lost_run_without_sending_an_attempt_twice(team, use):
    sender = use()
    run = lost_worker_state(team)

    assert lifecycle.recover(team.db) == 1

    run = the_run(team.db)
    assert (run.status, run.end_reason) == ("completed", "tests_finished")
    assert sender.sent == ["ATTEMPT-3"]
    second = attempts(team.db)[1]
    assert (second.status, second.error_message) == ("interrupted", lifecycle.INTERRUPTED_TEXT)


def test_a_job_finds_the_run_held_by_another_worker_and_looks_again_later(team, use):
    sender = use()
    run = lost_worker_state(team)
    team.db.execute(update(CampaignRun).values(lease_until=lifecycle.now() + timedelta(seconds=60)))
    team.db.commit()
    token = run.dispatch_token

    engine.advance(team.db, run.id, uuid.uuid4())  # a stale job
    assert jobs.DEFERRED == []
    engine.advance(team.db, run.id, token)

    assert sender.sent == []
    [(name, args, countdown)] = jobs.DEFERRED
    assert (name, args) == (lifecycle.JOB, [str(run.id), str(token)])
    assert 55 <= countdown <= 62
    assert the_run(team.db).status == "running"


def test_sentras_own_failures_stop_the_run_after_three_in_a_row(team, use):
    def broken(run):
        raise RuntimeError("a bug in Sentra")

    use(broken)

    launch(team.client)

    assert run_all_deferred(team.db) == [15, 30]
    run = the_run(team.db)
    assert (run.status, run.end_reason) == ("stopped", "internal_error")
    assert run.status_message == engine.INTERNAL_ERROR_TEXT


def test_a_send_loop_that_returns_early_doesnt_keep_a_worker_busy(team, use):
    use(lambda run: None)

    launch(team.client)

    assert [countdown for _, _, countdown in jobs.DEFERRED] == [engine.IDLE_DELAY_SECONDS]
    assert the_run(team.db).status == "running"


def test_a_reply_must_come_from_an_attempt_that_was_sent_with_its_budget(team, use):
    def skip_the_budget(run):
        attempt = run.next_attempt()
        run.replied(attempt, reply())

    use(skip_the_budget)

    launch(team.client)

    run = the_run(team.db)
    assert run.attempts_sent == 0
    assert run.worker_errors == 1  # Sentra treats it as its own failure and tries again later
    assert [a.status for a in attempts(team.db)] == ["planned"] * 3
