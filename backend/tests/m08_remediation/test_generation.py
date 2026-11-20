"""UC-8.2 Generate Remediation (FR-8.1): a confirmed finding becomes a draft proposal with its
root cause and its fixes, with the alternatives 1a, 1b, 4a, 4b and 6a."""

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m06_findings.models import FindingStatus
from app.modules.m08_remediation.models import Remediation
from app.modules.m09_reporting.models import Notification
from tests.m08_remediation.conftest import API, DOWN, data_sent, proposal


def request_proposal(client, code: str):
    return client.post(f"{API}/{code}/generate")


def test_a_confirmed_finding_becomes_a_draft_proposal_with_its_fixes(team, confirmed, model):
    sent = model(proposal())

    job = request_proposal(team.client, confirmed.code)

    assert job.status_code == 202
    assert job.json()["status"] == "done" and job.json()["version"] == 1
    body = team.client.get(f"{API}/{confirmed.code}").json()
    version = body["current"]
    assert (version["version"], version["status"], version["origin"]) == (1, "draft", "generated")
    assert version["root_cause"].startswith("The system prompt is part of the context")
    assert version["requested_by"] == "Arif"
    # NFR-9.4: it holds fixes written by a model, so it is labelled AI-generated.
    assert version["ai_generated"] is True and version["model"] == "ollama/llama3.1"
    assert [(f["position"], f["kind"]) for f in version["fixes"]] == [
        (1, "system_prompt"),
        (2, "guardrail"),
        (3, "tool_policy"),
        (4, "retrieval_isolation"),
    ]
    first = version["fixes"][0]
    assert first["kind_label"] == "Hardened system prompt"
    assert first["details"]["prompt"].startswith("Your instructions are confidential")
    assert version["fixes"][2]["details"]["tools"] == [
        {"tool": "issue_refund", "rule": "Needs approval above 100"}
    ]
    # 6a: no gateway protects the target yet, so every fix is a change in the application.
    assert {f["enforcement"] for f in version["fixes"]} == {"application"}
    assert "No Sentra Shield gateway" in version["fixes"][1]["enforcement_note"]
    assert "belongs to the application" in version["fixes"][0]["enforcement_note"]
    assert len(sent) == 1


def test_the_proposal_is_recorded_and_the_requester_is_told(team, confirmed, model):
    model(proposal())

    request_proposal(team.client, confirmed.code)

    entry = team.db.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "remediation.generated")
    )
    assert entry.summary.startswith(f"Generated version 1 of the remediation of {confirmed.code}")
    assert entry.details["fixes"] == [
        "system_prompt",
        "guardrail",
        "tool_policy",
        "retrieval_isolation",
    ]
    assert entry.actor_name == "Arif"
    note = team.db.scalar(select(Notification).where(Notification.event == "remediation_ready"))
    assert confirmed.code in note.text and "4 fixes" in note.text
    assert note.link == f"/remediation/{confirmed.code}"


def test_a_finding_that_still_needs_confirmation_gets_no_proposal(team, confirmed, model):
    """1a: a security analyst confirms the weakness first (UC-6.6)."""
    model(proposal())
    confirmed.status = FindingStatus.REQUIRES_CONFIRMATION
    team.db.commit()

    response = request_proposal(team.client, confirmed.code)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_confirmed"
    assert "confirm this finding first" in response.json()["error"]["message"]
    page = team.client.get(f"{API}/{confirmed.code}").json()
    assert page["blocker_code"] == "not_confirmed" and page["current"] is None
    assert team.db.scalars(select(Remediation)).all() == []


def test_a_closed_finding_gets_no_proposal(team, confirmed, model):
    model(proposal())
    confirmed.status = FindingStatus.FALSE_POSITIVE
    team.db.commit()

    response = request_proposal(team.client, confirmed.code)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "finding_closed"
    assert "false positive" in response.json()["error"]["message"]


def test_without_a_model_the_proposal_holds_the_mitigation_of_the_test(team, confirmed):
    """4a: no model is configured, so Sentra proposes what the test's author recommends."""
    job = request_proposal(team.client, confirmed.code)

    assert job.json()["status"] == "done"
    assert "mitigation the test recommends" in job.json()["message"]
    version = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert version["ai_generated"] is False  # nothing of it was written by a model (NFR-9.4)
    assert version["model"] is None
    assert "No model is configured" in version["mitigation_only"]
    (fix,) = version["fixes"]
    assert fix["kind"] == "code_change"
    assert fix["title"].startswith("Apply the recommended mitigation of HB-DET-")
    assert fix["details"]["steps"] == ["Nothing: this test only exercises the detection engine."]
    assert fix["enforcement"] == "application"


