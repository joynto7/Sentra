"""The Monitoring component (FR-10.6, UC-10.9, Screen 63): how every part of Sentra is doing, the
alerts that come from it, and the thresholds a Platform Administrator sets.

It reads, it does not store metrics. Each component is asked at the moment the page is opened or
the clock ticks: the API's own rolling window (`app/core/metrics.py`), a Celery inspection for the
workers, the queue lengths in Redis, two queries for the database, a probe object and the free
space for the object storage, and the providers of FR-10.3 for the LLM layer. A time series
belongs in Prometheus (NFR-5.5), which scrapes `GET /api/metrics`.

Another module adds its own component with a `health.py` of its own that exports
`components(db, thresholds)`, the way modules join the clock with `schedules.py`. The Sentra
Shield row of Screen 63 is FR-8.3's, and until that module is there the row is not either.

Everything here is operational: no component reports anything of an organization (NFR-3.3).
"""

import logging
import os
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.core.email import send_email
from app.core.errors import FieldValidationError
from app.llm.config import LLMTask, model_for
from app.modules.m01_users.models import User
from app.modules.m05_campaigns.models import Attempt, CampaignRun
from app.modules.m10_admin.models import HealthThresholds, SystemAlert
from app.workers import extensions

log = logging.getLogger("uvicorn.error")

OPERATIONAL, WARNING, ALERT, UNKNOWN = "operational", "warning", "alert", "unknown"
ONLY_OPERATIONAL = "Only operational data is shown here, never organization content."
ALL_WELL = "All systems operational"
# The queues of celery_app.py: the campaign work and the LLM judge's own queue.
QUEUES = ("celery", "analysis")
# What each component is called, so an alert can be named without measuring anything. "shield" is
# FR-8.3's own component, which joins through its module's health.py.
LABELS = {
    "api": "API Server",
    "workers": "Background Workers",
    "queue": "Task Queue",
    "database": "Database",
    "object_storage": "Object Storage",
    "llm": "LLM Layer",
    "shield": "Sentra Shield gateways",
}
MIN_QUEUE, MAX_QUEUE = 1, 1_000_000
MIN_PERCENT, MAX_PERCENT = 1, 100
BAD_RANGE = "Use a whole number between 1 and 100."
BAD_QUEUE = "Use a number of jobs between 1 and 1,000,000."
BAD_MINUTES = "Use a number of minutes between 1 and 1,440."


@dataclass
class Component:
    key: str
    label: str
    status: str  # OPERATIONAL, WARNING, ALERT or UNKNOWN
    lines: list[str] = field(default_factory=list)  # what the card says, e.g. "p95 220 ms"
    # When it is not operational: the alert this component raises
    alert_kind: str = ""
    summary: str = ""
    effect: str = ""
    detail: dict = field(default_factory=dict)


@dataclass
class Thresholds:
    queue_length: int
    error_rate_percent: float
    worker_load_percent: int
    storage_percent: int
    gateway_silence_minutes: int
    custom: bool = False  # a Platform Administrator set them, instead of the platform's defaults
    updated_at: datetime | None = None
    set_by: str | None = None


@dataclass
class AlertRow:
    id: uuid.UUID
    component: str
    component_label: str
    kind: str
    summary: str
    effect: str
    opened_at: datetime
    last_seen_at: datetime
    repeats: int
    closed_at: datetime | None
    closed_automatically: bool


@dataclass
class Health:
    status: str  # the banner: OPERATIONAL, WARNING or ALERT
    headline: str  # "All systems operational" or "Degraded — 2 active alerts"
    components: list[Component]
    open_alerts: list[AlertRow]
    history: list[AlertRow]
    thresholds: Thresholds
    grafana_url: str
    logs_url: str
    notice: str = ONLY_OPERATIONAL


# ---------------------------------------------------------------- the thresholds (step 3)


def defaults() -> Thresholds:
    settings = get_settings()
    return Thresholds(
        queue_length=settings.default_queue_length_alert,
        error_rate_percent=float(settings.default_error_rate_alert),
        worker_load_percent=settings.default_worker_load_alert,
        storage_percent=settings.default_storage_alert,
        gateway_silence_minutes=settings.default_gateway_silence_minutes,
    )


