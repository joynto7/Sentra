"""The attack paths of a target (FR-7.3; UC-7.5 Explore Attack Paths, with 3a, 4a and 6a). Dummy
values only: the messages ATTEMPT-1 …, invented replies, fake canary tokens and invented tool
names, and a stub model for the judge.
"""

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m06_findings.models import FindingStatus
from app.modules.m07_risk import paths
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m07_risk.conftest import (
    JUDGE_CONFIRMS,
    JUDGED,
    LOOKUP_TOOL,
    MARKER,
    MARKER_IN_REPLY,
    PERSONAL_TOKEN,
    REFUND_TOOL,
    SOURCES,
    answer,
    canary_test,
    findings_of,
    make_test,
    paths_of,
    plant,
    profile_for,
)

PERSONAL_REPLY = f"Write to {PERSONAL_TOKEN} for help."


def tool_call(name: str) -> dict:
    return {"id": "c1", "type": "function", "function": {"name": name, "arguments": "{}"}}


def model_finding(team, run_with, **changes):
    """A finding on the model: a rule on the reply decides, so no tool and no document is named."""
    test = make_test(team.db, team.org, {"rule_matching": "decisive"}, MARKER_IN_REPLY, **changes)
    return run_with(test, [f"Of course. {MARKER}"])


def tool_finding(team, run_with, tool: str = "issue_refund", **changes):
    """A finding on a tool: the tool-call check names it, so the finding sits on that tool."""
    test = make_test(
        team.db,
        team.org,
        {"tool_call_inspection": "decisive"},
        [{"check": "tool_called", "value": tool}],
        **changes,
    )
    return run_with(test, [answer("Done.", [tool_call(tool)])])


def knowledge_finding(team, run_with, **changes):
    """A finding on the knowledge sources: a canary token planted in a document is given away."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    return run_with(canary_test(team, **changes), [PERSONAL_REPLY])


def test_the_graph_draws_the_components_of_the_profile_with_the_findings_on_them(team, run_with):
    """UC-7.5 steps 2-3: the components of the Target Profile, left to right, and each open
    finding on the component it affects. Every connection says why it exists (QR 4)."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL, LOOKUP_TOOL], knowledge_sources=[SOURCES])
    tool_finding(team, run_with)

    shown = paths_of(team.client, team.agent)

    assert shown["blocker"] is None and shown["profile_version"] == 1
    by_id = {node["id"]: node for node in shown["nodes"]}
    assert set(by_id) == {
        "input:User input",
        "model:Model",
        "system_prompt:System prompt",
        "knowledge_source:Knowledge sources",
        "tool:issue_refund",
        "tool:lookup_customer",
        "output:Chat replies",
    }
    assert [by_id[node]["stage"] for node in ("input:User input", "model:Model")] == [0, 3]
    assert by_id["input:User input"]["entry"]
    assert by_id["knowledge_source:Knowledge sources"]["entry"]
    assert not by_id["tool:issue_refund"]["entry"]
    assert by_id["tool:issue_refund"]["label"] == "Tool: issue_refund"
    assert by_id["tool:issue_refund"]["impact"].endswith("which issues a refund to the customer.")
    assert by_id["tool:lookup_customer"]["impact"].endswith("an action of the application.")
    assert by_id["tool:issue_refund"]["findings"] == ["F-001"]
    assert all(node["in_profile"] for node in shown["nodes"])
    connections = {(edge["from"], edge["to"]): edge["why"] for edge in shown["edges"]}
    assert connections[("model:Model", "tool:issue_refund")].startswith("The Target Profile lists")
    assert ("knowledge_source:Knowledge sources", "model:Model") in connections
    assert ("tool:issue_refund", "tool:lookup_customer") not in connections
    (finding,) = shown["findings"]
    assert finding["component"]["label"] == "Tool: issue_refund" and finding["in_profile"]


