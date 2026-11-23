"""The trends and the filters of the risk dashboard (FR-7.4; UC-7.3 steps 4-5). Dummy values only:
the messages ATTEMPT-1 …, invented replies and fake canary tokens.
"""

from datetime import UTC, datetime, timedelta

from app.modules.m06_findings import triage
from app.modules.m06_findings.models import FindingEventKind, FindingStatus
from app.modules.m07_risk.models import RiskScore, ScoreTrigger
from app.modules.m07_risk.trends import BUCKETS
from tests.m07_risk.conftest import REFUND_TOOL, findings_of, profile_for, scores_of
from tests.m07_risk.test_paths import model_finding, tool_finding

DASHBOARD = "/api/v1/risk/dashboard"


def dashboard(client, **query) -> dict:
    response = client.get(DASHBOARD, params=query)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_trend_counts_the_findings_that_came_and_the_ones_that_were_closed(team, run_with):
    """UC-7.3 step 5: new and closed findings across the period. The period is cut into six parts,
    so the default 90 days are the six two-week columns of Screen 42."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    tool_finding(team, run_with)

    trends = dashboard(team.client)["trends"]

    assert len(trends["buckets"]) == BUCKETS
    assert [bucket["new"] for bucket in trends["buckets"]] == [0, 0, 0, 0, 0, 2]
    assert trends["buckets"][-1]["closed"] == 0 and trends["net_change"] == 2
    first, second = findings_of(team.db)
    first.status = FindingStatus.FIXED_AND_VERIFIED
    team.db.commit()

    after = dashboard(team.client)["trends"]

    assert after["buckets"][-1]["closed"] == 1 and after["net_change"] == 1
    assert second.status in (FindingStatus.NEW, FindingStatus.REQUIRES_CONFIRMATION)


def test_a_closed_finding_counts_when_it_was_closed(team, run_with):
    """FR-6.5's history dates a closing. A finding last seen two months ago and marked a false
    positive today counts among today's closed findings, in the bars and in the closed counts."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    finding = findings_of(team.db)[0]
    finding.last_seen_at = datetime.now(UTC) - timedelta(days=60)
    finding.status = FindingStatus.FALSE_POSITIVE
    triage.record(
        team.db,
        finding,
        FindingEventKind.FALSE_POSITIVE,
        text="The answer is the one the application should give.",
        was=FindingStatus.NEW,
        became=FindingStatus.FALSE_POSITIVE,
    )
    team.db.commit()

    shown = dashboard(team.client, days=30)

    assert shown["trends"]["buckets"][-1]["closed"] == 1
    assert shown["by_status"]["false_positive"] == 1


def test_the_parts_of_the_period_follow_the_chosen_period(team, run_with):
    """A shorter period keeps the six parts, so the chart keeps its shape (step 4)."""
    model_finding(team, run_with)

    trends = dashboard(team.client, days=30)["trends"]

    assert len(trends["buckets"]) == BUCKETS
    starts = [datetime.fromisoformat(bucket["starts_at"]) for bucket in trends["buckets"]]
    assert (starts[1] - starts[0]) == timedelta(days=5)
    assert dashboard(team.client, days=30)["period_days"] == 30


def test_a_score_line_follows_the_calculations_and_starts_from_the_level_before(team, run_with):
    """The line is a step line through the calculations that really happened (FR-7.2), with the
    last one before the period as the level it starts from."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with)
    tool_finding(team, run_with)
    scores = scores_of(team.db, team.agent.id)
    assert len(scores) == 2
    team.db.add(
        RiskScore(
            organization_id=team.org,
            target_id=team.agent.id,
            score=12,
            band="low",
            counted=1,
            counted_by_severity={},
            counted_codes=[],
            factors={},
            trigger=ScoreTrigger.CAMPAIGN_RUN,
            calculated_at=datetime.now(UTC) - timedelta(days=120),
        )
    )
    team.db.commit()

    (series,) = dashboard(team.client)["trends"]["scores"]

    assert series["target"]["name"] == "Payments Operations Agent"
    assert series["score"] == scores[-1].score and series["band"] == scores[-1].band
    assert [point["before_period"] for point in series["points"]] == [True, False, False]
    assert series["points"][0]["score"] == 12
    assert [point["score"] for point in series["points"][1:]] == [s.score for s in scores]
    assert series["points"][-1]["trigger"] == ScoreTrigger.CAMPAIGN_RUN


def test_only_the_three_highest_scoring_targets_get_a_line(team, run_with):
    """Screen 42 draws three lines. A target without a calculation in or before the period has
    none at all."""
    model_finding(team, run_with)

    scores = dashboard(team.client)["trends"]["scores"]

    assert len(scores) == 1  # the organization has one tested target
    assert all(series["points"] for series in scores)


def test_the_category_filter_narrows_every_count_but_not_the_scores(team, run_with):
    """UC-7.3 step 4: the dashboard is filtered by category. A risk score is a target's whole
    score and cannot be cut by category, so it stays as it is and the answer says so."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with, category="LLM01")
    tool_finding(team, run_with, category="LLM06")
    whole = dashboard(team.client)

    shown = dashboard(team.client, category="llm06")

    assert shown["category"] == "LLM06" and shown["category_filtered"]
    assert (whole["open_total"], shown["open_total"]) == (2, 1)
    assert shown["top_findings"]["total"] <= whole["top_findings"]["total"]
    assert sum(shown["trends"]["buckets"][-1]["new"] for _ in [0]) == 1
    assert shown["targets"][0]["open_total"] == 1
    assert shown["targets"][0]["score"] == whole["targets"][0]["score"]
    assert shown["trends"]["category"] == "LLM06"
    assert len(shown["by_category"]) == 10  # the table itself always lists every category
    assert not whole["category_filtered"] and whole["category"] is None


def test_an_unknown_category_is_refused(team):
    assert team.client.get(DASHBOARD, params={"category": "LLM42"}).status_code == 422
