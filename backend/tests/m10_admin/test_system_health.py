"""FR-10.6 (M10) System Health Monitoring: UC-10.9 Monitor System Health end to end — every
component's status, the thresholds of step 3, the alert of step 4 with its e-mail, the automatic
close of step 6, the repeats of quality requirement 4, and 4b.

Nothing is measured against a real worker or a real Redis: the tests replace what each component
reads, the way a Prometheus would see it.
"""

import pytest
from sqlalchemy import select

from app.core import metrics
from app.core.audit import AuditLogEntry
from app.core.config import get_settings
from app.core.email import outbox
from app.modules.m01_users.models import User
from app.modules.m10_admin import health
from app.modules.m10_admin.models import HealthThresholds, SystemAlert
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import organization_with

URL = "/api/v1/admin/platform/health"


@pytest.fixture(autouse=True)
def _components(monkeypatch):
    """Every component answers as a healthy platform would: two workers with room, empty queues.
    A test that wants a problem replaces one of these."""
    monkeypatch.setattr(health, "workers", lambda: (2, 1, 10))
    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 0, "analysis": 0})
    metrics.reset()


@pytest.fixture
def lena(client, db):
    """Lena, a Platform Administrator, logged in with her password confirmed."""
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    log_in(client, "lena@example.com")
    assert (
        client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD}).status_code == 204
    )
    return client


def page(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200
    return response.json()


def component(body: dict, key: str) -> dict:
    return next(c for c in body["components"] if c["key"] == key)


def thresholds(client, **changes):
    body = {
        "queue_length": 1_000,
        "error_rate_percent": 2,
        "worker_load_percent": 90,
        "storage_percent": 85,
        "gateway_silence_minutes": 5,
        **changes,
    }
    return client.put(f"{URL}/thresholds", json=body)


def actions(db) -> list[str]:
    return list(
        db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.chain == "platform")
            .order_by(AuditLogEntry.seq)
        )
    )


def open_alerts(db) -> list[SystemAlert]:
    return list(
        db.scalars(
            select(SystemAlert).where(SystemAlert.closed_at.is_(None)).order_by(SystemAlert.kind)
        )
    )


# ---------------------------------------------------------------- the page (steps 1-2)


def test_every_component_of_sentra_is_on_the_page(lena, db):
    body = page(lena)

    assert [c["key"] for c in body["components"]] == [
        "api",
        "workers",
        "queue",
        "database",
        "object_storage",
        "llm",
        "shield",  # Module 8's own component (m08_remediation/health.py)
    ]
    assert body["status"] == "operational" and body["headline"] == "All systems operational"
    assert component(body, "workers")["lines"] == ["2 workers", "load 10 % (1 of 10)"]
    assert "0 jobs waiting" in component(body, "queue")["lines"]
    assert any("connections in use" in line for line in component(body, "database")["lines"])
    assert "Readable and writable" in component(body, "object_storage")["lines"]
    assert "never organization content" in body["notice"]


def test_the_api_reports_its_own_response_times(lena, db):
    page(lena)  # a few requests of its own

    body = page(lena)

    lines = component(body, "api")["lines"]
    assert any(line.startswith("p95 ") for line in lines)
    assert any("errors 0.0 %" in line for line in lines)
    assert any(line.startswith("up for ") for line in lines)


def test_a_component_that_cannot_be_reached_is_unknown(lena, db, monkeypatch):
    monkeypatch.setattr(health, "workers", lambda: None)
    monkeypatch.setattr(health, "queue_lengths", lambda: None)

    body = page(lena)

    assert component(body, "workers")["status"] == "unknown"
    assert component(body, "queue")["status"] == "unknown"
    assert body["status"] == "warning" and "Degraded" in body["headline"]


