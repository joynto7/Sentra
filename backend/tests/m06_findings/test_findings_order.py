"""The order of the findings list and its severity strip (Screen 38; UC-6.4 steps 2-4 and 2a).
Dummy values only: the messages ATTEMPT-1 …, invented replies and fake canary tokens."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.modules.m01_users.models import User
from app.modules.m06_findings.models import Finding, FindingStatus
from app.modules.m06_findings.service import SORTS
from tests.m01_users.test_organizations import create, log_in, new_user
from tests.m06_findings.conftest import PERSONAL_TOKEN, SYSTEM_TOKEN, make_test, plant

FINDINGS = "/api/v1/findings"
MARKER = "MARKER-38"  # a dummy marker in an invented reply


def listed(client, **query) -> dict:
    response = client.get(FINDINGS, params=query)
    assert response.status_code == 200, response.text
    return response.json()


def codes(page: dict) -> list[str]:
    return [item["code"] for item in page["items"]]


def user_id(db, email: str):
    return db.scalar(select(User.id).where(User.email == email))


@pytest.fixture
def three(team, run_with):
    """Three findings of the Payments Operations Agent, given values that put each column in a
    different order: F-001 Medium, F-002 Critical, F-003 High."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    canary = {"canary_token": "decisive"}
    in_reply = [{"check": "canary_in_reply"}]
    run_with(
        make_test(team.db, team.org, canary, in_reply, category="LLM07"), [f"Ref {SYSTEM_TOKEN}"]
    )
    run_with(
        make_test(team.db, team.org, canary, in_reply, category="LLM02"), [f"To {PERSONAL_TOKEN}"]
    )
    marker = make_test(
        team.db,
        team.org,
        {"rule_matching": "decisive"},
        [{"check": "reply_contains", "value": MARKER}],
        category="LLM01",
    )
    run_with(marker, [f"Of course. {MARKER}"])
    first, second, third = team.db.scalars(select(Finding).order_by(Finding.number)).all()
    now = datetime.now(UTC)
    values = [
        # severity, title, status, reproducibility, owner, last seen
        (first, "medium", "Banner shown", FindingStatus.CONFIRMED, "0.400", "maya@example.com", 1),
        (second, "critical", "Account read", FindingStatus.NEW, "1.000", None, 3),
        (third, "high", "Chat leaked", FindingStatus.REOPENED, None, "arif@example.com", 2),
    ]
    for finding, severity, title, status, repro, owner, days in values:
        finding.severity, finding.title, finding.status = severity, title, status
        finding.reproducibility = Decimal(repro) if repro else None
        finding.owner_id = user_id(team.db, owner) if owner else None
        finding.last_seen_at = now - timedelta(days=days)
    team.db.commit()
    return first, second, third


@pytest.mark.parametrize(
    ("sort", "direction", "expected"),
    [
        # UC-6.4 step 2: the most severe first
        ("severity", "desc", ["F-002", "F-003", "F-001"]),
        ("severity", "asc", ["F-001", "F-003", "F-002"]),
        ("title", "asc", ["F-002", "F-001", "F-003"]),
        ("title", "desc", ["F-003", "F-001", "F-002"]),
        ("category", "asc", ["F-003", "F-002", "F-001"]),  # LLM01, LLM02, LLM07
        # The lifecycle order: new, requires confirmation, confirmed, reopened …
        ("status", "asc", ["F-002", "F-001", "F-003"]),
        ("status", "desc", ["F-003", "F-001", "F-002"]),
        # A finding not rated yet comes last whichever way
        ("reproducibility", "desc", ["F-002", "F-001", "F-003"]),
        ("reproducibility", "asc", ["F-001", "F-002", "F-003"]),
        # By the owner's name; nobody last
        ("owner", "asc", ["F-003", "F-001", "F-002"]),
        ("last_seen", "desc", ["F-001", "F-003", "F-002"]),
        ("last_seen", "asc", ["F-002", "F-003", "F-001"]),
    ],
)
def test_every_column_sorts_both_ways(team, three, sort, direction, expected):
    page = listed(team.client, sort=sort, direction=direction)

    assert codes(page) == expected
    assert (page["sort"], page["direction"], page["mine_first"]) == (sort, direction, False)


def test_a_developer_sees_their_own_findings_first(team, three):
    """UC-6.4, 2a1: Maya's Medium finding comes before the Critical and High ones, as long as the
    list is in its usual order; a column she chooses sorts everything alike."""
    log_in(team.client, "maya@example.com")

    usual = listed(team.client)
    chosen = listed(team.client, sort="title", direction="asc")

    assert codes(usual) == ["F-001", "F-002", "F-003"]
    assert usual["mine_first"] is True
    assert codes(chosen) == ["F-002", "F-001", "F-003"] and chosen["mine_first"] is False


def test_an_analyst_sees_the_usual_order(team, three):
    """Arif owns the High finding, but analysts aren't given their own first: the order of
    UC-6.4 step 2 applies to them."""
    page = listed(team.client)

    assert codes(page) == ["F-002", "F-003", "F-001"] and page["mine_first"] is False


def test_the_severity_strip_counts_everything_but_the_severity(team, three):
    """The strip above the table says what choosing each severity would show: the view and every
    other filter count, the chosen severity doesn't."""
    narrowed = listed(team.client, view="open", severity="critical")
    by_status = listed(team.client, view="open", status="confirmed")

    assert codes(narrowed) == ["F-002"]
    assert narrowed["severity_counts"] == {
        "critical": 1,
        "high": 1,
        "medium": 1,
        "low": 0,
        "informational": 0,
    }
    assert by_status["severity_counts"]["medium"] == 1
    assert sum(by_status["severity_counts"].values()) == by_status["total"] == 1


def test_an_unknown_order_is_refused(team, three):
    assert team.client.get(FINDINGS, params={"sort": "evidence_count"}).status_code == 422
    assert team.client.get(FINDINGS, params={"direction": "up"}).status_code == 422


def test_another_organization_sees_none_of_them_in_any_order(team, three, client, db):
    """NFR-3.3: whatever the order, the strip and the counts, another organization's member gets
    nothing of Halcyon Bank's findings."""
    new_user(db, "eve@example.com")
    log_in(client, "eve@example.com")
    create(client, "Other Bank")

    for sort in SORTS:
        page = listed(client, sort=sort)
        assert page["total"] == 0 and page["items"] == [], sort
        assert sum(page["severity_counts"].values()) == 0, sort
