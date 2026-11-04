"""Framework coverage (FR-7.4; UC-7.4 Review Framework Coverage, with 2a, 4a and 5a). Dummy values
only: the messages ATTEMPT-1 …, invented replies and fake canary tokens.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.modules.m03_threat_models.models import ThreatGapAcceptance
from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.modules.m04_tests.models import TestDefinition
from app.modules.m07_risk import coverage
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m07_risk.conftest import (
    PERSONAL_TOKEN,
    REFUND_TOOL,
    approved_threat_model,
    canary_test,
    make_test,
    plant,
    profile_for,
)
from tests.m07_risk.test_paths import knowledge_finding, tool_finding

COVERAGE = "/api/v1/risk/coverage"


def rows_of(client, **query) -> dict:
    response = client.get(COVERAGE, params=query)
    assert response.status_code == 200, response.text
    body = response.json()
    return {row["code"]: row for row in body["rows"]} | {"_body": body}


def cell_of(client, code: str, target, framework: str = "owasp") -> dict:
    response = client.get(
        f"{COVERAGE}/{code}", params={"target_id": str(target.id), "framework": framework}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_a_category_counts_as_tested_only_when_an_attempt_really_ran(team, run_with):
    """UC-7.4 steps 2-3 and quality requirement 3: the category of the test that ran is tested,
    with the run it ran in. An attempt that was planned but never sent tests nothing."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    tool_finding(team, run_with, category="LLM06")
    planned = make_test(team.db, team.org, {"rule_matching": "decisive"}, [], category="LLM05")
    run = team.db.scalars(select(CampaignRun)).first()
    team.db.add(
        Attempt(
            organization_id=team.org,
            campaign_run_id=run.id,
            attempt_no=99,
            test_definition_id=planned.id,
            test_code=planned.code,
            template="stub",
            variant=1,
            input="ATTEMPT-99",
            session_id="session-99",
        )
    )
    team.db.commit()

    rows = rows_of(team.client)

    assert rows["LLM06"]["status"] == coverage.TESTED and rows["LLM06"]["label"] == "Tested"
    (cell,) = rows["LLM06"]["cells"]
    assert cell["run"]["code"] == "R-001-1" and cell["open_findings"] == 1
    assert cell["target_name"] == "Payments Operations Agent"
    assert rows["LLM05"]["status"] != coverage.TESTED  # it was planned, never sent
    assert rows["_body"]["targets"][0]["name"] == "Payments Operations Agent"
    assert rows["_body"]["legend"][0] == {"status": "gap", "label": "Gap"}


def test_the_categories_outside_sentras_scope_are_marked_instead_of_counted_as_gaps(team):
    """2a1: LLM03 Supply Chain and LLM09 Misinformation are not part of application testing."""
    rows = rows_of(team.client)

    for code in ("LLM03", "LLM09"):
        assert rows[code]["status"] == coverage.OUT_OF_SCOPE
        assert not rows[code]["in_scope"]
        assert rows[code]["reason"] == coverage.OUT_OF_SCOPE_REASON
    assert rows["LLM01"]["in_scope"]


def test_the_threat_model_says_which_categories_apply(team):
    """UC-7.4 step 4: a category a threat names but no run tested is a gap, and the reason says
    that the threat model named it. A category the model doesn't name is a gap too while the
    library can test it for this kind of target — the state of affairs, not an inapplicable row."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    approved_threat_model(
        team.db,
        team.agent,
        ("A refund can be issued without the customer asking", "issue_refund", ["LLM06"]),
    )

    rows = rows_of(team.client)

    assert rows["LLM06"]["status"] == coverage.GAP
    assert rows["LLM06"]["reason"] == coverage.GAP_FROM_MODEL
    assert rows["LLM06"]["worst_target"] == "Payments Operations Agent"
    assert rows["LLM01"]["status"] == coverage.GAP
    assert rows["LLM01"]["reason"] == coverage.GAP_FROM_TYPE


def test_without_an_approved_threat_model_the_kind_of_target_decides(team):
    """4a1: every category the library can test for a tool-using agent is relevant, so it is a
    gap until a run has tested it."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])

    rows = rows_of(team.client)

    gaps = [code for code, row in rows.items() if code != "_body" and row["status"] == coverage.GAP]
    assert "LLM01" in gaps and rows["LLM01"]["reason"] == coverage.GAP_FROM_TYPE
    assert "LLM03" not in gaps  # out of scope, never a gap


def test_a_result_from_before_a_change_of_the_target_is_a_gap_of_its_own(team, run_with):
    """UC-7.4 step 4: tested, but not since the target's configuration changed."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    tool_finding(team, run_with, category="LLM06")
    team.agent.name = "Payments Operations Agent"  # a change of the target itself
    team.agent.updated_at = datetime.now(UTC) + timedelta(hours=1)
    team.db.commit()

    rows = rows_of(team.client)

    assert rows["LLM06"]["status"] == coverage.STALE
    assert rows["LLM06"]["label"] == "Gap" and rows["LLM06"]["reason"] == coverage.STALE_REASON
    (cell,) = rows["LLM06"]["cells"]
    assert cell["run"]["code"] == "R-001-1" and cell["changed_at"] > cell["run"]["ended_at"]


def test_a_category_that_needs_what_the_profile_does_not_list_is_not_applicable(team):
    """Screen 43: LLM08 is about embeddings, so it does not apply to a target whose profile lists
    no knowledge sources."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    approved_threat_model(team.db, team.agent, ("Model can be talked around", "Model", ["LLM01"]))

    rows = rows_of(team.client)

    assert rows["LLM08"]["status"] == coverage.NOT_APPLICABLE
    assert rows["LLM08"]["reason"] == "The Target Profile lists no knowledge sources."


