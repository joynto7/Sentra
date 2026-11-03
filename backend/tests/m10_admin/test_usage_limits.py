"""FR-10.4 (M10) Usage and Cost Limits: UC-10.6 Set Usage and Cost Limits end to end, with its
alternatives 1a and 2a, the warning of step 5 and what a reached limit does to a launch (step 6).

Nothing is sent to a target: the usage is written straight into the database as a run engine would
leave it, and the LLM cost comes from `llm_usage` rows with made-up models.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.audit import AuditLogEntry
from app.core.email import outbox
from app.llm.models import LLMUsage
from app.modules.m01_users.models import Role, User
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns import limits
from app.modules.m05_campaigns.models import (
    Attempt,
    AttemptStatus,
    CampaignRun,
    RunStatus,
    RunType,
    UsageLimitWarning,
)
from app.modules.m09_reporting.models import Notification
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import organization_with
from tests.m05_campaigns.test_campaigns import add_target

URL = "/api/v1/admin/platform/organizations"
DEFAULTS = {"campaign_runs": 100, "attempts": 50_000, "llm_cost": Decimal(100)}


@pytest.fixture
def halcyon(client, db):
    """Halcyon Bank with Tom (Organization Administrator), Nadia (Security Manager) and Priya
    (Security Analyst), as the report's sample organization, plus a verified target and the
    built-in tests, so this month's usage can be real rows."""
    sync_built_in_library(db)
    organization_id = organization_with(
        db,
        client,
        {
            "nadia@example.com": Role.SECURITY_MANAGER,
            "priya@example.com": Role.SECURITY_ANALYST,
        },
    )
    add_target(db, organization_id)
    return organization_id


@pytest.fixture
def lena(client, db, halcyon):
    """Lena, a Platform Administrator, logged in with her password confirmed."""
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    log_in(client, "lena@example.com")
    assert (
        client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD}).status_code == 204
    )
    return client


def used(db, organization_id, *, runs: int = 0, attempts: int = 0, cost: str = "0") -> None:
    """This month's usage of an organization, as the run engine would have left it: completed
    campaign runs against its target, attempts that were sent, and LLM requests with their cost."""
    target_id = db.scalar(select(Target.id).where(Target.organization_id == organization_id))
    test_id = db.scalar(select(TestDefinition.id).limit(1))
    first = db.scalar(
        select(func.max(CampaignRun.number)).where(CampaignRun.target_id == target_id)
    )
    made = []
    for number in range(1, max(runs, 1 if attempts else 0) + 1):
        run = CampaignRun(
            organization_id=organization_id,
            target_id=target_id,
            number=(first or 0) + number,
            run_type=RunType.CAMPAIGN,
            status=RunStatus.COMPLETED,
            attempt_budget=10_000,
            request_rate=10,
        )
        db.add(run)
        made.append(run)
    db.flush()
    for attempt_no in range(1, attempts + 1):
        db.add(
            Attempt(
                organization_id=organization_id,
                campaign_run_id=made[0].id,
                attempt_no=attempt_no,
                test_definition_id=test_id,
                test_code="T-001",
                template="ATTEMPT-1",
                variant=1,
                status=AttemptStatus.REPLIED,
                input="ATTEMPT-1",
                session_id="session",
                sent_at=datetime.now(UTC),
            )
        )
    if Decimal(cost):
        db.add(
            LLMUsage(
                organization_id=organization_id,
                task="llm_judge",
                model="ollama_chat/llama3.1:8b",
                provider="ollama_chat",
                deployment="local",
                cost_usd=Decimal(cost),
                succeeded=True,
            )
        )
    db.flush()


def overview(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200
    return response.json()


def row(client, name: str = "Halcyon Bank") -> dict:
    return next(o for o in overview(client)["organizations"] if o["name"] == name)


def limit_of(row: dict, kind: str) -> dict:
    return next(limit for limit in row["limits"] if limit["kind"] == kind)


def save(client, organization_id, **changes):
    body = {
        "campaign_runs": 40,
        "attempts": 50_000,
        "llm_cost_usd": "600.00",
        "warn_percent": 80,
        **changes,
    }
    return client.put(f"{URL}/{organization_id}/limits", json=body)


def actions(db) -> list[str]:
    return list(
        db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.chain == "platform")
            .order_by(AuditLogEntry.seq)
        )
    )