def thresholds(db: Session) -> Thresholds:
    row = db.scalar(select(HealthThresholds).limit(1))
    if row is None:
        return defaults()
    return Thresholds(
        queue_length=row.queue_length,
        error_rate_percent=float(row.error_rate_percent),
        worker_load_percent=row.worker_load_percent,
        storage_percent=row.storage_percent,
        gateway_silence_minutes=row.gateway_silence_minutes,
        custom=True,
        updated_at=row.updated_at,
        set_by=db.get(User, row.set_by_id).name if row.set_by_id else None,
    )


def save_thresholds(db: Session, admin: User, wanted: Thresholds) -> Thresholds:
    """UC-10.9 step 3: the thresholds the Monitoring component measures against, from the next
    tick on. The change goes to the platform audit log."""
    if not MIN_QUEUE <= wanted.queue_length <= MAX_QUEUE:
        raise FieldValidationError("queue_length", BAD_QUEUE)
    for name, value in (
        ("error_rate_percent", wanted.error_rate_percent),
        ("worker_load_percent", wanted.worker_load_percent),
        ("storage_percent", wanted.storage_percent),
    ):
        if not MIN_PERCENT <= value <= MAX_PERCENT:
            raise FieldValidationError(name, BAD_RANGE)
    if not 1 <= wanted.gateway_silence_minutes <= 1_440:
        raise FieldValidationError("gateway_silence_minutes", BAD_MINUTES)

    before = thresholds(db)
    row = db.scalar(select(HealthThresholds).limit(1))
    if row is None:
        row = HealthThresholds()
        db.add(row)
    row.queue_length = wanted.queue_length
    row.error_rate_percent = Decimal(str(wanted.error_rate_percent))
    row.worker_load_percent = wanted.worker_load_percent
    row.storage_percent = wanted.storage_percent
    row.gateway_silence_minutes = wanted.gateway_silence_minutes
    row.set_by_id = admin.id
    audit.record(
        db,
        organization_id=None,
        actor=admin,
        action="platform.health_thresholds_changed",
        summary="Changed the alert thresholds of the system health page",
        item=None,
        details={
            "before": {
                "queue_length": before.queue_length,
                "error_rate_percent": before.error_rate_percent,
                "worker_load_percent": before.worker_load_percent,
                "storage_percent": before.storage_percent,
                "gateway_silence_minutes": before.gateway_silence_minutes,
            },
            "after": {
                "queue_length": wanted.queue_length,
                "error_rate_percent": wanted.error_rate_percent,
                "worker_load_percent": wanted.worker_load_percent,
                "storage_percent": wanted.storage_percent,
                "gateway_silence_minutes": wanted.gateway_silence_minutes,
            },
        },
    )
    db.commit()
    return thresholds(db)


# ---------------------------------------------------------------- the components (steps 1-2)


def api_server(limits: Thresholds) -> Component:
    from app.core import metrics

    found = metrics.summary()
    over = found.requests and found.error_rate_percent > limits.error_rate_percent
    lines = [
        f"p95 {found.p95_ms} ms · p50 {found.p50_ms} ms"
        if found.requests
        else "No request measured yet",
        f"errors {found.error_rate_percent} % of the last {found.requests} requests"
        if found.requests
        else "",
        f"up for {_duration(found.uptime_seconds)}",
    ]
    return Component(
        key="api",
        label=LABELS["api"],
        status=ALERT if over else OPERATIONAL,
        lines=[line for line in lines if line],
        alert_kind="error_rate",
        summary=f"Error rate above {limits.error_rate_percent} %",
        effect="Requests of the web app and the API are failing.",
        detail={"error_rate_percent": found.error_rate_percent, "requests": found.requests},
    )


def workers() -> tuple[int, int, int] | None:
    """(workers, jobs being run, capacity) from a Celery inspection, or None when the workers or
    the queue can't be reached."""
    try:
        from app.workers.celery_app import celery_app

        inspect = celery_app.control.inspect(timeout=2)
        stats, active = inspect.stats(), inspect.active()
    except Exception:  # redis down, no worker, a broken inspection: the page says "unknown"
        return None
    if not stats:
        return None
    capacity = sum(
        len(worker.get("pool", {}).get("processes", [])) or 1 for worker in stats.values()
    )
    running = sum(len(jobs) for jobs in (active or {}).values())
    return len(stats), running, capacity