def test_a_provider_that_is_down_falls_back_to_the_mitigation(team, confirmed, model):
    """4a also covers a provider that can't be reached."""
    model(DOWN)

    request_proposal(team.client, confirmed.code)

    version = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert "can't be reached" in version["mitigation_only"]
    assert [f["kind"] for f in version["fixes"]] == ["code_change"]


def test_an_answer_in_the_wrong_form_is_asked_for_once_more(team, confirmed, model):
    """4b: one more request, then the mitigation alone."""
    sent = model("not json at all", proposal())

    request_proposal(team.client, confirmed.code)

    assert len(sent) == 2
    version = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert version["mitigation_only"] is None and version["ai_generated"] is True
    assert len(version["fixes"]) == 4


def test_two_answers_in_the_wrong_form_end_in_the_mitigation(team, confirmed, model):
    sent = model("still not json")

    request_proposal(team.client, confirmed.code)

    assert len(sent) == 2
    version = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert "didn't have the required form" in version["mitigation_only"]
    assert [f["kind"] for f in version["fixes"]] == ["code_change"]


def test_fixes_sentra_cant_use_are_left_out(team, confirmed, model):
    """Step 5: an unknown kind, a second fix of the same kind and a fix without its own content
    are dropped and counted."""
    model(
        proposal(
            fixes=[
                {"kind": "guardrail", "title": "Filter the answers", "rules": ["Block it"]},
                {"kind": "firewall", "title": "Something Sentra doesn't know", "rules": ["No"]},
                {"kind": "guardrail", "title": "Filter them again", "rules": ["Block it twice"]},
                {"kind": "code_change", "title": "A fix without any steps"},
            ]
        )
    )

    request_proposal(team.client, confirmed.code)

    version = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert [f["kind"] for f in version["fixes"]] == ["guardrail"]
    assert version["dropped"] == 3


def test_every_fix_dropped_leaves_the_mitigation(team, confirmed, model):
    model(proposal(fixes=[{"kind": "firewall", "title": "Not a kind Sentra knows"}]))

    request_proposal(team.client, confirmed.code)

    version = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert [f["kind"] for f in version["fixes"]] == ["code_change"]
    assert "no fix Sentra could use" in version["mitigation_only"]
    assert version["dropped"] == 1


def test_the_model_is_sent_the_behaviour_but_no_payload_and_no_token(team, confirmed, model):
    """Step 3 with quality requirement 4: the finding, its evidence, the profile and the test's
    mitigation — masked, as data (NFR-3.6, NFR-9.6). Not the attempt's own message, and not the
    target's endpoint, credentials or canary token."""
    sent = model(proposal())

    request_proposal(team.client, confirmed.code)

    data = data_sent(sent)
    assert "Observed behaviour:" in data and "Recommended mitigation of its author:" in data
    assert "The application answered:" in data
    assert "Sentra confirmed it with: canary_token" in data
    assert "ATTEMPT-1" not in data  # the payload is not needed to write a fix
    assert "SENTRA-SYS-" not in data  # the canary token is masked in the evidence
    assert team.agent.endpoint_url not in data
    assert "my instructions say" in data  # the masked reply itself is there
    instructions = sent[-1]["messages"][0]["content"]
    assert "never give an attack payload" in instructions


def test_a_second_request_is_a_revision_that_knows_the_first_proposal(team, confirmed, model):
    """1b: a revision, after a rejection or a failed retest, also sends the previous proposal."""
    sent = model(proposal())
    request_proposal(team.client, confirmed.code)

    request_proposal(team.client, confirmed.code)

    body = team.client.get(f"{API}/{confirmed.code}").json()
    assert [v["version"] for v in body["versions"]] == [2, 1]
    assert body["current"]["origin"] == "revised" and body["current"]["based_on_version"] == 1
    assert "which did not settle it" in data_sent(sent)
    assert "guardrail: Filter the instructions out of the answers" in data_sent(sent)


def test_one_proposal_at_a_time_per_finding(team, confirmed, model, monkeypatch):
    """A request that comes while one runs waits for it, and the second request shares that job."""
    from app.workers import jobs

    monkeypatch.setattr(jobs, "start", lambda *args, **options: True)  # the job stays queued
    model(proposal())

    first = request_proposal(team.client, confirmed.code).json()
    second = request_proposal(team.client, confirmed.code).json()
    third = request_proposal(team.client, confirmed.code).json()

    assert first["status"] == "running"
    assert second["status"] == "queued" and second["id"] == third["id"]
    assert team.db.scalars(select(Remediation)).all() == []