def warnings_of(db, organization_id) -> list[tuple[str, int]]:
    rows = db.scalars(
        select(UsageLimitWarning).where(UsageLimitWarning.organization_id == organization_id)
    )
    return sorted((row.kind, row.used_percent) for row in rows)


def notified(db, email: str) -> list[Notification]:
    user_id = db.scalar(select(User.id).where(User.email == email))
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.user_id == user_id, Notification.event == "usage_limit_warning")
            .order_by(Notification.created_at)
        )
    )


# ---------------------------------------------------------------- the page (step 1, 1a)


def test_a_new_organization_has_the_platforms_default_limits(lena, db, halcyon):
    found = row(lena)

    assert found["members"] == 3
    assert found["status"] == "active"
    assert found["warn_percent"] == 80 and found["warn_percent_custom"] is False
    for kind, limit in DEFAULTS.items():
        shown = limit_of(found, kind)
        assert Decimal(shown["limit"]) == limit
        assert (shown["custom"], shown["used"], shown["percent"]) == (False, "0", 0)
    assert Decimal(overview(lena)["defaults"]["attempts"]) == 50_000


def test_the_page_shows_this_months_usage_against_each_limit(lena, db, halcyon):
    used(db, halcyon, runs=12, attempts=40, cost="82")
    save(lena, halcyon, campaign_runs=40, attempts=50, llm_cost_usd="100.00")

    found = row(lena)

    assert (
        limit_of(found, "campaign_runs")["used"],
        limit_of(found, "campaign_runs")["percent"],
    ) == (
        "12",
        30,
    )
    attempts = limit_of(found, "attempts")
    assert (attempts["percent"], attempts["warning"], attempts["reached"]) == (80, True, False)
    assert limit_of(found, "llm_cost")["percent"] == 82
    assert found["status"] == "active"


def test_an_organization_at_a_limit_is_limited_and_says_until_when(lena, db, halcyon):
    used(db, halcyon, runs=5)
    # The limit is exactly this month's usage, so it has to be confirmed (2a1).
    assert save(lena, halcyon, campaign_runs=5, confirmed=True).status_code == 200

    found = row(lena)

    assert found["status"] == "limited"
    assert limit_of(found, "campaign_runs")["reached"] is True
    assert found["next_month"] == limits.next_month_label()


def test_the_page_says_that_no_content_of_an_organization_is_shown(lena):
    assert "never an organization's content" in overview(lena)["notice"]
    assert "Security Managers are warned" in overview(lena)["warn_at"]


# ---------------------------------------------------------------- setting the limits (steps 2-4)


def test_the_limits_are_saved_and_apply_at_once(lena, db, halcyon):
    response = save(lena, halcyon, campaign_runs=40, attempts=50_000, llm_cost_usd="600.00")

    assert response.status_code == 200
    assert Decimal(limit_of(response.json(), "llm_cost")["limit"]) == 600
    assert limit_of(response.json(), "campaign_runs")["custom"] is True
    in_force = limits.limits_for(db, halcyon)
    assert (in_force.campaign_runs, in_force.attempts, in_force.llm_cost_usd) == (
        40,
        50_000,
        Decimal("600.00"),
    )
    assert actions(db) == ["platform.usage_limits_changed"]


def test_the_change_is_recorded_with_what_it_was_before(lena, db, halcyon):
    save(lena, halcyon, campaign_runs=40)
    save(lena, halcyon, campaign_runs=20)

    entry = db.scalars(select(AuditLogEntry).where(AuditLogEntry.chain == "platform")).all()[-1]
    assert entry.details["before"]["campaign_runs"] == "40"
    assert entry.details["after"]["campaign_runs"] == 20
    assert entry.item_label == "Halcyon Bank"


def test_the_warning_threshold_stays_within_reach(lena, halcyon):
    too_low = save(lena, halcyon, warn_percent=10)
    too_high = save(lena, halcyon, warn_percent=100)

    assert (too_low.status_code, too_high.status_code) == (422, 422)


def test_only_platform_administrators_see_or_set_the_limits(client, db, halcyon):
    assert client.get(URL).status_code == 403
    assert save(client, halcyon).status_code == 403


def test_setting_the_limits_needs_the_password_again(client, db, halcyon):
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    log_in(client, "lena@example.com")

    unconfirmed = save(client, halcyon)

    assert unconfirmed.status_code == 403
    assert unconfirmed.json()["error"]["code"] == "password_confirmation_required"
    assert client.get(URL).status_code == 200  # reading does not


# ---------------------------------------------------------------- a limit below the usage (2a)