def background_workers(limits: Thresholds) -> Component:
    found = workers()
    if found is None:
        return Component(
            key="workers",
            label=LABELS["workers"],
            status=UNKNOWN,
            lines=["No worker could be reached"],
            alert_kind="unreachable",
            summary="No background worker is reporting",
            effect="Campaign runs, reports and e-mails are not being worked on.",
        )
    count, running, capacity = found
    load = int(running / capacity * 100) if capacity else 0
    return Component(
        key="workers",
        label=LABELS["workers"],
        status=WARNING if load >= limits.worker_load_percent else OPERATIONAL,
        lines=[
            f"{count} worker{'' if count == 1 else 's'}",
            f"load {load} % ({running} of {capacity})",
        ],
        alert_kind="load",
        summary=f"Worker load above {limits.worker_load_percent} %",
        effect="New jobs wait longer before a worker takes them.",
        detail={"load_percent": load, "workers": count},
    )


def queue_lengths() -> dict[str, int] | None:
    try:
        import redis

        client = redis.Redis.from_url(get_settings().redis_url, socket_timeout=2)
        return {name: int(client.llen(name)) for name in QUEUES}
    except Exception:
        return None


def task_queue(limits: Thresholds) -> Component:
    found = queue_lengths()
    if found is None:
        return Component(
            key="queue",
            label=LABELS["queue"],
            status=UNKNOWN,
            lines=["The queue can't be reached"],
            alert_kind="unreachable",
            summary="The Task Queue can't be reached",
            effect="Nothing new can be started in the background.",
        )
    waiting = sum(found.values())
    return Component(
        key="queue",
        label=LABELS["queue"],
        status=ALERT if waiting > limits.queue_length else OPERATIONAL,
        lines=[
            f"{waiting:,} job{'' if waiting == 1 else 's'} waiting",
            f"threshold {limits.queue_length:,}",
        ],
        alert_kind="too_long",
        summary=f"Queue length above {limits.queue_length:,}",
        effect="Campaign runs may start late.",
        detail={"waiting": waiting, "queues": found},
    )


def database(db: Session) -> Component:
    try:
        size = db.scalar(text("SELECT pg_database_size(current_database())")) or 0
        used = db.scalar(text("SELECT count(*) FROM pg_stat_activity")) or 0
        allowed = int(db.scalar(text("SHOW max_connections")) or 0)
    except SQLAlchemyError as exc:
        return Component(
            key="database",
            label=LABELS["database"],
            status=ALERT,
            lines=["The database can't be queried"],
            alert_kind="unreachable",
            summary="The database can't be queried",
            effect="Sentra cannot read or write anything.",
            detail={"error": str(exc)[:200]},
        )
    share = int(used / allowed * 100) if allowed else 0
    return Component(
        key="database",
        label=LABELS["database"],
        status=WARNING if share >= 90 else OPERATIONAL,
        lines=[f"{size / 1_048_576:.0f} MB", f"{used} of {allowed} connections in use"],
        alert_kind="connections",
        summary="Almost every database connection is in use",
        effect="Requests may have to wait for a connection.",
        detail={"connections_percent": share},
    )


def object_storage(limits: Thresholds) -> Component:
    """Evidence and reports (FR-6.3, FR-9.1). A stored object is read-only on purpose (NFR-2.4),
    so the check is that the directory is there and can be written in, and how much of its disk is
    left — not a probe object, which would leave something behind on every tick."""
    root = Path(get_settings().object_storage_dir)
    if not root.is_dir() or not os.access(root, os.W_OK):
        return Component(
            key="object_storage",
            label=LABELS["object_storage"],
            status=ALERT,
            lines=[f"{root} can't be written in"],
            alert_kind="unwritable",
            summary="Objects can't be stored",
            effect="New evidence and reports can't be kept.",
            detail={"directory": str(root)},
        )
    lines, share = ["Readable and writable"], 0
    try:
        usage = shutil.disk_usage(root)
        share = int(usage.used / usage.total * 100) if usage.total else 0
        lines.append(f"{share} % of its disk used")
    except OSError:
        lines.append("Free space unknown")
    return Component(
        key="object_storage",
        label=LABELS["object_storage"],
        status=WARNING if share >= limits.storage_percent else OPERATIONAL,
        lines=lines,
        alert_kind="disk_filling",
        summary=f"Object storage above {limits.storage_percent} % of its disk",
        effect="Evidence and reports will stop being stored when the disk is full.",
        detail={"disk_percent": share},
    )


