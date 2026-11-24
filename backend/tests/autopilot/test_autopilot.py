"""The autopilot: one assessment from the threat model to the remediation proposals.

Nothing here is attack content and nothing reaches a target: the campaign run is created by the
real launch, but its job stays deferred (the workers are not running in a test), so each test moves
the run along by hand, and the model of the threat model job is never called.
"""

import uuid

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.models import Organization
from app.modules.autopilot import service
from app.modules.autopilot.models import AutopilotRun, AutopilotStatus, Stage, WaitingFor
from app.modules.m02_targets.models import ProfileStatus, TargetProfile
from app.modules.m03_threat_models.models import (
    Origin,
    ThreatModel,
    ThreatModelJob,
    ThreatModelStatus,
)
from app.modules.m05_campaigns.models import ApprovalStatus, Campaign, CampaignRun, RunStatus
from app.workers import jobs
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import membership_of
from tests.m05_campaigns.conftest import team  # noqa: F401
from tests.m05_campaigns.test_campaigns import add_target

URL = "/api/v1/autopilot"


@pytest.fixture
def ready(team, monkeypatch):  # noqa: F811
    """Arif's bank has a verified target whose profile is reviewed. Jobs that a worker would do
    are recorded, not done."""
    team.db.add(TargetProfile(target_id=team.agent.id, status=ProfileStatus.REVIEWED, version=1))
    team.db.commit()
    # A worker is not running: the run stays queued until a test says what became of it
    monkeypatch.setattr(jobs, "start", lambda db, name, *args, **options: True)
    asked: list = []
    monkeypatch.setattr(
        service.threat_models,
        "request",
        lambda db, target, trigger, requested_by: (
            asked.append(target.id) or ThreatModelJob(target_id=target.id)
        ),
    )
    requested: list = []
    monkeypatch.setattr(
        service.remediations,
        "request",
        lambda db, finding, requested_by: requested.append(finding.code),
    )
    team.asked, team.requested = asked, requested
    return team


def approve_threat_model(t, version: int = 1) -> ThreatModel:
    model = ThreatModel(
        organization_id=t.org,
        target_id=t.agent.id,
        version=version,
        status=ThreatModelStatus.APPROVED,
        origin=Origin.GENERATED,
    )
    t.db.add(model)
    t.db.commit()
    return model


def start(t, target_id=None):
    return t.client.post(URL, json={"target_id": str(target_id or t.agent.id)})


def refresh(t, run_id: str) -> dict:
    response = t.client.post(f"{URL}/{run_id}/refresh")
    assert response.status_code == 200, response.text
    return response.json()


def test_the_plan_says_what_it_would_do_and_cost(ready):
    body = ready.client.get(f"{URL}/plan", params={"target_id": str(ready.agent.id)}).json()
    assert body["can_start"] and body["reason"] is None
    assert body["tests"] > 0 and body["repetitions"] == 3
    assert body["attempt_budget"] >= body["tests"]
    assert body["request_rate"] <= ready.agent.max_request_rate
    assert "suites" not in body  # an internal detail


