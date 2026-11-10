"""Every number of the Risk Dashboard equals the database and the list it links to (Screen 42:
"every number links to the matching findings"; UC-7.3 step 6 leads from a number to UC-6.4).

One organization with findings in every status the page counts, closings in this period and the
one before, and a score history that starts before the period. Each number of the answer is
counted again straight from the tables and asked of the Findings list with the filter the page's
link carries. Dummy values only: the messages ATTEMPT-1 …, invented replies and fake tokens.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m04_tests.schema import Severity
from app.modules.m06_findings.models import CLOSED, OPEN, Finding, FindingStatus
from app.modules.m07_risk import scoring, trends
from app.modules.m07_risk.models import RiskScore, ScoreTrigger
from tests.m05_campaigns.test_campaigns import add_target
from tests.m07_risk.conftest import REFUND_TOOL, findings_of, profile_for
from tests.m07_risk.test_paths import model_finding, tool_finding

DASHBOARD = "/api/v1/risk/dashboard"
STATUSES = ("new", "requires_confirmation", "confirmed", "reopened")


def dashboard(client, **query) -> dict:
    response = client.get(DASHBOARD, params=query)
    assert response.status_code == 200, response.text
    return response.json()


def listed(client, **query) -> int:
    """The total the Findings list shows for the filter a dashboard link carries (Screen 38)."""
    response = client.get("/api/v1/findings", params={"page_size": 1, **query})
    assert response.status_code == 200, response.text
    return response.json()["total"]


def counted(db, *conditions) -> int:
    return db.scalar(select(func.count()).select_from(Finding).where(*conditions)) or 0


@pytest.fixture
def history(team, run_with):
    """Five findings of the Payments Operations Agent: one new, one that requires confirmation,
    one confirmed, one fixed and verified today, one fixed and verified 100 days ago (in the
    period before the default 90 days). The target's score was calculated 120 days ago, with two
    open findings, and again after every change since."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with, category="LLM01")
    tool_finding(team, run_with, category="LLM06")
    model_finding(team, run_with, category="LLM07")
    tool_finding(team, run_with, tool="lookup_customer", category="LLM02")
    model_finding(team, run_with, category="LLM05")
    found = findings_of(team.db)
    assert len(found) == 5, [f.code for f in found]
    new, rc, confirmed, fixed_now, fixed_before = found
    rc.status = FindingStatus.REQUIRES_CONFIRMATION
    confirmed.status = FindingStatus.CONFIRMED
    fixed_now.status = FindingStatus.FIXED_AND_VERIFIED
    long_ago = datetime.now(UTC) - timedelta(days=100)
    fixed_before.status = FindingStatus.FIXED_AND_VERIFIED
    fixed_before.first_seen_at = fixed_before.last_seen_at = long_ago
    team.db.add(
        RiskScore(
            organization_id=team.org,
            target_id=team.agent.id,
            score=40,
            band="medium",
            counted=1,
            counted_by_severity={},
            awaiting_confirmation=1,
            counted_codes=[],
            factors={},
            trigger=ScoreTrigger.CAMPAIGN_RUN,
            calculated_at=datetime.now(UTC) - timedelta(days=120),
        )
    )
    scoring.calculate(
        team.db, organization_id=team.org, target_id=team.agent.id, trigger=ScoreTrigger.TRIAGE
    )
    team.db.commit()
    return found


def test_the_tiles_and_statuses_are_the_lists_they_open(team, history):
    """The four tiles and "Findings by status": each number equals the database and the list
    its link opens."""
    shown = dashboard(team.client)
    db = team.db

    assert (
        shown["open_total"]
        == counted(db, Finding.status.in_(OPEN))
        == listed(team.client, view="open")
    )
    assert shown["open_total"] == 3
    for severity in Severity:
        assert shown["open_by_severity"][severity] == listed(
            team.client, view="open", severity=severity
        ), severity
    for status in STATUSES:
        link = (
            {"view": "requires_confirmation"}
            if status == "requires_confirmation"
            else {"view": "open", "status": status}
        )
        assert shown["by_status"][status] == listed(team.client, **link), status
        assert shown["by_status"][status] == counted(db, Finding.status == status)
    # The two middle tiles open the views that hold exactly what they count
    assert (
        shown["awaiting_triage"]
        == listed(team.client, view="awaiting_triage")
        == (shown["by_status"]["new"] + shown["by_status"]["requires_confirmation"])
    )
    assert (
        shown["awaiting_remediation"]
        == listed(team.client, view="awaiting_remediation")
        == (shown["by_status"]["confirmed"] + shown["by_status"]["reopened"])
    )
    # Closed in the period: the link carries the start of the period, so the list holds the one
    # fixed today and not the one fixed 100 days ago
    since = shown["changes"]["since"]
    assert shown["fixed_and_verified"] == 1
    assert shown["fixed_and_verified"] == listed(
        team.client, view="closed", status="fixed_and_verified", closed_from=since
    )
    for status in ("fixed_and_verified", "false_positive", "merged"):
        assert shown["by_status"][status] == listed(
            team.client, view="closed", status=status, closed_from=since
        ), status