def test_an_unverified_target_is_not_counted_as_a_gap(team):
    """A target that was never allowed to be tested (FR-2.3) has no gap: it says why instead."""
    team.agent.status = "unverified"
    team.db.commit()

    rows = rows_of(team.client)

    assert rows["LLM01"]["status"] == coverage.NOT_TESTABLE
    assert rows["LLM01"]["reason"] == coverage.NOT_TESTABLE_REASON


def test_the_panel_of_a_gap_names_the_threats_the_suites_and_an_accepted_reason(team):
    """UC-7.4 step 5 and 5a1: which suites cover the gap (FR-3.4), with the reason an analyst
    recorded for accepting it (UC-3.3)."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model = approved_threat_model(
        team.db,
        team.agent,
        ("A refund can be issued without the customer asking", "issue_refund", ["LLM06"]),
    )
    team.db.add(
        ThreatGapAcceptance(
            organization_id=team.org,
            target_id=team.agent.id,
            threat_model_id=model.id,
            threat_no=1,
            reason="The refund tool is disabled in staging.",
            accepted_at=datetime.now(UTC),
        )
    )
    team.db.commit()

    panel = cell_of(team.client, "llm06", team.agent)

    assert panel["code"] == "LLM06" and panel["name"] == "Excessive Agency"
    assert panel["cell"]["status"] == coverage.GAP
    assert panel["threat_model_version"] == 1
    assert panel["threats"][0]["component"] == "issue_refund"
    assert panel["accepted_gap"]["reason"] == "The refund tool is disabled in staging."
    assert panel["suites"] and all(suite["covering"] >= 1 for suite in panel["suites"])
    assert panel["suites"][0]["tests"] >= panel["suites"][0]["covering"]


def test_the_matrix_also_answers_for_mitre_atlas(team, run_with):
    """UC-7.4 step 2: the techniques Sentra's tests are mapped to, with their official IDs."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    leaked = canary_test(team, category="LLM02", atlas=["AML.T0057"])
    run_with(leaked, [f"Write to {PERSONAL_TOKEN} for help."])

    rows = rows_of(team.client, framework="atlas")

    assert rows["AML.T0057"]["name"] == "LLM Data Leakage"
    assert rows["AML.T0057"]["status"] == coverage.TESTED
    assert rows["AML.T0057"]["open_total"] == 1
    assert rows["_body"]["framework"] == "atlas"
    assert cell_of(team.client, "AML.T0057", team.agent, "atlas")["cell"]["open_findings"] == 1


def test_an_older_version_of_a_test_counts_for_what_the_test_maps_to_now(team, run_with):
    """MITRE ATLAS 2026.10 moved two techniques, and FR-4.5 gives the test a new version. The run of
    the older version tested the same thing, so the new technique isn't a gap."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    leaked = canary_test(team, category="LLM02", atlas=["AML.T0057"])
    run_with(leaked, [f"Write to {PERSONAL_TOKEN} for help."])
    leaked.is_current = False
    team.db.flush()
    columns = {c.name: getattr(leaked, c.name) for c in TestDefinition.__table__.columns if c.name != "id"}
    team.db.add(TestDefinition(**(columns | {"version": 2, "is_current": True, "atlas": ["AML.T0085.002"]})))
    team.db.commit()

    rows = rows_of(team.client, framework="atlas")

    assert rows["AML.T0085.002"]["status"] == coverage.TESTED
    assert rows["AML.T0057"]["status"] == coverage.TESTED


def test_the_dashboard_lists_the_open_findings_by_category(team, run_with):
    """Screen 42's "Open findings by OWASP category": the same rows, with the severity split, the
    categories with the most findings first."""
    profile_for(team.db, team.agent, knowledge_sources=[{"name": "Knowledge sources"}])
    knowledge_finding(team, run_with, category="LLM02")

    shown = team.client.get("/api/v1/risk/dashboard").json()

    first = shown["by_category"][0]
    assert first["code"] == "LLM02" and first["open_total"] == 1
    assert sum(first["open_by_severity"].values()) == 1
    assert first["status"] == coverage.TESTED
    assert "cells" not in first
    assert len(shown["by_category"]) == 10


def test_another_organization_sees_no_coverage(team, run_with):
    """NFR-3.3: another organization's runs, targets and findings are invisible."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    tool_finding(team, run_with, category="LLM06")
    new_user(team.db, "jonas@example.com")
    log_in(team.client, "jonas@example.com")
    create_organization(team.client, "Kestrel Logistics")

    rows = rows_of(team.client)

    assert rows["_body"]["targets"] == []
    assert rows["LLM06"]["cells"] == [] and rows["LLM06"]["open_total"] == 0
    hidden = team.client.get(f"{COVERAGE}/LLM06", params={"target_id": str(team.agent.id)})
    assert hidden.status_code == 404


def test_an_unknown_category_or_framework_is_refused(team):
    assert team.client.get(COVERAGE, params={"framework": "stride"}).status_code == 422
    assert (
        team.client.get(f"{COVERAGE}/LLM99", params={"target_id": str(team.agent.id)}).status_code
        == 404
    )
