"""Tests for FR-4.2 (declarative definitions) and FR-4.5 (versions of built-in tests)."""

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.modules.m04_tests.library import load_library, sync_built_in_library
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import TestDefinitionSpec


def valid_spec(**changes) -> dict:
    spec = {
        "code": "PI-TEST-001",
        "name": "Example test definition",
        "category": "LLM01",
        "severity": "high",
        "objective": "Checks an example objective for the schema tests.",
        "prerequisites": "The target is an example used only in tests.",
        "target_types": ["chatbot"],
        "success_condition": "The reply contains the canary token of the test.",
        "detection_methods": [{"method": "canary_token", "role": "decisive"}],
        "attempt_template": "example-template",
        "recommended_mitigation": "Example mitigation text for the schema tests.",
        "atlas": ["AML.T0051"],
    }
    spec.update(changes)
    return spec


def test_every_library_file_is_valid():
    specs = load_library()

    assert len(specs) >= 16
    assert len({s.code for s in specs}) == len(specs)


def test_library_covers_the_eight_in_scope_owasp_categories():
    categories = {s.category for s in load_library()}

    assert categories == {"LLM01", "LLM02", "LLM04", "LLM05", "LLM06", "LLM07", "LLM08", "LLM10"}


def test_schema_accepts_a_valid_definition():
    assert TestDefinitionSpec.model_validate(valid_spec()).code == "PI-TEST-001"


@pytest.mark.parametrize(
    "changes",
    [
        {"category": "LLM03"},  # outside Sentra's scope
        {"severity": "urgent"},
        {"target_types": []},
        {"detection_methods": [{"method": "llm_judge", "role": "supporting"}]},  # none decisive
        {"atlas": ["T0051"]},  # not an ATLAS technique ID
        {"code": "pi-test-1"},
        {"payload": "anything"},  # unknown fields are refused
    ],
)
def test_schema_rejects_invalid_definitions(changes):
    with pytest.raises(ValidationError):
        TestDefinitionSpec.model_validate(valid_spec(**changes))


def test_sync_adds_each_test_as_version_one(db):
    result = sync_built_in_library(db)

    assert result.added == len(load_library())
    assert db.scalar(select(TestDefinition).where(TestDefinition.code == "PI-IND-014")).version == 1


def test_sync_twice_changes_nothing(db):
    sync_built_in_library(db)

    result = sync_built_in_library(db)

    assert result.added == result.updated == 0


def test_changed_definition_gets_a_new_current_version(db):
    spec = TestDefinitionSpec.model_validate(valid_spec())
    sync_built_in_library(db, [spec])
    changed = TestDefinitionSpec.model_validate(valid_spec(severity="critical"))

    result = sync_built_in_library(db, [changed])

    rows = db.scalars(
        select(TestDefinition)
        .where(TestDefinition.code == "PI-TEST-001")
        .order_by(TestDefinition.version)
    ).all()
    assert result.updated == 1
    assert [(r.version, r.is_current, r.severity) for r in rows] == [
        (1, False, "high"),
        (2, True, "critical"),
    ]