def test_each_target_row_is_its_own_list_and_its_own_score(team, history):
    """The "Target risk" table: open findings and those awaiting confirmation per target are the
    lists of that target; the score is the newest calculation, and the score of the start of the
    period is the newest one before it."""
    (row,) = dashboard(team.client)["targets"]
    target = str(team.agent.id)

    assert row["open_total"] == listed(team.client, view="open", target_id=target)
    assert row["awaiting_confirmation"] == listed(
        team.client, view="requires_confirmation", target_id=target
    )
    for severity in Severity:
        assert row["open_by_severity"][severity] == listed(
            team.client, view="open", target_id=target, severity=severity
        )
    newest = scoring.current(team.db, team.org)[team.agent.id]
    assert (row["score"], row["band"]) == (newest.score, newest.band)
    assert row["score_then"] == 40


def test_the_categories_and_the_critical_list_are_their_lists(team, history):
    """Each category's count is the list of that category. A category out of scope can't be
    chosen on the Findings list, and no test finds anything in it, so it holds nothing and the
    page shows no link for it."""
    shown = dashboard(team.client)

    for row in shown["by_category"]:
        if not row["in_scope"]:
            assert row["open_total"] == counted(team.db, Finding.category == row["code"]) == 0
            continue
        assert row["open_total"] == listed(team.client, view="open", category=row["code"]), row
        assert row["open_total"] == counted(
            team.db, Finding.category == row["code"], Finding.status.in_(OPEN)
        )
    serious = listed(team.client, view="open", severity="critical") + listed(
        team.client, view="open", severity="high"
    )
    assert shown["top_findings"]["total"] == serious
    assert len(shown["top_findings"]["items"]) == min(serious, 6)


def test_the_trends_add_up_to_the_findings_of_the_period(team, history):
    """The bars count every finding first seen in the period and every finding closed in it, by
    the date it was closed; their difference is the change the page states."""
    shown = dashboard(team.client)
    start = datetime.fromisoformat(shown["trends"]["buckets"][0]["starts_at"])
    entered, closed_at = trends.closing(team.org)
    closed = team.db.scalar(
        select(func.count())
        .select_from(Finding)
        .outerjoin(entered, entered.c.finding_id == Finding.id)
        .where(Finding.status.in_(CLOSED), closed_at >= start)
    )

    bars = shown["trends"]["buckets"]
    assert sum(bar["new"] for bar in bars) == counted(team.db, Finding.first_seen_at >= start)
    assert sum(bar["closed"] for bar in bars) == closed == 1
    assert shown["trends"]["net_change"] == sum(bar["new"] - bar["closed"] for bar in bars)
    # Each bar opens its own findings: those first seen in its part of the period, or closed in it
    for bar in bars:
        part = {"first_seen_from": bar["starts_at"], "first_seen_until": bar["ends_at"]}
        assert bar["new"] == listed(team.client, view="all", **part), bar
        part = {"closed_from": bar["starts_at"], "closed_until": bar["ends_at"]}
        assert bar["closed"] == listed(team.client, view="closed", **part), bar


def test_the_tiles_compare_with_the_start_and_the_period_before(team, history):
    """The comparisons beside the tiles: two findings were open when the period began (the score
    of 120 days ago counted one and had one awaiting confirmation), and one finding was fixed and
    verified in the 90 days before this period."""
    changes = dashboard(team.client)["changes"]

    assert changes["open_then"] == 2
    assert changes["fixed_before"] == 1
    assert changes["since"] is not None


def test_a_category_has_no_open_count_of_the_start(team, history):
    """A score counts every category, so the start of the period can't be cut by one."""
    changes = dashboard(team.client, category="LLM01")["changes"]

    assert changes["open_then"] is None


def test_a_target_first_scored_in_the_period_has_no_score_then(team, run_with):
    model_finding(team, run_with)

    (row,) = dashboard(team.client)["targets"]

    assert row["score"] is not None and row["score_then"] is None
    assert dashboard(team.client)["changes"]["open_then"] == 0


def test_an_archived_targets_findings_stay_out_of_every_number(team, history):
    """An archived target isn't on the dashboard (FR-2.6, M2), so its findings are in none of the
    page's numbers, while the Findings list still holds them for their history. The page's
    numbers then equal the lists of the targets it shows."""
    retired = add_target(team.db, team.org, name="Mortgage FAQ Bot")
    team.db.commit()
    copy = findings_of(team.db)[0]
    team.db.add(
        Finding(
            **{
                column.key: getattr(copy, column.key)
                for column in Finding.__table__.columns
                if column.key not in ("id", "number", "target_id", "code")
            },
            number=99,
            target_id=retired.id,
        )
    )
    retired.status = TargetStatus.ARCHIVED
    team.db.commit()

    shown = dashboard(team.client)
    on_page = [
        target.id
        for target in team.db.scalars(
            select(Target).where(
                Target.organization_id == team.org, Target.status != TargetStatus.ARCHIVED
            )
        )
    ]

    assert shown["open_total"] == sum(
        listed(team.client, view="open", target_id=str(target)) for target in on_page
    )
    assert listed(team.client, view="open") == shown["open_total"] + 1
