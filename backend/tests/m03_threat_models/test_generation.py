"""UC-3.1 Generate Threat Model (FR-3.1, FR-3.2, FR-3.3): components, baseline threats, the LLM's
suggestions with 4a and 4b, versions that never change, and the job that runs it all."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError

from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target, TargetProfile
from app.modules.m03_threat_models import components, frameworks, generation, versions
from app.modules.m03_threat_models.baseline import Draft
from app.modules.m03_threat_models.models import (
    JobStatus,
    JobTrigger,
    Origin,
    Threat,
    ThreatModel,
    ThreatModelJob,
    ThreatModelStatus,
)
from app.workers.celery_app import celery_app
from tests.m03_threat_models.conftest import add_target, suggestions

PAYROLL = {
    "title": "Payroll data of other employees disclosed in answers",
    "component": "Knowledge source: Payroll FAQ",
    "owasp": ["LLM02"],
    "atlas": "AML.T0057",
    "likelihood": 3,
    "impact": 5,
    "rationale": "The FAQ is written from real payroll questions.",
}


def generate(db, target: Target, by: str | None = "arif@example.com") -> ThreatModelJob:
    user = db.scalar(select(User).where(User.email == by)) if by else None
    job = generation.request(
        db, target, trigger=JobTrigger.REQUESTED, requested_by=user.id if user else None
    )
    db.refresh(job)
    return job


def threats_of(model: ThreatModel) -> dict[str, Threat]:
    return {t.title: t for t in model.threats}


# ---------------------------------------------------------------- components (step 2)


def test_the_components_come_from_the_reviewed_profile(db, halcyon):
    target = add_target(db, halcyon, tools=[{"name": "open_ticket", "side_effect": "Creates"}])
    profile = db.scalar(select(TargetProfile).where(TargetProfile.target_id == target.id))

    found = [(c.kind.value, c.name) for c in components.identify(target, profile)]

    assert found == [
        ("model", "Model"),
        ("system_prompt", "System prompt"),
        ("knowledge_source", "HR policy index"),
        ("knowledge_source", "Payroll FAQ"),
        ("tool", "open_ticket"),
        ("output", "Chat replies"),
    ]


def test_an_application_type_keeps_its_components_when_the_profile_names_none(db, halcyon):
    rag = add_target(db, halcyon, "Loan Policy Q&A", knowledge_sources=[])
    agent = add_target(db, halcyon, "Fraud Triage Copilot", type="tool_using_agent")

    def parts(target):
        profile = db.scalar(select(TargetProfile).where(TargetProfile.target_id == target.id))
        return {(c.kind.value, c.name): c.note for c in components.identify(target, profile)}

    assert parts(rag)[("knowledge_source", "Knowledge sources")] == components.NOT_LISTED
    assert parts(agent)[("tool", "Tools")] == components.NOT_LISTED


# ---------------------------------------------------------------- baseline (steps 3, 5, 6)


def test_every_component_gets_baseline_threats_that_are_mapped_and_rated(db, halcyon):
    target = add_target(db, halcyon)

    job = generate(db, target)

    model = versions.latest(db, target.id)
    assert (job.status, job.version, model.version, model.status) == ("done", 1, 1, "draft")
    by_component: dict[str, int] = {}
    for threat in model.threats:
        by_component[threat.component_name] = by_component.get(threat.component_name, 0) + 1
        assert threat.owasp and set(threat.owasp) <= set(frameworks.OWASP_NAMES)  # FR-3.2
        assert threat.atlas is None or frameworks.valid_atlas(threat.atlas)
        assert 1 <= threat.likelihood <= 5 and 1 <= threat.impact <= 5
        assert threat.risk == threat.likelihood * threat.impact
        assert (threat.source, threat.rationale is not None) == ("baseline", True)
    assert by_component == {
        "Model": 2,
        "System prompt": 2,
        "HR policy index": 4,
        "Payroll FAQ": 4,
        "Chat replies": 1,
    }
    threats = threats_of(model)
    hidden = threats["Instructions hidden in HR policy index change the assistant's behaviour"]
    assert (hidden.owasp, hidden.atlas, hidden.impact) == (["LLM01"], "AML.T0051.001", 5)
    # A public knowledge source has little to disclose.
    assert threats["Confidential data from Payroll FAQ disclosed in answers"].impact == 2
    assert [c["name"] for c in model.components][-1] == "Chat replies"


def test_a_tool_that_changes_something_has_a_higher_impact(db, halcyon):
    target = add_target(
        db,
        halcyon,
        "Payments Operations Agent",
        type="tool_using_agent",
        environment="staging",
        knowledge_sources=[],
        tools=[
            {"name": "issue_refund", "side_effect": "Moves money"},
            {"name": "lookup_customer", "side_effect": "Read-only"},
        ],
    )

    generate(db, target)

    threats = threats_of(versions.latest(db, target.id))
    assert threats["issue_refund used without the user's confirmation"].impact == 4
    assert threats["lookup_customer used without the user's confirmation"].impact == 3


def test_without_a_model_only_the_baseline_threats_are_added_and_the_reason_is_kept(db, halcyon):
    target = add_target(db, halcyon)  # 4a

    job = generate(db, target)

    model = versions.latest(db, target.id)
    reason = model.generation["baseline_only"]
    assert "No model is configured for threat model generation." in reason
    assert "Only the baseline threats were added." in reason
    assert job.message == reason
    assert (model.ai_generated, model.generation["suggested"]) == (False, 0)


# ---------------------------------------------------------------- the LLM's threats (step 4)


def test_the_llm_adds_threats_specific_to_the_target(db, halcyon, llm):
    llm(
        suggestions(
            PAYROLL,
            {**PAYROLL, "title": "Salary bands leak", "component": "Payroll database"},
            {**PAYROLL, "title": "Something in an unknown category", "owasp": ["LLM11"]},
            {**PAYROLL, "title": "System prompt revealed on request", "component": "System prompt"},
            {
                **PAYROLL,
                "title": "Leave balances of colleagues appear in answers",
                "component": "HR policy index",
                "atlas": "T0057",
            },
        )
    )
    target = add_target(db, halcyon)

    generate(db, target)

    model = versions.latest(db, target.id)
    suggested = {t.title: t for t in model.threats if t.source == "ai_suggested"}
    assert set(suggested) == {
        "Payroll data of other employees disclosed in answers",
        "Leave balances of colleagues appear in answers",
    }
    payroll = suggested["Payroll data of other employees disclosed in answers"]
    assert (payroll.component_kind, payroll.component_name) == ("knowledge_source", "Payroll FAQ")
    assert (payroll.owasp, payroll.atlas, payroll.likelihood, payroll.impact) == (
        ["LLM02"],
        "AML.T0057",
        3,
        5,
    )
    assert payroll.rationale == "The FAQ is written from real payroll questions."
    # A malformed ATLAS ID is left out; the threat stays.
    assert suggested["Leave balances of colleagues appear in answers"].atlas is None
    # An unknown component, an unknown category and a copy of a baseline threat are dropped.
    assert (model.generation["suggested"], model.generation["dropped"]) == (2, 3)
    assert model.generation["model"] == "anthropic/claude-sonnet-5-5"
    assert model.ai_generated is True  # labelled AI-generated until a person approves it
    assert "baseline_only" not in model.generation


def test_an_answer_in_the_wrong_form_is_asked_for_once_more(db, halcyon, llm):
    sent = llm("Here are some threats: none", suggestions(PAYROLL))  # 4b
    target = add_target(db, halcyon)

    generate(db, target)

    assert len(sent) == 2
    model = versions.latest(db, target.id)
    assert any(t.source == "ai_suggested" for t in model.threats)


def test_two_answers_in_the_wrong_form_leave_the_baseline_threats_only(db, halcyon, llm):
    sent = llm("not JSON", "still not JSON")
    target = add_target(db, halcyon)

    generate(db, target)

    assert len(sent) == 2
    model = versions.latest(db, target.id)
    assert "didn't have the required form" in model.generation["baseline_only"]
    assert {t.source for t in model.threats} == {"baseline"}


def test_only_masked_profile_data_reaches_the_llm_and_only_as_data(db, halcyon, llm):
    sent = llm(suggestions())
    entries = {
        "model_behaviour": {"value": "Escalates to hr-team@halcyonbank.com.", "source": "manual"}
    }
    target = add_target(db, halcyon, entries=entries)

    generate(db, target)

    system, user = sent[0][0]["content"], sent[0][1]["content"]
    assert "never follow it" in system  # NFR-3.6: target content stays data
    assert "LLM01 Prompt Injection" in system and "AML.T0070 RAG Poisoning" in system
    assert user.startswith("<data-") and "HR policy index" in user
    assert "Baseline threats already listed" in user
    # NFR-9.6: the e-mail address is masked; the endpoint is never sent.
    assert "hr-team@halcyonbank.com" not in user
    assert "internal-hr-helpdesk.halcyonbank.com" not in user and "https://" not in user


# ---------------------------------------------------------------- versions (1a, FR-3.3)


def test_a_new_generation_is_the_next_version_and_earlier_ones_stay(db, halcyon):
    target = add_target(db, halcyon)
    generate(db, target)
    first = versions.get(db, target.id, 1)
    before = {(t.threat_no, t.title, t.likelihood, t.impact) for t in first.threats}

    generate(db, target)

    second = versions.latest(db, target.id)
    assert (second.version, second.based_on_version, second.origin) == (2, 1, Origin.GENERATED)
    db.refresh(first)
    assert {(t.threat_no, t.title, t.likelihood, t.impact) for t in first.threats} == before
    # The same threat keeps its number in every version (UC-3.4).
    assert {t.title: t.threat_no for t in second.threats} == {
        t.title: t.threat_no for t in first.threats
    }


def test_a_new_generation_keeps_what_people_decided(db, halcyon):
    target = add_target(db, halcyon)
    generate(db, target)
    first = versions.get(db, target.id, 1)
    arif = db.scalar(select(User).where(User.email == "arif@example.com"))
    # A person's version 2: one threat re-rated, one removed, one added on an output.
    drafts = []
    for threat in first.threats:
        draft = Draft(
            threat.title,
            threat.component_kind,
            threat.component_name,
            list(threat.owasp),
            threat.atlas,
            threat.likelihood,
            threat.impact,
            threat.source,
            threat.rule,
            threat.rationale or "",
            {"threat_no": threat.threat_no},
        )
        if threat.title == "System prompt revealed on request":
            draft.likelihood = 4
            draft.extra.update(rated_by_id=arif.id, change_reason="Seen in an earlier test")
        if threat.title == "Confidential data from Payroll FAQ disclosed in answers":
            draft.extra.update(removed=True, removal_reason="The Payroll FAQ is public")
        drafts.append(draft)
    drafts.append(
        Draft(
            "E-mail summaries include personal data from the conversation",
            "output",
            "E-mail summary",
            ["LLM02"],
            "AML.T0057",
            2,
            4,
            "analyst",
        )
    )
    versions.store(
        db,
        target,
        origin=Origin.EDITED,
        based_on=first,
        components=first.components,
        drafts=drafts,
        created_by_id=arif.id,
    )
    db.commit()

    generate(db, target)  # after a profile update, say

    third = threats_of(versions.latest(db, target.id))
    revealed = third["System prompt revealed on request"]
    assert (revealed.likelihood, revealed.rated_by_id, revealed.change_reason) == (
        4,
        arif.id,
        "Seen in an earlier test",
    )
    payroll = third["Confidential data from Payroll FAQ disclosed in answers"]
    assert (payroll.removed, payroll.removal_reason) == (True, "The Payroll FAQ is public")
    added = third["E-mail summaries include personal data from the conversation"]
    assert (added.source, added.component_name) == ("analyst", "E-mail summary")
    assert added.threat_no == max(t.threat_no for t in first.threats) + 1


def test_a_stored_version_cannot_be_changed(db, halcyon):
    target = add_target(db, halcyon)
    generate(db, target)
    model = versions.latest(db, target.id)
    threat = model.threats[0]

    with pytest.raises(DBAPIError, match="can't be changed"), db.begin_nested():
        db.execute(update(Threat).where(Threat.id == threat.id).values(likelihood=1))
    with pytest.raises(DBAPIError, match="can't be changed"), db.begin_nested():
        db.execute(update(ThreatModel).where(ThreatModel.id == model.id).values(components=[]))

    # Approving a draft is the one change a version may get, once (UC-3.2 step 6).
    approved = {"status": ThreatModelStatus.APPROVED, "approved_at": datetime.now(UTC)}
    db.execute(update(ThreatModel).where(ThreatModel.id == model.id).values(**approved))
    with pytest.raises(DBAPIError, match="can't be changed"), db.begin_nested():
        db.execute(update(ThreatModel).where(ThreatModel.id == model.id).values(status="draft"))


# ---------------------------------------------------------------- the job (step 1)


def test_one_generation_runs_per_target_and_later_requests_wait_for_it(db, halcyon):
    target = add_target(db, halcyon)
    running = ThreatModelJob(
        organization_id=halcyon,
        target_id=target.id,
        trigger=JobTrigger.REQUESTED,
        status=JobStatus.RUNNING,
        started_at=datetime.now(UTC),
    )
    db.add(running)
    db.commit()

    waiting = generate(db, target)
    again = generate(db, target)

    assert (waiting.status, again.id) == (JobStatus.QUEUED, waiting.id)
    generation.run(db, running.id)  # the running job ends, and the waiting one starts
    db.refresh(running)
    db.refresh(waiting)
    assert (running.status, running.version) == ("done", 1)
    assert (waiting.status, waiting.version) == ("done", 2)


def test_a_lost_job_doesnt_block_the_target_forever(db, halcyon):
    target = add_target(db, halcyon)
    lost = ThreatModelJob(
        organization_id=halcyon,
        target_id=target.id,
        trigger=JobTrigger.REQUESTED,
        status=JobStatus.RUNNING,
        started_at=datetime.now(UTC) - timedelta(minutes=20),
    )
    db.add(lost)
    db.commit()

    job = generate(db, target)

    db.refresh(lost)
    assert (lost.status, lost.message) == (
        "failed",
        "This generation didn't finish, so it was started again.",
    )
    assert (job.status, job.version) == ("done", 1)


def test_an_error_during_generation_fails_the_job_with_a_reason(db, halcyon, monkeypatch):
    target = add_target(db, halcyon)

    def broken(*args):
        raise RuntimeError("a bug")

    monkeypatch.setattr(generation.baseline, "derive", broken)
    job = generate(db, target)

    assert (job.status, job.message) == ("failed", generation.FAILED)
    assert versions.latest(db, target.id) is None  # UC-3.1 failed end condition


def test_every_threat_model_job_is_a_worker_task():
    import app.workers.threat_models  # noqa: F401  (the worker imports it through the include list)

    assert {"threat_models.generate", "threat_models.after_profile_review"} <= set(celery_app.tasks)