def llm_layer(db: Session) -> Component:
    """UC-10.9, 4b: whether each configured provider answered its last test, and which campaign
    runs are waiting because a model can't be reached."""
    reachable, unreachable, lines = [], [], []
    for task in LLMTask:
        choice = model_for(db, task)
        if choice is None:
            continue
        name = choice.provider_label or choice.provider
        if name in reachable or name in unreachable:
            continue  # one line per provider, however many tasks it serves
        (reachable if _provider_answered(db, choice) else unreachable).append(name)
    for name in reachable:
        lines.append(f"{name} reachable")
    for name in unreachable:
        lines.append(f"{name} did not answer its last test")
    waiting = _runs_waiting_for_a_model(db)
    if waiting:
        lines.append(f"{len(waiting)} campaign run{'' if len(waiting) == 1 else 's'} waiting")
    if not lines:
        lines.append("No provider is configured")
    return Component(
        key="llm",
        label=LABELS["llm"],
        status=ALERT if unreachable else OPERATIONAL,
        lines=lines,
        alert_kind="provider_unavailable",
        summary=f"An LLM provider can't be reached: {', '.join(unreachable)}",
        effect="Campaign runs that need a model pause and try again with increasing delays.",
        detail={"providers": unreachable, "runs_waiting": waiting},
    )


def _provider_answered(db: Session, choice) -> bool:
    """The provider's last connection test (FR-10.3). A provider that was never tested — the
    settings named its model — counts as reachable until a request says otherwise."""
    from app.llm.models import LLMProvider

    if choice.provider_id is None:
        return True
    provider = db.get(LLMProvider, choice.provider_id)
    return provider is None or provider.tested_at is None or provider.test_duration_ms is not None


def _runs_waiting_for_a_model(db: Session) -> list[str]:
    """UC-10.9, 4b: the campaign runs that have an attempt still waiting for the LLM judge's
    verdict, which is what an unreachable provider holds up (UC-6.1, 3a: the judge tries again
    with increasing delays, NFR-2.3). The number is operational; no run's content is read."""
    from app.modules.m04_tests.schema import DetectionMethod
    from app.modules.m06_findings.models import DetectionResult, Outcome

    rows = db.scalars(
        select(CampaignRun.id)
        .join(Attempt, Attempt.campaign_run_id == CampaignRun.id)
        .join(DetectionResult, DetectionResult.attempt_id == Attempt.id)
        .where(
            DetectionResult.method == DetectionMethod.LLM_JUDGE,
            DetectionResult.outcome == Outcome.PENDING,
        )
        .distinct()
    ).all()
    return [str(row) for row in rows]


def own_components(db: Session, limits: Thresholds) -> list[Component]:
    """The components Sentra itself is made of, in the order of Screen 63."""
    return [
        api_server(limits),
        background_workers(limits),
        task_queue(limits),
        database(db),
        object_storage(limits),
        llm_layer(db),
    ]


def _extensions(db: Session, limits: Thresholds) -> list[Component]:
    """Every other module's own components, e.g. the Sentra Shield gateways of FR-8.3."""
    found: list[Component] = []
    for module in extensions.discover("health", skip=("m10_admin",)):
        result, error = extensions.call(db, module, "components", limits)
        if error:
            log.error("The health of %s could not be read: %s", extensions.label(module), error)
        elif result:
            found.extend(result)
    return found


def collect(db: Session, limits: Thresholds | None = None) -> list[Component]:
    found = limits or thresholds(db)
    return own_components(db, found) + _extensions(db, found)


# ---------------------------------------------------------------- the alerts (steps 4-6)


def _row(alert: SystemAlert, labels: dict[str, str]) -> AlertRow:
    return AlertRow(
        id=alert.id,
        component=alert.component,
        component_label=labels.get(alert.component, alert.component),
        kind=alert.kind,
        summary=alert.summary,
        effect=alert.effect,
        opened_at=alert.opened_at,
        last_seen_at=alert.last_seen_at,
        repeats=alert.repeats,
        closed_at=alert.closed_at,
        closed_automatically=alert.closed_automatically,
    )


