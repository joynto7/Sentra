"""Tests for FR-4.1: browsing, searching and filtering the test catalogue (UC-4.1)."""

from collections import Counter

import pytest

from app.modules.m04_tests.library import load_library, sync_built_in_library

URL = "/api/v1/test-definitions"


@pytest.fixture
def catalogue(logged_in_client, db):
    sync_built_in_library(db)
    return logged_in_client


def test_catalogue_requires_login(client):
    assert client.get(URL).status_code == 401


def test_catalogue_lists_every_current_test(catalogue):
    body = catalogue.get(URL, params={"page_size": 100}).json()

    assert body["total"] == len(load_library())
    first = body["items"][0]
    assert set(first) >= {"code", "name", "category", "severity", "target_types", "version"}


def test_filter_by_category_and_severity(catalogue):
    body = catalogue.get(URL, params={"category": "LLM06", "severity": "critical"}).json()

    assert [item["code"] for item in body["items"]] == ["EA-TOOL-007"]


def test_filter_by_target_type(catalogue):
    body = catalogue.get(URL, params={"target_type": "tool_using_agent", "page_size": 100}).json()

    assert body["total"] > 0
    assert all("tool_using_agent" in item["target_types"] for item in body["items"])


def test_search_by_name_code_or_atlas_technique(catalogue):
    by_name = catalogue.get(URL, params={"search": "retrieved document"}).json()
    by_atlas = catalogue.get(URL, params={"search": "AML.T0085.003"}).json()

    assert by_name["items"][0]["code"] == "PI-IND-014"
    assert {item["category"] for item in by_atlas["items"]} == {"LLM02", "LLM07"}


def test_facets_count_the_options_of_each_filter(catalogue):
    body = catalogue.get(URL, params={"category": "LLM01"}).json()

    # The category counts ignore the category filter itself, so every category is listed.
    assert body["facets"]["category"]["LLM02"] > 0
    # The other counts only include LLM01 tests.
    assert sum(body["facets"]["origin"].values()) == body["total"]


def test_the_atlas_facet_counts_each_technique_with_the_other_filters(catalogue):
    """UC-4.1 step 3: the framework mapping filter lists each MITRE ATLAS technique with the number
    of tests it would show, counted with every filter but its own (UX task 3.4)."""
    library = load_library()
    every = catalogue.get(URL, params={"page_size": 100}).json()["facets"]["atlas"]
    assert every == dict(Counter(a for test in library for a in test.atlas))
    technique = "AML.T0085.003"
    narrowed = catalogue.get(URL, params={"atlas": technique, "page_size": 100}).json()
    assert narrowed["total"] == every[technique]
    # Its own filter doesn't narrow it: the other techniques stay listed
    assert narrowed["facets"]["atlas"] == every


def test_the_catalogue_sorts_by_id_name_and_severity(catalogue):
    """Screen 29's sortable columns (UX task 3.4): IDs and names A to Z or Z to A, and the most
    severe first; ties keep the usual order, by category and then by ID."""

    def items(**params) -> list[dict]:
        return catalogue.get(URL, params={"page_size": 100, **params}).json()["items"]

    usual = [(item["category"], item["code"]) for item in items()]
    assert usual == sorted(usual)
    by_id = [item["code"] for item in items(sort="id")]
    assert by_id == sorted(by_id, key=str.lower)
    assert [item["code"] for item in items(sort="id", direction="desc")] == by_id[::-1]
    names = [item["name"].lower() for item in items(sort="name", direction="desc")]
    assert names == sorted(names, reverse=True)
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "informational": 4}
    worst = items(sort="severity", direction="desc")
    assert [rank[item["severity"]] for item in worst] == sorted(rank[i["severity"]] for i in worst)
    critical = [
        (item["category"], item["code"]) for item in worst if item["severity"] == "critical"
    ]
    assert critical == sorted(critical)  # a tie keeps the usual order
    mildest = items(sort="severity", direction="asc")
    assert rank[mildest[0]["severity"]] >= rank[mildest[-1]["severity"]]


def test_an_unknown_order_is_refused(catalogue):
    assert catalogue.get(URL, params={"sort": "owner"}).status_code == 422
    assert catalogue.get(URL, params={"direction": "up"}).status_code == 422


def test_no_matches_returns_an_empty_page(catalogue):
    body = catalogue.get(URL, params={"search": "does-not-exist"}).json()

    assert body["total"] == 0
    assert body["items"] == []


def test_paging(catalogue):
    first = catalogue.get(URL, params={"page_size": 5, "page": 1}).json()
    second = catalogue.get(URL, params={"page_size": 5, "page": 2}).json()

    assert len(first["items"]) == 5
    assert first["items"][0]["code"] != second["items"][0]["code"]


def test_coverage_lists_all_ten_categories(catalogue):
    rows = {row["category"]: row for row in catalogue.get(f"{URL}/coverage").json()}

    assert len(rows) == 10
    assert rows["LLM03"]["in_scope"] is False
    assert rows["LLM01"]["tests"] >= 1


def test_detail_shows_the_whole_definition_and_its_versions(catalogue):
    body = catalogue.get(f"{URL}/PI-IND-014").json()

    assert body["category_name"] == "Prompt Injection"
    assert body["atlas"] == ["AML.T0051.001"]
    assert body["detection_methods"][0] == {"method": "canary_token", "role": "decisive"}
    assert body["versions"][0]["version"] == 1


def test_unknown_test_returns_404(catalogue):
    response = catalogue.get(f"{URL}/XX-NONE-999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_no_built_in_test_uses_a_retired_atlas_technique():
    """MITRE ATLAS 2026.10 retired them; UC-7.4 promises identifiers that exist (NFR-8.4)."""
    from app.modules.m03_threat_models.frameworks import ATLAS_RETIRED
    from app.modules.m04_tests.library import load_library

    assert not [spec.code for spec in load_library() if set(spec.atlas) & set(ATLAS_RETIRED)]
