"""Reading the risk (FR-7.1, FR-7.2; UC-7.3 View Risk Dashboard, UC-7.2; NFR-3.3, NFR-4.2). Dummy
values only: the messages ATTEMPT-1 …, fake canary tokens and invented replies."""

from app.modules.m07_risk.service import NO_RUN, UNVERIFIED
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m05_campaigns.conftest import configure
from tests.m05_campaigns.test_campaigns import add_target
from tests.m07_risk.conftest import PERSONAL_TOKEN, canary_test, plant

DASHBOARD = "/api/v1/risk/dashboard"
PERSONAL_REPLY = f"Write to {PERSONAL_TOKEN} for help."


def critical_run(team, run_with):
    """A run that leaves one critical finding: disclosed personal data, reproduced every time.
    The campaign asks for five repetitions and its budget has room for three attempts, so the
    score of the finding is provisional (FR-6.4; UC-6.3, 2a1)."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    configure(team.db, repetitions=5, attempt_budget=3)
    return run_with(canary_test(team, category="LLM02"), [PERSONAL_REPLY] * 3)


def test_the_dashboard_shows_each_targets_score_and_its_open_findings(team, run_with):
    """UC-7.3 steps 2-3: the risk score of each target with the date of its last campaign run and
    its open findings by severity, and all findings by status."""
    critical_run(team, run_with)

    shown = team.client.get(DASHBOARD).json()

    assert shown["period_days"] == 90
    assert shown["last_run_at"] is not None
    assert shown["open_total"] == 1
    assert shown["open_by_severity"]["critical"] == 1
    assert (shown["awaiting_triage"], shown["awaiting_remediation"]) == (1, 0)
    assert shown["fixed_and_verified"] == 0
    assert shown["by_status"]["new"] == 1
    (row,) = shown["targets"]
    assert (row["name"], row["score"], row["band"]) == ("Payments Operations Agent", 88, "critical")
    assert (row["open_total"], row["awaiting_confirmation"]) == (1, 0)
    assert row["open_by_severity"]["critical"] == 1
    assert row["not_scored_reason"] == ""
    assert row["last_run_at"] is not None
    assert shown["top_findings"]["total"] == 1
    (finding,) = shown["top_findings"]["items"]
    assert (finding["code"], finding["severity"]) == ("F-001", "critical")
    assert (finding["reproducibility"], finding["provisional"]) == ("1.000", True)
    assert finding["target"]["name"] == "Payments Operations Agent"


def test_a_target_without_a_score_says_why_it_has_none(team, run_with):
    """Screens 16 and 42: a target that has never been tested, or whose ownership isn't verified
    yet, shows a reason instead of a score (UC-7.2 precondition)."""
    critical_run(team, run_with)
    add_target(
        team.db,
        team.org,
        name="Marketing Copy Assistant",
        type="chatbot",
        endpoint_url="https://marketing.staging.halcyonbank.com/v1/chat",
        status="unverified",
    )
    add_target(
        team.db,
        team.org,
        name="Internal HR Helpdesk",
        type="rag_application",
        endpoint_url="https://hr.staging.halcyonbank.com/v1/chat",
    )
    team.db.commit()

    rows = team.client.get(DASHBOARD).json()["targets"]

    assert [(row["name"], row["score"], row["not_scored_reason"]) for row in rows] == [
        ("Payments Operations Agent", 88, ""),
        ("Internal HR Helpdesk", None, NO_RUN),
        ("Marketing Copy Assistant", None, UNVERIFIED),
    ]


def test_the_dashboard_can_be_narrowed_to_one_target_and_a_period(team, run_with):
    """Step 4: the filters of Screen 42."""
    critical_run(team, run_with)
    other = add_target(
        team.db,
        team.org,
        name="Internal HR Helpdesk",
        type="rag_application",
        endpoint_url="https://hr.staging.halcyonbank.com/v1/chat",
    )
    team.db.commit()

    mine = team.client.get(DASHBOARD, params={"target_id": str(team.agent.id), "days": 7}).json()
    empty = team.client.get(DASHBOARD, params={"target_id": str(other.id)}).json()

    assert mine["period_days"] == 7
    assert [row["name"] for row in mine["targets"]] == ["Payments Operations Agent"]
    assert mine["open_total"] == 1
    assert [row["score"] for row in empty["targets"]] == [None]
    assert (empty["open_total"], empty["top_findings"]["total"]) == (0, 0)


def test_the_target_risk_card_shows_the_score_its_findings_and_its_history(team, run_with):
    """UC-7.2 on Screen 20: the score with the findings it counts, and the history of UC-2.7."""
    critical_run(team, run_with)

    shown = team.client.get(f"/api/v1/targets/{team.agent.id}/risk").json()

    assert (shown["score"], shown["band"]) == (88, "critical")
    assert shown["target"]["name"] == "Payments Operations Agent"
    assert (shown["counted"], shown["counted_codes"]) == (1, ["F-001"])
    assert shown["counted_by_severity"]["critical"] == 1
    assert shown["awaiting_confirmation"] == 0
    assert shown["open_by_severity"]["critical"] == 1
    assert shown["factors"]["position"] == "0.500"
    assert shown["trigger"] == "campaign_run"
    assert [(row["score"], row["trigger"]) for row in shown["history"]] == [(88, "campaign_run")]
    unknown = "11111111-1111-1111-1111-111111111111"
    assert team.client.get(f"/api/v1/targets/{unknown}/risk").status_code == 404


def test_the_finding_shows_the_factors_behind_its_severity(team, run_with):
    """NFR-4.2 on Screen 39: the factors are shown with every severity, and the severity of the
    test definition is where the finding started (FR-4.2)."""
    critical_run(team, run_with)

    shown = team.client.get("/api/v1/findings/F-001/severity").json()

    assert (shown["severity"], shown["calculated_severity"]) == ("critical", "critical")
    assert (shown["adjusted"], shown["provisional"]) == (False, True)
    assert shown["test_severity"] == "medium"
    assert shown["reproducibility"] == "1.000"
    assert shown["rated_at"] is not None
    assert shown["factors"]["impact"]["label"] == "Disclosed data"
    assert shown["factors"]["exploitability"]["sentences"] == [
        "The first attempt of the test succeeded."
    ]
    assert team.client.get("/api/v1/findings/F-009/severity").status_code == 404


def test_the_method_is_the_one_the_code_uses(team):
    """The link "How is the risk score calculated?" (Screen 42): the bands of FR-7.2 and the
    matrix of FR-7.1, from the code itself."""
    shown = team.client.get("/api/v1/risk/method").json()

    assert shown["bands"] == [
        {"band": "critical", "severity": "critical", "from": 75, "to": 100},
        {"band": "high", "severity": "high", "from": 50, "to": 74},
        {"band": "medium", "severity": "medium", "from": 25, "to": 49},
        {"band": "low", "severity": "low", "from": 1, "to": 24},
    ]
    assert len(shown["severity"]["matrix"]) == 4
    assert shown["severity"]["impact"][0]["label"] == "An unintended tool action"


def test_another_organization_sees_nothing_of_our_risk(team, run_with):
    """NFR-3.3: users see only their own organization's data."""
    critical_run(team, run_with)
    new_user(team.db, "kim@example.com")
    log_in(team.client, "kim@example.com")
    create_organization(team.client, "Kestrel Logistics")

    assert team.client.get(DASHBOARD).json()["targets"] == []
    assert team.client.get(DASHBOARD).json()["open_total"] == 0
    assert team.client.get(f"/api/v1/targets/{team.agent.id}/risk").status_code == 404
    assert team.client.get("/api/v1/findings/F-001/severity").status_code == 404
