"""FR-11.1 (M11) Lab Targets: the four intentionally vulnerable applications of the Security Lab,
as the lab catalogue offers them (UC-11.1 step 1).

The applications themselves are in `lab/targets/<key>/`, each with its own synthetic data, its own
planted canary tokens and its own documented weaknesses. These tests check what Sentra holds about
them: that the catalogue names all four, addresses each in the Lab zone, offers only the ones this
deployment runs, and registers each as a target of its own kind. No lab target runs in the tests —
the stub of `test_lab_deployment.py` answers for the Lab zone.
"""

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.m02_targets.models import Target, TargetType
from app.modules.m11_lab import catalogue
from tests.m11_lab.test_lab_deployment import analyst, card, deploy, lab, zone  # noqa: F401

KEYS = ["rag-chatbot", "support-agent", "sql-agent", "document-agent"]


@pytest.fixture
def whole_zone(monkeypatch, zone):  # noqa: F811
    """This deployment runs all four lab targets, not only the RAG chatbot."""
    monkeypatch.setattr(
        get_settings(), "lab_hosts", [entry.host for entry in catalogue.CATALOGUE.values()]
    )
    return zone


def test_the_catalogue_holds_the_four_lab_targets_of_fr_11_1():
    assert list(catalogue.CATALOGUE) == KEYS


def test_every_lab_target_is_addressed_in_the_lab_zone_by_its_own_name():
    for key, entry in catalogue.CATALOGUE.items():
        assert entry.key == key
        assert entry.host == f"lab-{key}"  # the service of compose.yaml's "lab" profile
        assert entry.endpoint_url == f"http://lab-{key}:8080/v1/chat/completions"
        assert entry.memory_mb > 0 and entry.max_request_rate > 0
        assert entry.name.endswith("(lab)") and entry.about.endswith(".")


def test_a_deployment_offers_only_the_lab_targets_it_runs(monkeypatch):
    monkeypatch.setattr(get_settings(), "lab_hosts", ["lab-sql-agent", "lab-document-agent"])

    assert [entry.key for entry in catalogue.available()] == ["sql-agent", "document-agent"]


def test_the_security_lab_shows_every_lab_target_the_zone_runs(analyst, whole_zone):  # noqa: F811
    found = lab(analyst)["cards"]

    assert [found_card["key"] for found_card in found] == KEYS
    assert not any(found_card["deployed"] for found_card in found)


@pytest.mark.parametrize(
    ("key", "kind"),
    [
        ("support-agent", TargetType.TOOL_USING_AGENT),
        ("sql-agent", TargetType.TOOL_USING_AGENT),
        ("document-agent", TargetType.RAG_APPLICATION),
    ],
)
def test_each_lab_target_is_registered_as_a_target_of_its_own_kind(
    analyst,  # noqa: F811
    whole_zone,
    db,
    key,
    kind,
):
    """UC-11.1 step 4: a tool-using agent is registered as one, so that the tests chosen for it
    and its profile match what it is (FR-2.4, FR-4.4)."""
    assert deploy(analyst, key).status_code == 201  # it is added now

    entry = catalogue.entry(key)
    target = db.scalar(select(Target).where(Target.endpoint_url == entry.endpoint_url))
    assert target is not None and target.type == kind
    assert target.name == entry.name
    assert target.max_request_rate == entry.max_request_rate
    assert card(analyst, key)["deployed"] is True


def test_sentra_has_no_other_lab_target(analyst, whole_zone):  # noqa: F811
    response = deploy(analyst, "shopping-agent")

    assert response.status_code == 404
