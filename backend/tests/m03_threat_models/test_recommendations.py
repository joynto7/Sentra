"""UC-3.3 Review Test Suite Recommendations (FR-3.4) and the campaign builder's use of the approved
threat model (UC-5.1 step 2, 2a; FR-3.3)."""

import uuid

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m03_threat_models import versions
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.suites import ATTEMPTS_PER_TEST, sync_built_in_suites
from app.modules.m05_campaigns.models import CampaignRun
from app.workers import jobs
from tests.m03_threat_models.conftest import add_target

API = "/api/v1/threat-models"
OUTPUT = "Model output shown as active HTML or script in Chat replies"
PROPOSAL = {
    "LLM01-PROMPT-INJECTION",
    "LLM02-SENSITIVE-INFORMATION",
    "LLM04-POISONING",
    "LLM07-SYSTEM-PROMPT",
    "LLM08-VECTOR-ACCESS",
    "LLM10-SAFE-LIMITS",
}


@pytest.fixture
def approved(client, db, halcyon):
    """The Internal HR Helpdesk (a RAG application in production) with an approved version 1,
    and the built-in tests and suites."""
    sync_built_in_library(db)
    sync_built_in_suites(db)
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")
    client.post(f"{API}/{target.id}/versions/1/approve")
    return target


def number_of(client, target, title: str) -> int:
    page = client.get(f"{API}/{target.id}").json()
    return next(t["number"] for t in page["current"]["threats"] if t["title"] == title)


def test_recommendations_need_an_approved_threat_model(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")  # a draft only

    response = client.get(f"{API}/{target.id}/recommendations")

    assert (response.status_code, response.json()["error"]["code"]) == (
        409,
        "no_approved_threat_model",
    )


def test_suites_are_recommended_by_the_risk_of_the_threats_they_address(client, approved):
    body = client.get(f"{API}/{approved.id}/recommendations").json()

    assert (body["version"]["version"], body["threats_total"], body["threats_covered"]) == (
        1,
        13,
        12,
    )
    # Step 2: by the highest risk they address, then the smaller suite first. Suites with no
    # test for a RAG application (output handling, excessive agency) aren't offered.
    assert [s["code"] for s in body["suites"]] == [
        "LLM08-VECTOR-ACCESS",
        "LLM01-PROMPT-INJECTION",
        "LLM02-SENSITIVE-INFORMATION",
        "QUICK-REGRESSION",
        "FULL-ASSESSMENT",
        "LLM04-POISONING",
        "LLM07-SYSTEM-PROMPT",
        "LLM10-SAFE-LIMITS",
    ]
    vector = body["suites"][0]
    assert (vector["tests"], vector["attempts"], vector["top_risk"]) == (
        2,
        2 * ATTEMPTS_PER_TEST,
        15,
    )
    assert [t["title"] for t in vector["threats"]] == [
        "Documents from HR policy index retrieved for users who may not see them",
        "Documents from Payroll FAQ retrieved for users who may not see them",
    ]  # quality requirement 2: each suite shows the threats it addresses, highest risk first
    # Sentra's proposal: the smallest suite for each threat; the broad suites stay optional.
    assert {s["code"] for s in body["suites"] if s["selected"]} == PROPOSAL
    assert body["selection"] is None


def test_a_threat_without_a_test_stays_listed_until_a_reason_is_recorded(client, db, approved):
    output = number_of(client, approved, OUTPUT)  # no built-in test covers LLM05 for RAG

    gaps = client.get(f"{API}/{approved.id}/recommendations").json()["gaps"]
    assert [(g["number"], g["out_of_scope"], g["accepted"]) for g in gaps] == [
        (output, False, None)
    ]
    short = client.post(f"{API}/{approved.id}/gaps", json={"version": 1, "threat": output})
    covered = client.post(
        f"{API}/{approved.id}/gaps",
        json={"version": 1, "threat": 1, "reason": "We trust the model"},
    )
    body = client.post(
        f"{API}/{approved.id}/gaps",
        json={"version": 1, "threat": output, "reason": "The chat widget escapes all HTML"},
    ).json()

    assert short.json()["error"]["details"][0]["message"] == "Give a reason for accepting the gap."
    assert covered.json()["error"]["details"][0]["message"] == (
        "A test covers this threat, so there is no gap to accept."
    )
    (gap,) = body["gaps"]  # still listed, now with the reason (quality requirement 3)
    assert (gap["accepted"]["reason"], gap["accepted"]["accepted_by"]) == (
        "The chat widget escapes all HTML",
        "Arif",
    )
    entry = db.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "threat_model.gap_accepted")
    )
    assert entry.actor_name == "Arif"


def test_a_threat_only_in_a_category_outside_application_testing_is_out_of_scope(client, approved):
    client.post(
        f"{API}/{approved.id}/versions",
        json={
            "base_version": 1,
            "add": [
                {
                    "title": "Wrong answers about leave rules mislead employees",
                    "component_kind": "model",
                    "component_name": "Model",
                    "owasp": ["LLM09"],
                    "likelihood": 3,
                    "impact": 3,
                }
            ],
        },
    )
    client.post(f"{API}/{approved.id}/versions/2/approve")

    gaps = client.get(f"{API}/{approved.id}/recommendations").json()["gaps"]

    misleading = next(g for g in gaps if g["title"].startswith("Wrong answers"))
    assert misleading["out_of_scope"] is True
    assert misleading["owasp"] == [{"code": "LLM09", "name": "Misinformation", "in_scope": False}]