def test_a_limit_below_this_months_usage_is_refused_until_it_is_confirmed(lena, db, halcyon):
    used(db, halcyon, attempts=30)

    refused = save(lena, halcyon, attempts=20)

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "below_this_months_usage"
    message = refused.json()["error"]["message"]
    assert "The new attempts limit (20) is at or below this month's usage (30)." in message
    assert f"No new work can start until {limits.next_month_label()}." in message
    assert limits.limits_for(db, halcyon).attempts == 50_000  # nothing changed

    confirmed = save(lena, halcyon, attempts=20, confirmed=True)

    assert confirmed.status_code == 200
    assert limits.limits_for(db, halcyon).attempts == 20
    entry = db.scalars(select(AuditLogEntry).where(AuditLogEntry.chain == "platform")).all()[-1]
    assert entry.details["consequences"]


def test_a_limit_above_this_months_usage_needs_no_confirmation(lena, db, halcyon):
    used(db, halcyon, attempts=30)

    assert save(lena, halcyon, attempts=31).status_code == 200


# ---------------------------------------------------------------- the warning (step 5)


def test_the_organization_is_warned_once_a_month_when_a_limit_comes_close(lena, db, halcyon):
    save(lena, halcyon, attempts=10, warn_percent=80)
    used(db, halcyon, attempts=8)
    db.commit()

    first = limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon))
    again = limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon))

    assert (first, again) == (["attempts"], [])
    assert warnings_of(db, halcyon) == [("attempts", 80)]
    text = notified(db, "tom@example.com")[0].text
    assert "80% of the monthly limit: 8 of 10 attempts" in text
    assert len(notified(db, "nadia@example.com")) == 1  # the Security Manager too
    assert not notified(db, "priya@example.com")  # an analyst sets no budgets
    assert any("monthly limit" in mail["Subject"] for mail in outbox)


def test_nothing_is_warned_about_below_the_threshold_or_once_it_is_reached(lena, db, halcyon):
    save(lena, halcyon, attempts=10, warn_percent=80)
    used(db, halcyon, attempts=7)
    db.commit()

    assert (
        limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon)) == []
    )

    used(db, halcyon, attempts=3)  # now at the limit: UC-5.3, 3a1 speaks instead
    db.commit()

    assert (
        limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon)) == []
    )
    assert warnings_of(db, halcyon) == []


def test_the_page_shows_when_the_organization_was_warned(lena, db, halcyon):
    save(lena, halcyon, attempts=10)
    used(db, halcyon, attempts=9)
    db.commit()
    limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon))

    assert limit_of(row(lena), "attempts")["warned_at"] is not None
    assert limit_of(row(lena), "campaign_runs")["warned_at"] is None


def test_a_raised_limit_warns_again_only_when_the_new_threshold_is_crossed(lena, db, halcyon):
    save(lena, halcyon, attempts=10)
    used(db, halcyon, attempts=9)
    db.commit()
    limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon))
    save(lena, halcyon, attempts=100)
    db.commit()

    assert (
        limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon)) == []
    )
    assert len(notified(db, "tom@example.com")) == 1


def test_another_months_warning_does_not_stop_this_months(lena, db, halcyon):
    save(lena, halcyon, attempts=10)
    db.add(
        UsageLimitWarning(
            organization_id=halcyon,
            month=limits.month_start() - timedelta(days=40),
            kind="attempts",
            used_percent=85,
        )
    )
    used(db, halcyon, attempts=9)
    db.commit()

    assert limits.watch(db, halcyon, limits.limits_for(db, halcyon), limits.usage(db, halcyon)) == [
        "attempts"
    ]


# ---------------------------------------------------------------- the builder (Screen 34)
#
# The LLM cost estimate, which needs test suites, is in tests/m05_campaigns/test_campaigns.py.


def test_the_estimate_shows_the_month_against_the_limits(client, db, halcyon):
    used(db, halcyon, runs=3, attempts=100, cost="20")
    db.commit()

    response = client.post("/api/v1/campaigns/estimate", json={"suites": []})

    assert response.status_code == 200
    monthly = response.json()["monthly"]
    assert monthly["warn_percent"] == 80
    campaigns = next(row for row in monthly["limits"] if row["kind"] == "campaign_runs")
    assert (campaigns["used"], Decimal(campaigns["limit"])) == ("3", 100)
    assert next(row for row in monthly["limits"] if row["kind"] == "llm_cost")["percent"] == 20