def check(db: Session, limits: Thresholds | None = None) -> tuple[list[SystemAlert], int]:
    """UC-10.9 steps 4 and 6, run by the clock every tick: a component that is not operational
    raises an alert — the same cause only ever once, counted in `repeats` — and a component that
    recovered closes its own. Returns the alerts it opened and how many it closed."""
    found = limits or thresholds(db)
    components = collect(db, found)
    open_now = {
        (alert.component, alert.kind): alert
        for alert in db.scalars(select(SystemAlert).where(SystemAlert.closed_at.is_(None)))
    }
    opened, closed, now = [], 0, datetime.now(UTC)
    wrong = {
        (component.key, component.alert_kind): component
        for component in components
        if component.status in (WARNING, ALERT, UNKNOWN) and component.alert_kind
    }
    for key, component in wrong.items():
        existing = open_now.get(key)
        if existing is not None:
            existing.repeats += 1
            existing.last_seen_at = now
            continue
        alert = SystemAlert(
            component=component.key,
            kind=component.alert_kind,
            summary=component.summary[:200],
            effect=component.effect[:300],
            detail=component.detail,
            opened_at=now,
            last_seen_at=now,
        )
        db.add(alert)
        opened.append(alert)
    for key, alert in open_now.items():
        if key in wrong:
            continue
        alert.closed_at, alert.closed_automatically = now, True
        closed += 1
    db.commit()
    for alert in opened:
        _tell(db, alert)
    return opened, closed


def _tell(db: Session, alert: SystemAlert) -> None:
    """UC-10.9 step 4: the Platform Administrators hear about a new alert. They belong to no
    organization, so this is an e-mail and a platform audit entry, like the messages
    `data_sharing.py` sends them — not an organization's notification (FR-9.3)."""
    settings = get_settings()
    links = [url for url in (settings.grafana_url, settings.logs_url) if url]
    where = f"\n\nWhere to look: {', '.join(links)}" if links else ""
    audit.record(
        db,
        organization_id=None,
        action="platform.system_alert_raised",
        summary=f"{alert.summary} ({alert.component})",
        item=audit.Item("system_alert", alert.id, alert.summary),
        details={"effect": alert.effect, **alert.detail},
        source_address=None,
    )
    db.commit()
    for admin in db.scalars(select(User).where(User.platform_admin.is_(True))):
        send_email(
            admin.email,
            f"Sentra: {alert.summary}",
            f"Hello {admin.name},\n\n{alert.summary}.\n\n{alert.effect}{where}\n",
        )


def alerts(db: Session, *, history: int = 20) -> tuple[list[AlertRow], list[AlertRow]]:
    labels = LABELS
    open_rows = db.scalars(
        select(SystemAlert)
        .where(SystemAlert.closed_at.is_(None))
        .order_by(SystemAlert.opened_at.desc())
    ).all()
    closed_rows = db.scalars(
        select(SystemAlert)
        .where(SystemAlert.closed_at.is_not(None))
        .order_by(SystemAlert.closed_at.desc())
        .limit(history)
    ).all()
    return (
        [_row(alert, labels) for alert in open_rows],
        [_row(alert, labels) for alert in closed_rows],
    )


def page(db: Session) -> Health:
    """Screen 63: the banner, every component, the open alerts, the thresholds and the history."""
    limits = thresholds(db)
    components = collect(db, limits)
    open_rows, history = alerts(db)
    states = {component.status for component in components}
    count = len(open_rows)
    # An alert that is still open is the platform's state too, even when every component answers
    # again: it has not been dealt with yet.
    worst = (
        ALERT
        if ALERT in states
        else WARNING
        if states & {WARNING, UNKNOWN} or count
        else OPERATIONAL
    )
    settings = get_settings()
    return Health(
        status=worst,
        headline=ALL_WELL
        if worst == OPERATIONAL and not count
        else f"Degraded — {count} active alert{'' if count == 1 else 's'}",
        components=components,
        open_alerts=open_rows,
        history=history,
        thresholds=limits,
        grafana_url=settings.grafana_url,
        logs_url=settings.logs_url,
    )


def _duration(seconds: int) -> str:
    if seconds < 3_600:
        return f"{max(1, seconds // 60)} min"
    if seconds < 86_400:
        return f"{seconds // 3_600} h"
    return f"{seconds // 86_400} days"
