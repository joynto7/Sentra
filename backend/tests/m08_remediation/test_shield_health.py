"""FR-8.3 (M8) with FR-10.6 (M10): the Sentra Shield gateways on System Health. UC-10.9 steps 1-2
(the gateways' row of Screen 63, with each gateway's last contact), step 4 (the alert of a gateway
that went silent, for the Platform Administrators), step 6 (it closes when the gateway reports
again) and 4a1 (the target's developers and administrators are told, once for each silence).

Gateways connect with the helpers of test_shield.py. A silence is made by moving a gateway's last
contact back in time, or by asking the clock about a later moment, as the next ticks would.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import metrics
from app.core.audit import AuditLogEntry
from app.core.email import outbox
from app.modules.m01_users.models import User
from app.modules.m08_remediation import schedules
from app.modules.m08_remediation.health import SILENT
from app.modules.m09_reporting.models import Notification
from app.modules.m10_admin import health
from app.modules.m10_admin.models import SystemAlert
from app.workers import scheduler
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m08_remediation.test_shield import DEVELOPER, SHIELD, announce, beat, connect, stored

URL = "/api/v1/admin/platform/health"
LENA = "lena@example.com"  # a Platform Administrator


@pytest.fixture(autouse=True)
def _components(monkeypatch):
    """The other components answer as a healthy platform would, as in test_system_health.py."""
    monkeypatch.setattr(health, "workers", lambda: (2, 1, 10))
    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 0, "analysis": 0})
    metrics.reset()


def as_lena(team) -> None:
    """Lena logs in with her password confirmed; she is made a Platform Administrator once."""
    if team.db.scalar(select(User).where(User.email == LENA)) is None:
        new_user(team.db, LENA)
        team.db.scalar(select(User).where(User.email == LENA)).platform_admin = True
        team.db.commit()
    log_in(team.client, LENA)
    confirmed = team.client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    assert confirmed.status_code == 204


def shield_row(team) -> dict:
    as_lena(team)
    response = team.client.get(URL)
    assert response.status_code == 200
    return next(c for c in response.json()["components"] if c["key"] == "shield")


def connected(team, version: str = "1.4.0") -> str:
    """A gateway that has connected to the developer's target; returns its credential."""
    credential = connect(team)["credential"]
    announce(team, credential, version=version)
    return credential


def silent_for(team, minutes: int) -> None:
    gateway = stored(team.db)
    gateway.last_contact_at = datetime.now(UTC) - timedelta(minutes=minutes)
    team.db.commit()


def told(team) -> list[str]:
    """Who has been told about a silent gateway, one address per notification."""
    return sorted(
        team.db.scalars(
            select(User.email)
            .join(Notification, Notification.user_id == User.id)
            .where(Notification.event == "shield_gateway_silent")
        )
    )


def shield_alerts(team) -> list[SystemAlert]:
    return list(team.db.scalars(select(SystemAlert).where(SystemAlert.component == "shield")))


# ---------------------------------------------------------------- the row (steps 1-2)


def test_the_row_says_when_no_gateway_has_connected(team):
    connect(team)  # registered, but the gateway itself never connected: nothing to watch yet

    row = shield_row(team)

    assert (row["label"], row["status"]) == ("Sentra Shield gateways", "operational")
    assert row["lines"] == ["No gateway is connected"]


def test_a_connected_gateway_shows_its_version_and_last_contact_and_not_its_target(team):
    credential = connected(team)
    beat(team, credential, requests=3)

    row = shield_row(team)

    assert row["status"] == "operational"
    assert row["lines"][0] == "1 of 1 heard from in the last 5 min"
    assert row["lines"][1].startswith(f"{credential[:10]}… · 1.4.0 · last contact ")
    assert row["lines"][1].endswith(" s ago")
    # NFR-3.3: the platform's page shows operational data, never the organization's content
    assert team.agent.name not in " ".join(row["lines"])


# ---------------------------------------------------------------- the alert (steps 3, 4 and 6)