def test_the_llm_layer_says_which_providers_answer(lena, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_model", "anthropic/claude-sonnet-5-5")

    lines = component(page(lena), "llm")["lines"]

    assert lines == ["anthropic reachable"]


def test_without_a_provider_the_llm_layer_says_so(lena, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_model", "")

    assert component(page(lena), "llm")["lines"] == ["No provider is configured"]


def test_only_platform_administrators_see_the_health_page(client, db):
    organization_with(db, client, {})

    assert client.get(URL).status_code == 403
    assert thresholds(client).status_code == 403


# ---------------------------------------------------------------- the thresholds (step 3)


def test_the_platforms_defaults_are_in_force_until_they_are_set(lena, db):
    found = page(lena)["thresholds"]

    assert (found["queue_length"], found["error_rate_percent"]) == (1_000, 2.0)
    assert found["custom"] is False and found["set_by"] is None
    assert db.scalar(select(HealthThresholds)) is None


def test_a_platform_administrator_sets_the_thresholds(lena, db):
    response = thresholds(lena, queue_length=50, error_rate_percent=5, worker_load_percent=75)

    assert response.status_code == 200
    found = response.json()["thresholds"]
    assert (found["queue_length"], found["error_rate_percent"], found["custom"]) == (50, 5.0, True)
    assert found["set_by"] == "Lena"
    assert health.thresholds(db).queue_length == 50
    assert actions(db) == ["platform.health_thresholds_changed"]


def test_a_threshold_outside_what_can_be_measured_is_refused(lena):
    assert thresholds(lena, queue_length=0).status_code == 422
    assert thresholds(lena, error_rate_percent=0).status_code == 422
    assert thresholds(lena, storage_percent=101).status_code == 422
    assert thresholds(lena, gateway_silence_minutes=0).status_code == 422


def test_setting_the_thresholds_needs_the_password_again(client, db):
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    log_in(client, "lena@example.com")

    refused = thresholds(client)

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "password_confirmation_required"
    assert client.get(URL).status_code == 200


# ---------------------------------------------------------------- the alerts (steps 4-6)


def test_a_queue_above_its_threshold_raises_one_alert_and_tells_the_administrators(
    lena, db, monkeypatch
):
    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 1_200, "analysis": 0})
    thresholds(lena, queue_length=1_000)
    outbox.clear()

    opened, closed = health.check(db)

    assert [alert.kind for alert in opened] == ["too_long"]
    assert closed == 0
    alert = open_alerts(db)[0]
    assert (alert.component, alert.summary) == ("queue", "Queue length above 1,000")
    assert alert.effect == "Campaign runs may start late."
    assert alert.detail["waiting"] == 1_200
    assert [mail["To"] for mail in outbox] == ["lena@example.com"]
    assert "Queue length above 1,000" in outbox[-1]["Subject"]
    assert actions(db)[-1] == "platform.system_alert_raised"


def test_the_same_cause_is_counted_and_not_raised_again(lena, db, monkeypatch):
    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 1_200, "analysis": 0})
    health.check(db)
    outbox.clear()

    opened, _ = health.check(db)

    assert opened == []
    assert len(open_alerts(db)) == 1
    assert open_alerts(db)[0].repeats == 2
    assert outbox == []  # the administrators are not told twice


def test_a_component_that_recovered_closes_its_own_alert(lena, db, monkeypatch):
    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 1_200, "analysis": 0})
    health.check(db)

    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 3, "analysis": 0})
    opened, closed = health.check(db)

    assert (opened, closed) == ([], 1)
    assert open_alerts(db) == []
    alert = db.scalar(select(SystemAlert))
    assert alert.closed_at is not None and alert.closed_automatically is True