def test_two_findings_on_connected_components_make_one_path(team, run_with):
    """Step 4: a weakness of the model's behaviour and one of a tool it can call are a chain, and
    step 5 describes it in plain language and rates it by the severity of its worst step."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with, category="LLM01", severity="medium")
    tool_finding(team, run_with, category="LLM06", severity="critical")

    shown = paths_of(team.client, team.agent)

    (path,) = shown["paths"]
    severities = {finding["code"]: finding["severity"] for finding in shown["findings"]}
    assert path["code"] == "AP-1" and len(path["steps"]) == 2
    assert path["finding_codes"] == ["F-001", "F-002"]
    assert path["severity"] == severities["F-002"]
    assert path["steps"][0]["sentence"] == "The model answers the request."
    assert path["steps"][1]["sentence"] == "The model calls issue_refund."
    assert path["steps"][1]["component"]["label"] == "Tool: issue_refund"
    assert path["description"] == (
        "The model answers the request. From there it runs to Tool: issue_refund. 2 open findings "
        "are on it: F-001, F-002."
    )
    assert path["impact"] == (
        "At its end the model calls issue_refund, which issues a refund to the customer."
    )
    assert path["node_ids"] == ["model:Model", "tool:issue_refund"]
    assert not path["has_unconfirmed"] and shown["no_paths_reason"] == ""


def test_a_path_starts_where_something_comes_from_outside(team, run_with):
    """A document that gives a canary token away, the model, and the tool it calls: the chain
    starts at the knowledge source, because the profile leads from there to the model."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL], knowledge_sources=[SOURCES])
    knowledge_finding(team, run_with, category="LLM02")
    model_finding(team, run_with, category="LLM01")
    tool_finding(team, run_with, category="LLM06")

    (path,) = paths_of(team.client, team.agent)["paths"]

    assert [step["component"]["kind"] for step in path["steps"]] == [
        "knowledge_source",
        "model",
        "tool",
    ]
    # The component's own name already says what it is, so the label stays as it is (Screen 39)
    assert path["steps"][0]["sentence"] == (
        "Content placed in Knowledge sources is retrieved by the model."
    )
    assert path["description"].startswith("Content placed in Knowledge sources")


def test_two_findings_on_the_same_kind_of_component_are_not_a_path(team, run_with):
    """4a1: the profile records nothing that leads from one tool to another, so two tool findings
    are shown on their components with the reason that no multi-step path was found."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL, LOOKUP_TOOL])
    tool_finding(team, run_with, "issue_refund")
    tool_finding(team, run_with, "lookup_customer")

    shown = paths_of(team.client, team.agent)

    assert shown["paths"] == [] and shown["no_paths_reason"] == paths.NO_CHAIN
    assert len(shown["findings"]) == 2
    assert {node["id"] for node in shown["nodes"] if node["findings"]} == {
        "tool:issue_refund",
        "tool:lookup_customer",
    }


def test_one_open_finding_says_why_there_is_no_chain(team, run_with):
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    tool_finding(team, run_with)

    assert paths_of(team.client, team.agent)["no_paths_reason"] == paths.ONE_FINDING


def test_a_step_that_still_requires_confirmation_is_marked(team, run_with, judge_model):
    """3a1: a finding that only the LLM judge supports is labelled unconfirmed, and so is every
    path that depends on it (NFR-9.3)."""
    judge_model(JUDGED)
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    judged = make_test(team.db, team.org, {"llm_judge": "decisive"}, JUDGE_CONFIRMS)
    run_with(judged, ["The dummy marker is repeated here."])
    tool_finding(team, run_with)

    shown = paths_of(team.client, team.agent)

    assert [f["status"] for f in shown["findings"] if f["unconfirmed"]] == [
        FindingStatus.REQUIRES_CONFIRMATION
    ]
    assert shown["unconfirmed"] == 1
    (path,) = shown["paths"]
    assert path["has_unconfirmed"]
    assert [step["findings"][0]["unconfirmed"] for step in path["steps"]] == [True, False]


def test_a_component_the_profile_no_longer_lists_keeps_its_finding(team, run_with):
    """The profile is re-mapped and no longer names the tool a finding is about: the node stays,
    marked, so the finding is never silently dropped."""
    profile_for(team.db, team.agent, tools=[LOOKUP_TOOL])
    tool_finding(team, run_with, "issue_refund")

    shown = paths_of(team.client, team.agent)

    (finding,) = shown["findings"]
    assert not finding["in_profile"]
    node = next(node for node in shown["nodes"] if node["id"] == "tool:issue_refund")
    assert node["note"] == paths.NOT_IN_PROFILE and not node["in_profile"]


def test_without_a_profile_the_findings_are_listed_on_their_own(team, run_with):
    """The failed end condition of UC-7.5: no graph, but the target's findings are still shown,
    with the reason."""
    tool_finding(team, run_with)

    shown = paths_of(team.client, team.agent)

    assert shown["blocker"]["code"] == "no_profile"
    assert "Map the target's profile first" in shown["blocker"]["message"]
    assert shown["nodes"] == [] and shown["edges"] == [] and shown["paths"] == []
    assert [finding["code"] for finding in shown["findings"]] == ["F-001"]


def test_an_analyst_dismisses_a_path_with_a_reason_and_can_take_it_back(team, run_with):
    """6a1: the path disappears from the view, the reason is kept and the audit log records it."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    tool_finding(team, run_with)
    (path,) = paths_of(team.client, team.agent)["paths"]
    url = f"/api/v1/targets/{team.agent.id}/attack-paths/{path['key']}/dismiss"

    after = team.client.post(url, json={"reason": "The refund tool needs a second approval."})

    assert after.status_code == 200
    assert after.json()["paths"] == []
    (hidden,) = after.json()["dismissed"]
    assert hidden["reason"] == "The refund tool needs a second approval."
    assert hidden["dismissed_by"] == "Arif" and hidden["code"] == ""
    assert after.json()["no_paths_reason"] == paths.ALL_DISMISSED
    entries = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()
    assert (entries[-1].action, entries[-1].item_type) == ("attack_path.dismissed", "attack_path")
    assert entries[-1].details["findings"] == ["F-001", "F-002"]

    back = team.client.delete(url)

    assert back.status_code == 200
    assert [one["code"] for one in back.json()["paths"]] == ["AP-1"]
    assert back.json()["dismissed"] == []
    assert team.client.delete(url).status_code == 404  # it was not dismissed any more


