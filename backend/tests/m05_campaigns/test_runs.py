"""Tests for FR-5.4 (M5) Distributed Execution and FR-5.6 (M5) Live Monitoring and Control
through the API: UC-5.3 Launch Campaign, UC-5.6 Monitor Campaign Run, UC-5.7 Control Campaign
Run. The send loop is a stub sender (conftest.py)."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m01_users.models import Membership, Role, User
from app.modules.m02_targets.models import Target
from app.modules.m05_campaigns import limits, runs
from app.modules.m05_campaigns.models import Campaign, CampaignRun
from app.modules.m09_reporting.models import Notification
from app.workers import jobs
from app.workers.celery_app import celery_app
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m01_users.test_permissions import membership_of
from tests.m05_campaigns.conftest import CAMPAIGNS, StubSender, clock, reply, run_url
from tests.m05_campaigns.test_campaigns import campaign


def launch(client, code: str = "C-001"):
    return client.post(f"{CAMPAIGNS}/{code}/runs")


def night_campaign(team) -> str:
    """C-002, whose time window opens in two hours: its runs wait in the queue."""
    response = team.client.post(
        CAMPAIGNS,
        json=campaign(
            team.agent.id,
            name="Night assessment",
            attempt_budget=10,
            request_rate=20,
            window_start=clock(timedelta(hours=2)),
            window_end=clock(timedelta(hours=3)),
            time_zone="UTC",
        ),
    )
    assert response.status_code == 201
    return response.json()["code"]


def actions(db, organization_id) -> list[str]:
    rows = db.scalars(
        select(AuditLogEntry.action)
        .where(AuditLogEntry.organization_id == organization_id)
        .where(AuditLogEntry.action.like("campaign.run_%"))
        .order_by(AuditLogEntry.seq)
    )
    return list(rows)


def notifications(db, email: str, event: str) -> list[str]:
    user_id = membership_of(db, email).user_id
    rows = db.scalars(
        select(Notification.text).where(
            Notification.user_id == user_id, Notification.event == event
        )
    )
    return list(rows)


def sse(text: str) -> list[tuple[str, str]]:
    """The (id, event) pairs of a Server-Sent Events stream."""
    found = []
    for block in text.split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" in fields:
            found.append((fields.get("id", ""), fields["event"]))
    return found


# ---------------------------------------------------------------- UC-5.3 Launch Campaign


def test_an_analyst_launches_a_campaign_and_the_workers_run_it(team, use):
    sender = use(attempts=3)

    response = launch(team.client)

    body = response.json()
    assert response.status_code == 202
    assert (body["code"], body["status"], body["end_reason"]) == (
        "R-001-1",
        "completed",
        "tests_finished",
    )
    assert sender.sent == ["ATTEMPT-1", "ATTEMPT-2", "ATTEMPT-3"]
    assert (body["attempts_sent"], body["attempts_replied"], body["attempt_budget"]) == (3, 3, 10)
    assert body["launched_by"] == "Arif"
    assert body["summary"]["attempts"]["replied"] == 3
    assert body["status_message"] == "All planned attempts were sent."


def test_a_run_records_the_versions_and_settings_it_uses(team, use):
    use(attempts=1)

    body = launch(team.client).json()

    versions = body["versions"]
    assert [s["code"] for s in versions["suites"]] == [
        "LLM06-EXCESSIVE-AGENCY",
        "LLM01-PROMPT-INJECTION",
    ]
    assert all(s["version"] >= 1 for s in versions["suites"])
    assert len(versions["tests"]) == 6
    assert {"id", "code", "version", "suites"} <= set(versions["tests"][0])
    # None: this campaign's target has no approved threat model (FR-3.3, UC-5.1, 2a)
    assert versions["threat_model"] is None
    assert team.db.get(CampaignRun, uuid.UUID(body["id"])).threat_model_id is None
    assert body["settings"]["attempt_budget"] == 10
    assert (body["settings"]["window_start"], body["settings"]["time_zone"]) == (None, "UTC")
    assert body["trigger"] == "manual"


def test_a_later_change_of_the_campaign_doesnt_change_a_run(team, use):
    use(attempts=1)
    launch(team.client)

    team.db.execute(update(Campaign).values(attempt_budget=500))
    team.db.commit()

    assert team.client.get(run_url()).json()["attempt_budget"] == 10


def test_the_launch_is_recorded_in_the_audit_log(team, use):
    use(attempts=1)

    launch(team.client)

    entry = team.db.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "campaign.run_launched")
    )
    assert entry.actor_name == "Arif"
    assert entry.summary.startswith("Launched campaign run R-001-1 of Quarterly assessment")
    assert (entry.item_type, entry.details["attempt_budget"]) == ("campaign_run", 10)


def test_only_security_analysts_launch_campaigns(team, use):
    use()
    for email in ("maya@example.com", "tom@example.com"):
        log_in(team.client, email)

        response = launch(team.client)

        assert response.status_code == 403
    assert team.db.scalar(select(CampaignRun.id)) is None


def test_a_campaign_waiting_for_approval_or_rejected_cant_be_launched(team, use):
    use()
    for status, code in (
        ("awaiting_approval", "awaiting_approval"),
        ("rejected", "approval_rejected"),
    ):
        team.db.execute(update(Campaign).values(approval_status=status))
        team.db.commit()

        response = launch(team.client)

        assert (response.status_code, response.json()["error"]["code"]) == (409, code)


def test_a_campaign_against_an_unverified_target_cant_be_launched(team, use):
    use()
    team.db.execute(update(Target).values(status="unverified"))
    team.db.commit()

    response = launch(team.client)

    assert response.status_code == 409
    assert response.json()["error"]["message"] == (
        "Payments Operations Agent isn't verified, so this campaign can't run. Verify its "
        "ownership first."
    )


def test_a_second_run_doesnt_start_while_one_is_in_progress(team, use):
    use()
    code = night_campaign(team)
    assert launch(team.client, code).json()["status"] == "queued"

    response = launch(team.client, code)

    assert response.status_code == 409
    assert response.json()["error"]["message"] == (
        "Run R-002-1 of this campaign is still in progress. Wait until it ends, or stop it first."
    )


def test_a_reached_monthly_limit_refuses_the_launch_and_tells_the_administrators(
    team, use, monkeypatch
):
    use()
    monkeypatch.setattr(get_settings(), "default_monthly_campaign_runs", 0)

    response = launch(team.client)

    assert (response.status_code, response.json()["error"]["code"]) == (409, "usage_limit_reached")
    assert response.json()["error"]["message"].startswith(
        "The monthly limit of 0 campaign runs is reached."
    )
    assert team.db.scalar(select(CampaignRun.id)) is None
    assert notifications(team.db, "tom@example.com", "usage_limit_warning")


def test_a_queue_that_cant_be_reached_cancels_the_launch(team, use, monkeypatch):
    use()
    monkeypatch.setattr(get_settings(), "run_jobs_inline", False)

    def down(*args, **kwargs):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(celery_app, "send_task", down)

    response = launch(team.client)

    assert (response.status_code, response.json()["error"]["code"]) == (503, "queue_unavailable")
    run = team.db.scalar(select(CampaignRun))
    assert (run.status, run.end_reason) == ("cancelled", "queue_unavailable")
    assert limits.usage(team.db, team.org).campaign_runs == 0  # it doesn't count


def test_a_queued_run_shows_its_place_in_the_queue(team, use, monkeypatch):
    use()
    monkeypatch.setattr(get_settings(), "run_jobs_inline", False)
    monkeypatch.setattr(celery_app, "send_task", lambda *args, **kwargs: None)

    body = launch(team.client).json()

    assert (body["status"], body["queue_position"]) == ("queued", 1)
    assert body["status_message"] == "Waiting for a worker."


def test_every_run_job_is_a_worker_task():
    import app.workers.campaigns  # noqa: F401  (the worker imports it through the include list)

    assert "campaigns.advance_run" in celery_app.tasks


# ---------------------------------------------------------------- UC-5.6 Monitor Campaign Run


def test_every_member_can_follow_the_runs_of_a_campaign(team, use):
    use(attempts=2)
    launch(team.client)
    log_in(team.client, "maya@example.com")

    listed = team.client.get(f"{CAMPAIGNS}/C-001/runs").json()
    detail = team.client.get(run_url()).json()

    assert [(r["code"], r["status"]) for r in listed] == [("R-001-1", "completed")]
    assert (detail["campaign"]["code"], detail["target"]["name"]) == (
        "C-001",
        "Payments Operations Agent",
    )
    assert [t["status"] for t in detail["tests"]][:2] == ["planned", "skipped"]


def test_the_organizations_runs_are_listed_newest_first(team, use):
    """Screen 33's "Campaign runs" and the recent runs of a target (Screen 20): the runs of every
    campaign in one list, with the campaign and the target they belong to."""
    use(attempts=2)
    launch(team.client)
    second = night_campaign(team)  # its window opens in two hours, so its run waits in the queue
    launch(team.client, second)
    # Both runs are created in the same transaction here, which gives them the same time; a real
    # launch is a request of its own.
    team.db.execute(
        update(CampaignRun)
        .where(CampaignRun.number == 1, CampaignRun.wake_at.is_(None))
        .values(created_at=datetime.now(UTC) - timedelta(hours=1))
    )
    team.db.commit()
    log_in(team.client, "maya@example.com")

    listed = team.client.get(f"{CAMPAIGNS}/runs").json()
    queued = team.client.get(f"{CAMPAIGNS}/runs?status=queued").json()
    other_target = team.client.get(f"{CAMPAIGNS}/runs?target_id={uuid.uuid4()}").json()

    assert [(r["code"], r["status"], r["campaign"]["name"]) for r in listed] == [
        ("R-002-1", "queued", "Night assessment"),
        ("R-001-1", "completed", "Quarterly assessment — Payments Operations Agent"),
    ]
    assert listed[0]["target"]["name"] == "Payments Operations Agent"
    assert [r["code"] for r in queued] == ["R-002-1"]
    assert other_target == []


def test_the_attempts_of_a_run_come_one_page_at_a_time(team, use):
    use(StubSender(answer=lambda attempt: reply("Write to maya.chen@example.com for help.")))
    launch(team.client)

    page = team.client.get(run_url(path="/attempts?page_size=2")).json()
    replied = team.client.get(run_url(path="/attempts?status=replied")).json()

    assert (page["total"], [a["attempt_no"] for a in page["items"]]) == (3, [1, 2])
    assert page["items"][0]["input"] == "ATTEMPT-1"
    assert "maya.chen@example.com" not in page["items"][0]["reply"]  # masked (NFR-8.2)
    assert "[EMAIL_1]" in page["items"][0]["reply"]
    assert replied["total"] == 3
    assert team.client.get(run_url(path="/attempts?status=unknown")).status_code == 422


def test_the_live_events_replay_what_a_monitor_missed(team, use):
    use(attempts=2)
    launch(team.client)

    events = sse(team.client.get(run_url(path="/events")).text)
    plan_id = next(event_id for event_id, kind in events if kind == "plan")
    again = sse(team.client.get(run_url(path="/events"), headers={"Last-Event-ID": plan_id}).text)

    kinds = [kind for _, kind in events]
    assert kinds[-1] == "ended"
    assert {"status", "plan", "attempt"} <= set(kinds)
    assert [kind for _, kind in again] == kinds[kinds.index("plan") + 1 :]


def test_the_live_stream_of_a_waiting_run_closes_and_the_browser_reconnects(team, use, monkeypatch):
    use()
    code = night_campaign(team)
    launch(team.client, code)
    monkeypatch.setattr(get_settings(), "live_stream_seconds", 1)

    response = team.client.get(run_url(path="/events", code=code))

    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.text.startswith("retry: 3000")
    assert [kind for _, kind in sse(response.text)] == ["status", "status"]


def test_another_organization_cant_see_or_control_the_runs(team, use):
    use(attempts=1)
    launch(team.client)
    new_user(team.db, "kim@example.com")
    log_in(team.client, "kim@example.com")
    kestrel = uuid.UUID(create_organization(team.client, "Kestrel Logistics").json()["id"])
    new_user(team.db, "lea@example.com")
    lea = team.db.scalar(select(User.id).where(User.email == "lea@example.com"))
    team.db.add(Membership(user_id=lea, organization_id=kestrel, role=Role.SECURITY_ANALYST))
    team.db.flush()
    log_in(team.client, "lea@example.com")

    for path in ("", "/attempts", "/events"):
        assert team.client.get(run_url(path=path)).status_code == 404
    assert team.client.get(f"{CAMPAIGNS}/C-001/runs").status_code == 404
    assert team.client.post(f"{CAMPAIGNS}/C-001/runs").status_code == 404
    assert team.client.post(run_url(path="/stop")).status_code == 404
    assert team.client.post(run_url(path="/pause")).status_code == 404


# ---------------------------------------------------------------- UC-5.7 Control Campaign Run


def test_an_analyst_pauses_and_resumes_a_run(team, use):
    arif = membership_of(team.db, "arif@example.com")

    def pause_after_first(run, attempt):
        if attempt.attempt_no == 1:
            runs.pause(team.db, arif, "C-001", 1)

    sender = use(StubSender(during=pause_after_first))
    paused = launch(team.client).json()

    assert (paused["status"], paused["pause_kind"], paused["paused_by"]) == (
        "paused",
        "user",
        "Arif",
    )
    assert paused["status_message"] == "Paused by Arif."
    assert sender.sent == ["ATTEMPT-1"]

    resumed = team.client.post(run_url(path="/resume"))

    assert resumed.status_code == 200
    assert resumed.json()["status"] == "completed"
    assert sender.sent == ["ATTEMPT-1", "ATTEMPT-2", "ATTEMPT-3"]
    assert actions(team.db, team.org) == [
        "campaign.run_launched",
        "campaign.run_paused",
        "campaign.run_resumed",
    ]


def test_a_stop_halts_every_further_attempt_and_keeps_what_was_sent(team, use):
    arif = membership_of(team.db, "arif@example.com")

    def stop_after_first(run, attempt):
        if attempt.attempt_no == 1:
            runs.stop(team.db, arif, "C-001", 1, "The target shows problems.")

    sender = use(StubSender(during=stop_after_first))

    body = launch(team.client).json()

    assert sender.sent == ["ATTEMPT-1"]
    assert (body["status"], body["end_reason"], body["ended_by"]) == (
        "stopped",
        "stopped_by_user",
        "Arif",
    )
    assert body["status_message"] == "Stopped by Arif: The target shows problems."
    assert body["summary"]["attempts"]["replied"] == 1
    assert body["summary"]["attempts"]["not_sent"] == 2
    assert actions(team.db, team.org) == ["campaign.run_launched", "campaign.run_stopped"]


def test_a_developer_may_stop_a_run_but_not_pause_it_and_the_analyst_is_told(team, use):
    use()
    code = night_campaign(team)
    launch(team.client, code)
    log_in(team.client, "maya@example.com")

    paused = team.client.post(run_url(path="/pause", code=code))
    stopped = team.client.post(
        run_url(path="/stop", code=code), json={"reason": "The agent answers slowly."}
    )

    assert paused.status_code == 403
    assert stopped.status_code == 200
    assert (stopped.json()["status"], stopped.json()["ended_by"]) == ("stopped", "Maya")
    told = notifications(team.db, "arif@example.com", "campaign_run_completed")
    assert told == [
        "Campaign run R-002-1 of Night assessment against Payments Operations Agent was stopped. "
        "Stopped by Maya: The agent answers slowly."
    ]
    assert not notifications(team.db, "maya@example.com", "campaign_run_completed")


def test_a_run_that_has_ended_cant_be_paused_resumed_or_stopped(team, use):
    use(attempts=1)
    launch(team.client)

    for action in ("/pause", "/resume", "/stop"):
        assert team.client.post(run_url(path=action)).status_code == 409


def test_a_run_whose_window_closed_while_paused_ends_instead_of_resuming(team, use):
    arif = membership_of(team.db, "arif@example.com")
    team.client.post(
        CAMPAIGNS,
        json=campaign(
            team.agent.id,
            name="Daytime assessment",
            attempt_budget=10,
            request_rate=20,
            window_start=clock(timedelta(hours=-1)),
            window_end=clock(timedelta(hours=1)),
            time_zone="UTC",
        ),
    )

    def pause_and_let_the_window_close(run, attempt):
        runs.pause(team.db, arif, "C-002", 1)
        team.db.execute(
            update(CampaignRun).values(window_ends_at=runs.lifecycle.now() - timedelta(seconds=1))
        )
        team.db.commit()

    use(StubSender(during=pause_and_let_the_window_close))
    assert launch(team.client, "C-002").json()["status"] == "paused"

    body = team.client.post(run_url(path="/resume", code="C-002")).json()

    assert (body["status"], body["end_reason"]) == ("completed", "time_window_ended")
    assert body["status_message"] == (
        "The time window ended while the run was paused, so it ended instead of resuming."
    )


def test_a_resume_that_cant_be_queued_leaves_the_run_paused(team, use, monkeypatch):
    arif = membership_of(team.db, "arif@example.com")
    use(StubSender(during=lambda run, attempt: runs.pause(team.db, arif, "C-001", 1)))
    launch(team.client)
    monkeypatch.setattr(get_settings(), "run_jobs_inline", False)

    def down(*args, **kwargs):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(celery_app, "send_task", down)

    response = team.client.post(run_url(path="/resume"))

    assert (response.status_code, response.json()["error"]["code"]) == (503, "queue_unavailable")
    assert team.client.get(run_url()).json()["status"] == "paused"
    assert jobs.DEFERRED == []