def test_it_goes_from_the_check_to_the_run_with_an_approved_threat_model(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    # The start does the first step; each refresh does the next one
    for _ in range(4):
        run = refresh(ready, run["id"])
    assert run["stage"] == Stage.RUN
    assert run["campaign_code"] == "C-002"  # the test bank already has C-001
    assert run["run_number"] == 1
    campaign = ready.db.scalar(select(Campaign).where(Campaign.number == 2))
    assert campaign.adaptive_agent is False  # the adaptive agent is never switched on for a person
    assert campaign.repetitions == 3
    assert campaign.request_rate <= ready.agent.max_request_rate


def test_when_the_run_has_ended_it_finishes_and_applies_nothing(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    for _ in range(4):
        run = refresh(ready, run["id"])
    ready.db.execute(
        CampaignRun.__table__.update().values(
            status=RunStatus.COMPLETED, attempts_planned=5, attempts_sent=5
        )
    )
    ready.db.commit()
    run = refresh(ready, run["id"])
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.COMPLETED and run["stage"] == Stage.DONE
    assert run["summary"]["findings"] == 0
    assert "nothing is applied" in run["message"]
    actions = set(ready.db.scalars(select(AuditLogEntry.action)))
    assert {"autopilot.started", "autopilot.completed"} <= actions


def test_it_asks_for_a_threat_model_when_there_is_none_and_waits_for_the_approval(ready):
    run = start(ready).json()
    run = refresh(ready, run["id"])
    assert run["stage"] == Stage.THREAT_MODEL and run["status"] == AutopilotStatus.RUNNING
    assert ready.asked == [ready.agent.id]
    # The job has made a draft: a person has to approve it
    ready.db.add(
        ThreatModel(
            organization_id=ready.org,
            target_id=ready.agent.id,
            version=1,
            status=ThreatModelStatus.DRAFT,
            origin=Origin.GENERATED,
        )
    )
    ready.db.commit()
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.WAITING
    assert run["waiting_for"] == WaitingFor.APPROVE_THREAT_MODEL
    assert ready.db.scalar(select(Campaign).where(Campaign.number == 2)) is None
    # It is approved by a person, and the autopilot goes on by itself
    ready.db.execute(ThreatModel.__table__.update().values(status=ThreatModelStatus.APPROVED))
    ready.db.commit()
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.RUNNING and run["stage"] == Stage.CAMPAIGN


def test_it_never_approves_the_scope_of_a_campaign_for_anyone(ready):
    ready.db.execute(Organization.__table__.update().values(requires_scope_approval=True))
    ready.db.commit()
    approve_threat_model(ready)
    run = start(ready).json()
    for _ in range(4):
        run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.WAITING
    assert run["waiting_for"] == WaitingFor.APPROVE_SCOPE
    campaign = ready.db.scalar(select(Campaign).where(Campaign.number == 2))
    assert campaign.approval_status == ApprovalStatus.AWAITING_APPROVAL
    assert (
        ready.db.scalar(select(CampaignRun).where(CampaignRun.campaign_id == campaign.id)) is None
    )
    # A Security Manager approves it, and the run is launched
    ready.db.execute(
        Campaign.__table__.update()
        .where(Campaign.id == campaign.id)
        .values(approval_status=ApprovalStatus.APPROVED)
    )
    ready.db.commit()
    ready.db.expire_all()  # the API and the workers each read the database afresh
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.RUNNING and run["run_number"] == 1


def test_a_profile_that_is_not_reviewed_makes_it_wait(ready):
    ready.db.execute(TargetProfile.__table__.update().values(status=ProfileStatus.READY))
    ready.db.commit()
    run = start(ready).json()
    assert run["status"] == AutopilotStatus.WAITING
    assert run["waiting_for"] == WaitingFor.REVIEW_PROFILE


def test_only_a_verified_target_is_assessed(ready):
    other = add_target(ready.db, ready.org, name="Not verified", status="unverified")
    ready.db.commit()
    response = start(ready, other.id)
    assert response.status_code == 409 and response.json()["error"]["code"] == "target_not_testable"
    plan = ready.client.get(f"{URL}/plan", params={"target_id": str(other.id)}).json()
    assert plan["can_start"] is False and "Verify" in plan["reason"]


def test_a_target_has_one_assessment_at_a_time(ready):
    approve_threat_model(ready)
    assert start(ready).status_code == 201
    again = start(ready)
    assert again.status_code == 409 and again.json()["error"]["code"] == "autopilot_active"


def test_only_a_security_analyst_starts_it(ready):
    log_in(ready.client, "maya@example.com")  # a target owner
    assert start(ready).status_code == 403
    log_in(ready.client, "sofia@example.com")  # a security manager
    assert start(ready).status_code == 403


def test_stopping_it_stops_the_run_too(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    for _ in range(4):
        run = refresh(ready, run["id"])
    assert run["can_stop"]
    stopped = ready.client.post(f"{URL}/{run['id']}/stop")
    assert stopped.status_code == 200 and stopped.json()["status"] == AutopilotStatus.STOPPED
    campaign_run = ready.db.scalar(select(CampaignRun).order_by(CampaignRun.created_at.desc()))
    ready.db.refresh(campaign_run)
    assert campaign_run.status == RunStatus.STOPPED
    assert ready.client.post(f"{URL}/{run['id']}/stop").status_code == 409


def test_it_stops_when_the_person_who_started_it_can_no_longer_act(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    member = membership_of(ready.db, "arif@example.com")
    member.status = "suspended"
    ready.db.commit()
    assert service.advance(ready.db, uuid.UUID(run["id"])) is True
    row = ready.db.get(AutopilotRun, uuid.UUID(run["id"]))
    assert row.status == AutopilotStatus.FAILED
    assert "no longer act" in row.message


def test_an_administrator_of_the_organization_can_read_it_but_not_stop_it(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    log_in(ready.client, "tom@example.com")
    seen = ready.client.get(f"{URL}/{run['id']}").json()
    assert seen["code"] == run["code"] and seen["can_stop"] is False


def test_it_drafts_proposals_for_the_most_severe_findings_only(ready, monkeypatch):
    from types import SimpleNamespace

    severities = ["low", "critical", "medium", "high", "low", "high", "medium"]
    fakes = [
        SimpleNamespace(id=uuid.uuid4(), code=f"F-{n:03d}", severity=s, number=n)
        for n, s in enumerate(severities, start=1)
    ]
    monkeypatch.setattr(
        service,
        "_findings_of",
        lambda db, run: sorted(
            fakes, key=lambda f: ["critical", "high", "medium", "low"].index(f.severity)
        ),
    )
    approve_threat_model(ready)
    run = start(ready).json()
    for _ in range(4):
        run = refresh(ready, run["id"])
    ready.db.execute(
        CampaignRun.__table__.update().values(
            status=RunStatus.COMPLETED, attempts_planned=5, attempts_sent=5
        )
    )
    ready.db.commit()
    run = refresh(ready, run["id"])
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.COMPLETED
    assert run["summary"]["findings"] == 7
    assert run["summary"]["by_severity"] == {"low": 2, "critical": 1, "medium": 2, "high": 2}
    # one proposal per finding, at most five, the most severe first
    assert ready.requested == ["F-002", "F-004", "F-006", "F-003", "F-007"]


def test_a_run_that_was_stopped_ends_the_autopilot_without_drafting_anything(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    for _ in range(4):
        run = refresh(ready, run["id"])
    ready.db.execute(CampaignRun.__table__.update().values(status=RunStatus.STOPPED))
    ready.db.commit()
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.STOPPED and "stopped" in run["message"]
    assert ready.requested == []


def test_the_plan_is_kept_even_when_the_judge_has_a_measured_cost(ready, monkeypatch):
    from decimal import Decimal

    monkeypatch.setattr(
        service.campaigns, "cost_per_judged_attempt", lambda db, org: Decimal("0.01")
    )
    approve_threat_model(ready)
    plan = ready.client.get(f"{URL}/plan", params={"target_id": str(ready.agent.id)}).json()
    assert plan["llm_cost"]["low_usd"] is not None
    run = start(ready)
    assert run.status_code == 201
    assert run.json()["plan"]["llm_cost"]["low_usd"] == plan["llm_cost"]["low_usd"]


def test_the_page_can_read_how_far_the_run_is_and_what_it_found(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    assert run["progress"]["run_status"] is None and run["progress"]["attempts_sent"] == 0
    for _ in range(4):
        run = refresh(ready, run["id"])
    assert run["progress"]["run_status"] == RunStatus.QUEUED
    assert run["progress"]["attempt_budget"] == run["plan"]["attempt_budget"]
    ready.db.execute(
        CampaignRun.__table__.update().values(status=RunStatus.RUNNING, attempts_sent=7)
    )
    ready.db.commit()
    ready.db.expire_all()
    seen = ready.client.get(f"{URL}/{run['id']}").json()["progress"]
    assert seen["run_status"] == RunStatus.RUNNING and seen["attempts_sent"] == 7
    assert seen["findings"] == 0 and seen["proposals_total"] == 0


def test_a_target_without_a_profile_is_mapped_once_and_then_the_person_reviews_it(
    ready, monkeypatch
):
    mapped: list = []
    monkeypatch.setattr(
        service.target_profiles,
        "start_mapping",
        lambda db, target, requested_by=None: mapped.append(target.id),
    )
    ready.db.execute(TargetProfile.__table__.delete())
    ready.db.commit()
    run = start(ready).json()
    assert mapped == [ready.agent.id]
    assert run["status"] == AutopilotStatus.RUNNING and "Mapping" in run["message"]
    for _ in range(3):  # a refresh while the mapping job is out does not start a second one
        run = refresh(ready, run["id"])
    assert mapped == [ready.agent.id]
    # The mapping has finished: the profile is ready, and a person reviews it
    ready.db.add(TargetProfile(target_id=ready.agent.id, status=ProfileStatus.READY, version=1))
    ready.db.commit()
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.WAITING
    assert run["waiting_for"] == WaitingFor.REVIEW_PROFILE and "mapped" in run["message"]
    # Saved as reviewed by the person: it goes on by itself
    ready.db.execute(TargetProfile.__table__.update().values(status=ProfileStatus.REVIEWED))
    ready.db.commit()
    ready.db.expire_all()
    run = refresh(ready, run["id"])
    assert run["stage"] == Stage.THREAT_MODEL


def test_the_plan_says_whether_the_profile_still_has_to_be_reviewed(ready):
    plan = ready.client.get(f"{URL}/plan", params={"target_id": str(ready.agent.id)}).json()
    assert plan["has_reviewed_profile"] is True
    ready.db.execute(TargetProfile.__table__.update().values(status=ProfileStatus.READY))
    ready.db.commit()
    ready.db.expire_all()
    plan = ready.client.get(f"{URL}/plan", params={"target_id": str(ready.agent.id)}).json()
    assert plan["has_reviewed_profile"] is False


def test_a_run_that_could_send_nothing_is_not_reported_as_a_clean_assessment(ready):
    approve_threat_model(ready)
    run = start(ready).json()
    for _ in range(4):
        run = refresh(ready, run["id"])
    # The run ended, but every test was skipped: nothing was planned or sent
    ready.db.execute(CampaignRun.__table__.update().values(status=RunStatus.COMPLETED))
    ready.db.commit()
    run = refresh(ready, run["id"])
    assert run["status"] == AutopilotStatus.FAILED
    assert "could not send a single test" in run["message"]
    assert ready.requested == []