def test_the_selection_becomes_the_default_for_new_campaigns(client, db, approved):
    chosen = ["LLM01-PROMPT-INJECTION", "LLM02-SENSITIVE-INFORMATION"]

    body = client.put(
        f"{API}/{approved.id}/selection", json={"version": 1, "suites": chosen}
    ).json()

    selection = body["selection"]
    assert (selection["version"], selection["suites"], selection["current"]) == (1, chosen, True)
    assert selection["saved_by"] == "Arif"
    # The threats these suites leave uncovered are recorded with the selection.
    assert len(selection["uncovered"]) == 13 - 4 - 2  # 4 prompt injection, 2 disclosure threats
    assert {s["code"] for s in body["suites"] if s["selected"]} == set(chosen)
    # UC-5.1 step 2: the campaign builder preselects them and shows the threats they cover.
    estimate = client.post(
        "/api/v1/campaigns/estimate", json={"target_id": str(approved.id), "suites": []}
    ).json()
    brief = estimate["threat_model"]
    assert (brief["version"], brief["approved_by"], brief["default_suites"]) == (1, "Arif", chosen)
    assert (brief["threats_covered"], brief["threats_total"]) == (6, 13)
    wider = client.post(
        "/api/v1/campaigns/estimate",
        json={"target_id": str(approved.id), "suites": ["FULL-ASSESSMENT"]},
    ).json()
    assert wider["threat_model"]["threats_covered"] == 12
    # FR-3.3: a new campaign records the threat model version it is based on.
    created = client.post(
        "/api/v1/campaigns",
        json={
            "name": "Monthly assessment",
            "target_id": str(approved.id),
            "suites": chosen,
            "attempt_budget": 500,
            "request_rate": 20,
        },
    )
    code = created.json()["code"]
    assert client.get(f"/api/v1/campaigns/{code}").json()["based_on_threat_model"] == 1
    entry = db.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "threat_model.selection_saved")
    )
    assert entry.details["suites"] == chosen


def test_a_run_keeps_the_threat_model_version_its_campaign_was_based_on(
    client, db, approved, monkeypatch
):
    """UC-5.3 step 4: a launch copies the campaign's threat model version onto the run, so the
    version can later name the runs that were based on it (UC-3.4 step 2, FR-3.3)."""
    created = client.post(
        "/api/v1/campaigns",
        json={
            "name": "Monthly assessment",
            "target_id": str(approved.id),
            "suites": ["LLM01-PROMPT-INJECTION"],
            "attempt_budget": 500,
            "request_rate": 20,
        },
    ).json()
    # The run's first job stays in the queue: what the launch writes is what this test is about,
    # and a test never lets anything reach a target (UC-5.3, quality requirement 5).
    monkeypatch.setattr(jobs, "start", lambda *args, **options: True)

    body = client.post(f"/api/v1/campaigns/{created['code']}/runs").json()

    assert body["versions"]["threat_model"] == 1
    version = versions.get(db, approved.id, 1)
    assert version is not None
    assert db.get(CampaignRun, uuid.UUID(body["id"])).threat_model_id == version.id
    page = client.get(f"{API}/{approved.id}").json()
    assert [(v["version"], v["runs"]) for v in page["versions"]] == [(1, 1)]
    compare = client.get(f"{API}/{approved.id}/compare?base=1&compare=1").json()
    rows = [(r["code"], r["campaign"], r["number"]) for r in compare["base_runs"]]
    assert rows == [("R-001-1", "C-001", 1)]


def test_a_selection_is_for_the_approved_version_and_suites_that_can_test_the_target(
    client, approved
):
    url = f"{API}/{approved.id}/selection"

    wrong_version = client.put(url, json={"version": 2, "suites": ["LLM01-PROMPT-INJECTION"]})
    nothing = client.put(url, json={"version": 1, "suites": []})
    unusable = client.put(url, json={"version": 1, "suites": ["LLM06-EXCESSIVE-AGENCY"]})

    assert (wrong_version.status_code, wrong_version.json()["error"]["code"]) == (
        409,
        "newer_version",
    )
    assert nothing.json()["error"]["details"][0]["message"] == "Choose at least one test suite."
    assert unusable.json()["error"]["details"][0]["message"] == (
        "Not found, archived or not for this target: LLM06-EXCESSIVE-AGENCY."
    )


def test_without_an_approved_version_the_builder_shows_no_threat_coverage(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")  # 2a: only a draft

    estimate = client.post(
        "/api/v1/campaigns/estimate", json={"target_id": str(target.id), "suites": []}
    ).json()

    assert estimate["threat_model"] is None


def test_the_list_counts_the_threats_without_a_test(client, approved):
    rows = client.get(API).json()["rows"]

    assert rows[0]["without_test"] == 1  # the active-content threat on the chat replies
