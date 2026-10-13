"""Tests for FR-4.4 (test suites) and FR-4.5 (versions): UC-4.4 and UC-4.5."""

import pytest

from app.modules.m01_users.models import Role
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.suites import ATTEMPTS_PER_TEST, load_suites, sync_built_in_suites
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m01_users.test_permissions import membership_of, organization_with
from tests.m04_tests.test_custom_tests import refund_test

URL = "/api/v1/test-suites"


@pytest.fixture
def analyst(client, db):
    """Priya, a Security Analyst of Halcyon Bank, is logged in; Maya is an AI Application
    Developer there. The built-in tests and suites are loaded."""
    sync_built_in_library(db)
    sync_built_in_suites(db)
    organization_with(
        db,
        client,
        {"priya@example.com": Role.SECURITY_ANALYST, "maya@example.com": Role.TARGET_OWNER},
    )
    return log_in(client, "priya@example.com")


def suite(**changes) -> dict:
    """The suite of Screen 32."""
    data = {
        "name": "Release regression — Loan Policy Q&A",
        "purpose": "Fast regression for the CI/CD security gate.",
        "tests": ["PI-IND-014", "SID-XACC-003", "EA-TOOL-007"],
    }
    data.update(changes)
    return data


def details(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def custom_test(client) -> str:
    return client.post("/api/v1/test-definitions", json={"definition": refund_test()}).json()[
        "code"
    ]


def orion_analyst(client, db) -> None:
    """Ravi creates Orion Health and becomes its Security Analyst."""
    new_user(db, "ravi@example.com")
    log_in(client, "ravi@example.com")
    create_organization(client, "Orion Health")
    membership_of(db, "ravi@example.com").role = Role.SECURITY_ANALYST
    db.flush()


def test_built_in_suites_are_loaded_as_version_one(analyst):
    body = analyst.get(URL).json()

    quick = next(s for s in body if s["code"] == "QUICK-REGRESSION")
    assert len(body) == len(load_suites()) == 10
    assert (quick["version"], quick["origin"], quick["test_count"]) == (1, "built_in", 8)
    assert len(quick["categories"]) == 8  # every category in Sentra's scope
    assert quick["estimated_attempts"] == 8 * ATTEMPTS_PER_TEST


def test_syncing_twice_changes_nothing(db):
    sync_built_in_library(db)
    sync_built_in_suites(db)

    result = sync_built_in_suites(db)

    assert result.added == result.updated == 0


def test_analyst_creates_a_suite_as_version_one(analyst):
    response = analyst.post(URL, json=suite())

    body = response.json()
    assert response.status_code == 201
    assert (body["code"], body["version"], body["test_count"]) == ("HB-SUITE-001", 1, 3)
    assert body["categories"] == ["LLM01", "LLM02", "LLM06"]
    assert body["estimated_attempts"] == 3 * ATTEMPTS_PER_TEST


def test_tests_for_only_some_target_types_are_flagged(analyst):
    body = analyst.post(f"{URL}/summary", json={"tests": ["PI-DIR-001", "EA-TOOL-007"]}).json()

    assert body["target_types"] == ["chatbot", "rag_application", "tool_using_agent"]
    assert body["warnings"] == [
        "1 test applies only to tool-using agents and is skipped for other target types."
    ]


def test_an_empty_suite_or_a_used_name_is_refused(analyst):
    empty = analyst.post(URL, json=suite(tests=[]))
    taken = analyst.post(URL, json=suite(name="quick regression"))  # a built-in suite's name

    assert details(empty) == {"tests": "Add at least one test. A suite can't be empty."}
    assert details(taken) == {"name": "Halcyon Bank already has a suite with this name."}


def test_retired_tests_are_skipped_and_cannot_be_added(analyst):
    code = custom_test(analyst)
    analyst.post(URL, json=suite(tests=[code, "PI-DIR-001"]))
    analyst.post(f"/api/v1/test-definitions/{code}/retire", json={"reason": "Replaced"})

    body = analyst.get(f"{URL}/HB-SUITE-001").json()
    again = analyst.post(URL, json=suite(name="Another suite", tests=[code]))

    assert body["test_count"] == 1
    assert "1 test retired: skipped in future campaign runs." in body["warnings"]
    assert [t["retired"] for t in body["tests"]] == [True, False]
    assert details(again) == {"tests": f"Retired, so it can't be added: {code}."}


def test_a_test_retired_after_joining_does_not_block_a_change(analyst):
    code = custom_test(analyst)
    analyst.post(URL, json=suite(tests=[code, "PI-DIR-001"]))
    analyst.post(f"/api/v1/test-definitions/{code}/retire", json={"reason": "Replaced"})

    response = analyst.post(
        f"{URL}/HB-SUITE-001/versions",
        json={**suite(tests=[code, "PI-DIR-001", "PI-IND-014"]), "reason": "One more test"},
    )

    assert response.status_code == 201
    assert response.json()["test_count"] == 2  # the retired test stays listed, and is skipped


def test_a_change_is_saved_as_a_new_version_and_the_old_one_stays(analyst):
    analyst.post(URL, json=suite())

    response = analyst.post(
        f"{URL}/HB-SUITE-001/versions", json={**suite(tests=["PI-IND-014"]), "reason": "RAG only"}
    )

    body = response.json()
    assert response.status_code == 201
    assert (body["version"], body["test_count"]) == (2, 1)
    assert [(v["version"], v["change_note"]) for v in body["versions"]] == [
        (2, "RAG only"),
        (1, "Initial version"),
    ]
    assert analyst.get(f"{URL}/HB-SUITE-001/versions/1").json()["test_count"] == 3


def test_a_change_needs_a_reason_a_difference_and_tests(analyst):
    analyst.post(URL, json=suite())
    path = f"{URL}/HB-SUITE-001/versions"

    no_reason = analyst.post(path, json={**suite(tests=["PI-IND-014"]), "reason": ""})
    unchanged = analyst.post(path, json={**suite(), "reason": "Same again"})
    emptied = analyst.post(path, json={**suite(tests=[]), "reason": "Remove everything"})

    assert details(no_reason) == {"reason": "Describe the reason for the change."}
    assert unchanged.json()["error"]["code"] == "unchanged"
    assert details(emptied) == {"tests": "Add at least one test. A suite can't be empty."}


def test_built_in_suites_are_read_only(analyst):
    response = analyst.post(f"{URL}/QUICK-REGRESSION/versions", json={**suite(), "reason": "Adapt"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "built_in_read_only"


def test_an_archived_suite_leaves_the_list_and_keeps_its_versions(analyst):
    analyst.post(URL, json=suite())

    body = analyst.post(f"{URL}/HB-SUITE-001/archive", json={"reason": "Replaced"}).json()

    assert (body["version"], body["status"]) == (2, "archived")
    assert "HB-SUITE-001" not in [s["code"] for s in analyst.get(URL).json()]
    assert analyst.get(f"{URL}/HB-SUITE-001/versions/1").json()["status"] == "active"


def test_suites_are_visible_only_in_their_organization(analyst, client, db):
    analyst.post(URL, json=suite())
    orion_analyst(client, db)

    assert client.get(f"{URL}/HB-SUITE-001").status_code == 404
    assert "HB-SUITE-001" not in [s["code"] for s in client.get(URL).json()]


def test_another_organizations_custom_test_cannot_be_added(analyst, client, db):
    code = custom_test(analyst)
    orion_analyst(client, db)

    response = client.post(URL, json=suite(tests=[code]))

    assert details(response) == {"tests": f"Not found: {code}."}


@pytest.mark.parametrize("email", ["maya@example.com", "tom@example.com"])
def test_only_security_analysts_build_suites(analyst, client, email):
    log_in(client, email)  # an AI Application Developer, then the Organization Administrator

    assert client.post(URL, json=suite()).status_code == 403
    assert client.get(URL).status_code == 200  # everyone may read


def test_a_test_lists_the_suites_that_include_it(analyst):
    body = analyst.get("/api/v1/test-definitions/PI-DIR-001").json()

    assert [s["code"] for s in body["suites"]] == [
        "FULL-ASSESSMENT",
        "LLM01-PROMPT-INJECTION",
        "QUICK-REGRESSION",
    ]
