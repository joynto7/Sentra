"""Tests for FR-4.1: browsing, searching and filtering the test catalogue (UC-4.1)."""

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
    by_atlas = catalogue.get(URL, params={"search": "AML.T0056"}).json()

    assert by_name["items"][0]["code"] == "PI-IND-014"
    assert {item["category"] for item in by_atlas["items"]} == {"LLM07"}


def test_facets_count_the_options_of_each_filter(catalogue):
    body = catalogue.get(URL, params={"category": "LLM01"}).json()

    # The category counts ignore the category filter itself, so every category is listed.
    assert body["facets"]["category"]["LLM02"] > 0
    # The other counts only include LLM01 tests.
    assert sum(body["facets"]["origin"].values()) == body["total"]


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
