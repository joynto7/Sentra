"""The threat model API (Screens 25 and 26): the trigger after a profile review, preconditions,
roles, tenancy, the list, one version, and following a generation."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.modules.m01_users.models import Membership, Role, User
from app.modules.m02_targets.models import ProfileStatus, TargetStatus
from app.modules.m03_threat_models import versions
from app.modules.m03_threat_models.baseline import Draft
from app.modules.m03_threat_models.models import JobStatus, JobTrigger, ThreatModelJob
from app.modules.m09_reporting.models import Notification
from app.workers.celery_app import celery_app
from tests.m01_users.test_organizations import create, log_in, new_user
from tests.m03_threat_models.conftest import HR_SOURCES, add_target

API = "/api/v1/threat-models"


def test_a_profile_review_starts_a_new_draft_for_the_analysts(client, db, halcyon):
    target = add_target(db, halcyon, profile=ProfileStatus.READY)

    response = client.put(
        f"/api/v1/targets/{target.id}/profile",
        json={"entries": {}, "tools": [], "knowledge_sources": HR_SOURCES},
    )

    assert response.status_code == 200
    model = versions.latest(db, target.id)
    assert (model.version, model.status, model.created_by_id) == (1, "draft", None)
    assert model.generation["trigger"] == JobTrigger.PROFILE_REVIEW
    arif = db.scalar(select(User).where(User.email == "arif@example.com"))
    notice = db.scalar(select(Notification).where(Notification.event == "threat_model_ready"))
    assert notice.user_id == arif.id
    assert notice.text.startswith("Version 1 of the threat model of Internal HR Helpdesk")
    assert notice.link == f"/threat-models/{target.id}"
    entry = db.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "threat_model.generated"))
    assert (entry.actor_type, entry.item_type, entry.item_label) == (
        "sentra",
        "threat_model",
        "Internal HR Helpdesk, version 1",
    )


def test_generating_needs_a_verified_target_with_a_reviewed_profile(client, db, halcyon):
    cases = {
        "not_verified": add_target(db, halcyon, "A", status=TargetStatus.UNVERIFIED),
        "profile_not_reviewed": add_target(db, halcyon, "B", profile=ProfileStatus.READY),
        "target_archived": add_target(db, halcyon, "C", status=TargetStatus.ARCHIVED),
    }
    no_profile = add_target(db, halcyon, "D", profile=None)

    for code, target in cases.items():
        response = client.post(f"{API}/{target.id}/generate")
        assert (response.status_code, response.json()["error"]["code"]) == (409, code)
    assert client.post(f"{API}/{no_profile.id}/generate").json()["error"]["code"] == (
        "profile_not_reviewed"
    )
    assert db.scalar(select(ThreatModelJob)) is None


def test_a_request_is_followed_until_the_version_is_there(client, db, halcyon):
    target = add_target(db, halcyon)

    job = client.post(f"{API}/{target.id}/generate")

    assert job.status_code == 202
    body = client.get(f"{API}/{target.id}/jobs/{job.json()['id']}").json()
    assert (body["status"], body["version"], body["requested_by"]) == ("done", 1, "Arif")
    assert "Only the baseline threats were added." in body["message"]
    entry = db.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "threat_model.generated"))
    assert entry.actor_name == "Arif"


def test_only_a_security_analyst_may_generate_and_every_member_may_read(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")
    log_in(client, "maya@example.com")  # an AI Application Developer

    assert client.post(f"{API}/{target.id}/generate").status_code == 403
    assert client.get(f"{API}/{target.id}").status_code == 200
    assert client.get(API).json()["rows"][0]["latest"]["version"] == 1


def test_another_organization_cannot_see_a_threat_model(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")
    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    kestrel = uuid.UUID(create(client, "Kestrel Logistics").json()["id"])
    new_user(db, "lee@example.com")  # a Security Analyst of Kestrel Logistics
    lee = db.scalar(select(User.id).where(User.email == "lee@example.com"))
    db.add(Membership(user_id=lee, organization_id=kestrel, role=Role.SECURITY_ANALYST))
    db.flush()
    log_in(client, "lee@example.com")

    assert client.get(f"{API}/{target.id}").status_code == 404
    assert client.post(f"{API}/{target.id}/generate").status_code == 404
    assert client.get(API).json()["rows"] == []


def test_the_list_shows_every_target_with_its_newest_and_approved_version(client, db, halcyon):
    hr = add_target(db, halcyon)
    loans = add_target(db, halcyon, "Loan Policy Q&A")
    add_target(db, halcyon, "Fraud Triage Copilot")  # no threat model yet
    add_target(db, halcyon, "Marketing Copy Assistant", status=TargetStatus.UNVERIFIED)
    add_target(db, halcyon, "Old Chatbot", status=TargetStatus.ARCHIVED)
    for target in (hr, loans):
        client.post(f"{API}/{target.id}/generate")
    first = versions.latest(db, hr.id)
    first.status, first.approved_at = "approved", datetime.now(UTC)
    db.commit()
    client.post(f"{API}/{hr.id}/generate")  # version 2, a draft

    body = client.get(API).json()

    rows = {row["target"]["name"]: row for row in body["rows"]}
    assert list(rows) == [
        "Fraud Triage Copilot",
        "Internal HR Helpdesk",
        "Loan Policy Q&A",
        "Marketing Copy Assistant",
    ]
    hr_row = rows["Internal HR Helpdesk"]
    assert (hr_row["latest"]["version"], hr_row["latest"]["status"]) == (2, "draft")
    assert (hr_row["approved"]["version"], hr_row["latest"]["threat_count"]) == (1, 13)
    assert rows["Fraud Triage Copilot"]["latest"] is None
    assert rows["Marketing Copy Assistant"]["blocker"] == "Verify the target's ownership first."
    assert (body["drafts_to_review"], body["approved"], body["without_threat_model"]) == (2, 0, 2)


def test_a_version_shows_its_components_threats_and_framework_names(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")
    client.post(f"{API}/{target.id}/generate")

    page = client.get(f"{API}/{target.id}").json()

    assert page["target"]["host"] == "internal-hr-helpdesk.halcyonbank.com"
    assert [v["version"] for v in page["versions"]] == [2, 1]
    current = page["current"]
    assert (current["version"], current["based_on_version"], current["trigger"]) == (
        2,
        1,
        "requested",
    )
    assert {c["name"]: c["threats"] for c in current["components"]}["HR policy index"] == 4
    risks = [t["risk"] for t in current["threats"]]
    assert risks == sorted(risks, reverse=True)
    hidden = next(t for t in current["threats"] if t["title"].startswith("Instructions hidden"))
    assert hidden["owasp"] == [{"code": "LLM01", "name": "Prompt Injection", "in_scope": True}]
    assert hidden["atlas"]["name"] == "LLM Prompt Injection: Indirect"
    assert client.get(f"{API}/{target.id}?version=1").json()["current"]["version"] == 1
    missing = client.get(f"{API}/{target.id}?version=9")
    assert (missing.status_code, missing.json()["error"]["message"]) == (
        404,
        "Version 9 of this threat model doesn't exist.",
    )


def test_a_target_without_a_threat_model_says_what_to_do_first(client, db, halcyon):
    target = add_target(db, halcyon, profile=ProfileStatus.READY)

    page = client.get(f"{API}/{target.id}").json()

    assert (page["current"], page["versions"], page["blocker_code"]) == (
        None,
        [],
        "profile_not_reviewed",
    )


def test_the_page_shows_a_running_generation_and_then_a_failed_one(client, db, halcyon):
    target = add_target(db, halcyon)
    job = ThreatModelJob(
        organization_id=halcyon,
        target_id=target.id,
        trigger=JobTrigger.PROFILE_REVIEW,
        status=JobStatus.RUNNING,
        started_at=datetime.now(UTC),
    )
    db.add(job)
    db.commit()

    assert client.get(f"{API}/{target.id}").json()["job"]["status"] == "running"
    job.status, job.message = JobStatus.FAILED, "Generating the threat model failed."
    db.commit()
    shown = client.get(f"{API}/{target.id}").json()["job"]
    assert (shown["status"], shown["message"]) == ("failed", "Generating the threat model failed.")


def test_a_queue_that_cant_be_reached_fails_the_request_at_once(client, db, halcyon, monkeypatch):
    target = add_target(db, halcyon)
    monkeypatch.setattr(get_settings(), "run_jobs_inline", False)

    def down(*args, **kwargs):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(celery_app, "send_task", down)
    job = client.post(f"{API}/{target.id}/generate").json()

    assert job["status"] == "failed"
    assert "background workers can't be reached" in job["message"]


def test_an_output_that_a_person_named_is_listed_as_a_component(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")
    first = versions.latest(db, target.id)
    summary = Draft(
        "E-mail summaries include personal data from the conversation",
        "output",
        "E-mail summary",
        ["LLM02"],
        "AML.T0057",
        2,
        4,
        "analyst",
    )
    versions.store(
        db,
        target,
        origin="edited",
        based_on=first,
        components=first.components,
        drafts=[summary],
        created_by_id=None,
    )
    db.commit()

    parts = client.get(f"{API}/{target.id}").json()["current"]["components"]

    assert [(c["kind"], c["name"], c["threats"]) for c in parts if c["kind"] == "output"] == [
        ("output", "Chat replies", 0),
        ("output", "E-mail summary", 1),
    ]