def test_the_page_shows_the_open_alerts_and_the_closed_ones_as_history(lena, db, monkeypatch):
    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 1_200, "analysis": 0})
    health.check(db)
    monkeypatch.setattr(health, "workers", lambda: None)
    health.check(db)

    body = page(lena)

    assert body["status"] == "alert"
    assert "2 active alerts" in body["headline"]
    assert {alert["component"] for alert in body["open_alerts"]} == {"queue", "workers"}
    queue_alert = next(a for a in body["open_alerts"] if a["component"] == "queue")
    assert (queue_alert["component_label"], queue_alert["repeats"]) == ("Task Queue", 2)

    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 0, "analysis": 0})
    monkeypatch.setattr(health, "workers", lambda: (2, 1, 10))
    health.check(db)

    after = page(lena)
    assert after["open_alerts"] == []
    assert {alert["component"] for alert in after["history"]} == {"queue", "workers"}
    assert all(alert["closed_automatically"] for alert in after["history"])
    assert after["headline"] == "All systems operational"


def test_an_error_rate_above_its_threshold_is_an_alert(lena, db):
    thresholds(lena, error_rate_percent=10)
    for _ in range(10):
        metrics.record(12.0, 500)

    opened, _ = health.check(db)

    assert [alert.kind for alert in opened] == ["error_rate"]
    assert component(page(lena), "api")["status"] == "alert"


def test_the_clock_checks_the_health_every_tick(lena, db, monkeypatch):
    from app.modules.m10_admin import schedules

    monkeypatch.setattr(health, "queue_lengths", lambda: {"celery": 5_000, "analysis": 0})

    assert schedules.due(db) is True
    assert len(open_alerts(db)) == 1
    assert schedules.due(db) is False  # the same cause changes nothing


def test_the_alerts_link_to_grafana_and_the_logs_when_they_are_configured(lena, db, monkeypatch):
    assert page(lena)["grafana_url"] == ""

    monkeypatch.setattr(get_settings(), "grafana_url", "https://grafana.example.com/d/sentra")
    monkeypatch.setattr(get_settings(), "logs_url", "https://logs.example.com/sentra")

    body = page(lena)

    assert body["grafana_url"].endswith("/d/sentra")
    assert body["logs_url"].startswith("https://logs.example.com")


# ---------------------------------------------------------------- Prometheus (NFR-5.5)


def test_the_api_exports_its_metrics_for_prometheus(client):
    metrics.record(42.0, 200)

    response = client.get("/api/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    body = response.text
    assert "sentra_api_requests " in body
    assert 'sentra_api_request_duration_ms{quantile="0.95"}' in body
    assert "sentra_uptime_seconds " in body
    assert "halcyon" not in body.lower()  # nothing of an organization (NFR-3.3)


def test_the_metrics_need_the_token_when_one_is_set(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "metrics_token", "scrape-me")

    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.get("/api/metrics", headers={"Authorization": "Bearer scrape-me"})
    assert ok.status_code == 200


# ---------------------------------------------------------------- 4b, a provider out of reach


def test_the_llm_row_names_the_runs_that_wait_for_a_verdict(lena, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_model", "anthropic/claude-sonnet-5-5")
    monkeypatch.setattr(health, "_runs_waiting_for_a_model", lambda _db: ["R-001-1", "R-002-1"])

    lines = component(page(lena), "llm")["lines"]

    assert "2 campaign runs waiting" in lines


REAL_WORKERS = health.workers  # the tests' set-up replaces it


class FakeInspect:
    """Celery's inspection, which waits its whole timeout unless it knows how many will answer."""

    def __init__(self, calls, timeout, limit=None):
        calls.append({"timeout": timeout, "limit": limit})

    def stats(self):
        return {"worker-1": {"pool": {"processes": [1, 2]}}, "worker-2": {"pool": {"processes": [1]}}}

    def active(self):
        return {"worker-1": [{"id": "a"}], "worker-2": []}


def test_the_second_inspection_stops_waiting_when_every_worker_has_answered(monkeypatch):
    from app.workers.celery_app import celery_app

    calls = []
    monkeypatch.setattr(
        celery_app.control,
        "inspect",
        lambda timeout, limit=None: FakeInspect(calls, timeout, limit),
    )

    assert REAL_WORKERS() == (2, 1, 3)
    assert calls == [{"timeout": 1, "limit": None}, {"timeout": 1, "limit": 2}]