def test_a_gateway_silent_past_the_threshold_raises_one_alert_for_the_administrators(team):
    credential = connected(team)
    silent_for(team, 6)  # the platform's default threshold is 5 minutes
    as_lena(team)
    outbox.clear()

    opened, _ = health.check(team.db)

    assert [(alert.component, alert.kind) for alert in opened] == [("shield", "silent")]
    alert = opened[0]
    assert alert.summary == "A Sentra Shield gateway has been silent for more than 5 min"
    assert "keeps enforcing its last policy" in alert.effect
    assert alert.detail == {"gateways": [credential[:10]], "silence_minutes": 5}
    assert [mail["To"] for mail in outbox] == [LENA]
    row = shield_row(team)
    assert (row["status"], row["lines"][0]) == ("alert", "0 of 1 heard from in the last 5 min")
    assert "last contact 6 min ago" in row["lines"][1]

    assert health.check(team.db)[0] == []  # the same cause is counted, not raised again
    assert shield_alerts(team)[0].repeats == 2


def test_a_gateway_that_reports_again_closes_its_alert(team):
    credential = connected(team)
    silent_for(team, 6)
    health.check(team.db)

    beat(team, credential, requests=1)
    _, closed = health.check(team.db)

    assert closed == 1
    assert shield_alerts(team)[0].closed_automatically
    assert shield_row(team)["status"] == "operational"


def test_the_platform_administrators_threshold_decides_when_a_silence_is_an_alert(team):
    connected(team)
    as_lena(team)
    changed = team.client.put(
        f"{URL}/thresholds",
        json={
            "queue_length": 1_000,
            "error_rate_percent": 2,
            "worker_load_percent": 90,
            "storage_percent": 85,
            "gateway_silence_minutes": 30,
        },
    )
    assert changed.status_code == 200, changed.text

    silent_for(team, 20)
    assert shield_row(team)["status"] == "operational"
    assert health.check(team.db)[0] == []
    assert schedules.due(team.db) is False

    silent_for(team, 31)
    assert shield_row(team)["status"] == "alert"


def test_a_revoked_gateway_is_not_watched(team):
    connected(team)
    silent_for(team, 60)
    log_in(team.client, DEVELOPER)
    assert team.client.post(f"{SHIELD}/targets/{team.agent.id}/revoke").status_code == 200

    assert shield_row(team)["lines"] == ["No gateway is connected"]
    assert health.check(team.db)[0] == []
    assert schedules.due(team.db) is False


# ---------------------------------------------------------------- 4a1: the target's people


def test_the_targets_developers_and_administrators_are_told_once_for_each_silence(team):
    credential = connected(team)
    silent_for(team, 6)
    now = datetime.now(UTC)

    assert schedules.due(team.db, now) is True

    # Maya develops the target and Tom administers the organization; the analyst and the
    # manager are not told
    assert told(team) == ["maya@example.com", "tom@example.com"]
    note = team.db.scalar(select(Notification).where(Notification.event == "shield_gateway_silent"))
    assert note.subject == f"Sentra Shield gateway of {team.agent.name} stopped reporting"
    assert "It keeps enforcing its last policy" in note.text
    assert note.link == f"/targets/{team.agent.id}/shield"
    entry = team.db.scalar(select(AuditLogEntry).where(AuditLogEntry.action == SILENT))
    assert entry.organization_id == team.org and entry.actor_name == "Sentra"
    assert entry.summary == f"The Sentra Shield gateway of {team.agent.name} stopped reporting"
    assert entry.details["people_told"] == 2

    assert schedules.due(team.db, now + timedelta(minutes=1)) is False  # the same silence
    assert len(told(team)) == 2

    beat(team, credential, requests=1)  # it reports again, and later goes silent again
    assert schedules.due(team.db, now + timedelta(minutes=2)) is False
    assert schedules.due(team.db, now + timedelta(minutes=8)) is True
    assert told(team) == ["maya@example.com"] * 2 + ["tom@example.com"] * 2


def test_the_clock_reports_a_silence_on_its_tick(team):
    connected(team)
    silent_for(team, 6)
    as_lena(team)
    outbox.clear()

    scheduler.tick(team.db)

    assert told(team) == ["maya@example.com", "tom@example.com"]  # 4a1, from schedules.py
    assert [alert.kind for alert in shield_alerts(team)] == ["silent"]  # step 4, from Module 10
    assert LENA in [mail["To"] for mail in outbox]