def test_a_dismissal_needs_a_reason_and_an_existing_path(team, run_with):
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    tool_finding(team, run_with)
    (path,) = paths_of(team.client, team.agent)["paths"]
    url = f"/api/v1/targets/{team.agent.id}/attack-paths/{path['key']}/dismiss"

    assert team.client.post(url, json={"reason": "no"}).status_code == 422
    unknown = f"/api/v1/targets/{team.agent.id}/attack-paths/{'a' * 32}/dismiss"
    refused = team.client.post(unknown, json={"reason": "This path is not plausible."})
    assert refused.status_code == 404
    assert "not in the target's view" in refused.json()["error"]["message"]


def test_a_dismissal_holds_only_for_the_chain_it_was_about(team, run_with):
    """The key is a digest of the path's findings, so a chain that grew is a new path and is shown
    again: an analyst dismissed the two-step path, not the three-step one."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL], knowledge_sources=[SOURCES])
    model_finding(team, run_with)
    tool_finding(team, run_with)
    (path,) = paths_of(team.client, team.agent)["paths"]
    url = f"/api/v1/targets/{team.agent.id}/attack-paths/{path['key']}/dismiss"
    hidden = team.client.post(url, json={"reason": "Not plausible for this target."})
    assert hidden.status_code == 200

    knowledge_finding(team, run_with)

    shown = paths_of(team.client, team.agent)
    (grown,) = shown["paths"]
    assert len(grown["steps"]) == 3 and shown["dismissed"] == []


def test_only_an_analyst_dismisses_a_path(team, run_with):
    """UC-7.5, 6a: the analyst decides a path is implausible, as with a severity (UC-7.1). A
    developer and a manager read the view."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    tool_finding(team, run_with)
    (path,) = paths_of(team.client, team.agent)["paths"]
    url = f"/api/v1/targets/{team.agent.id}/attack-paths/{path['key']}/dismiss"
    reason = {"reason": "The tool is behind a second approval."}

    log_in(team.client, "maya@example.com")  # AI Application Developer
    assert team.client.post(url, json=reason).status_code == 403
    log_in(team.client, "sofia@example.com")  # Security Manager
    assert team.client.post(url, json=reason).status_code == 403
    assert paths_of(team.client, team.agent)["paths"][0]["key"] == path["key"]
    log_in(team.client, "arif@example.com")  # Security Analyst
    assert team.client.post(url, json=reason).status_code == 200


def test_another_organizations_target_is_out_of_reach(team, run_with):
    """NFR-3.3: the graph of a target of another organization is not found."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    tool_finding(team, run_with)
    new_user(team.db, "jonas@example.com")
    log_in(team.client, "jonas@example.com")
    create_organization(team.client, "Kestrel Logistics")

    assert team.client.get(f"/api/v1/targets/{team.agent.id}/attack-paths").status_code == 404


def test_a_closed_finding_is_not_on_the_graph(team, run_with):
    """Only open findings are placed: a false positive leaves the graph (FR-6.5 closes it)."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    tool_finding(team, run_with)
    first, _ = findings_of(team.db)
    first.status = FindingStatus.FALSE_POSITIVE
    team.db.commit()

    shown = paths_of(team.client, team.agent)

    assert [finding["code"] for finding in shown["findings"]] == ["F-002"]
    assert shown["paths"] == [] and shown["no_paths_reason"] == paths.ONE_FINDING


def test_several_findings_on_one_component_are_one_path(team, run_with):
    """A path is a route through the components, not a combination of findings: two weaknesses of
    the model's behaviour and one of the tool it can call are one way in, with both model findings
    on the first step. The seeded bank data has eleven findings on five components, which as
    combinations would be two dozen paths that all read the same."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    model_finding(team, run_with)
    tool_finding(team, run_with)

    (path,) = paths_of(team.client, team.agent)["paths"]

    assert len(path["steps"]) == 2
    assert [len(step["findings"]) for step in path["steps"]] == [2, 1]
    assert path["finding_codes"] == ["F-001", "F-002", "F-003"]
    assert path["description"].endswith("3 open findings are on it: F-001, F-002, F-003.")
