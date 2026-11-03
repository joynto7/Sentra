from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import __version__
from app.core import metrics
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import NotAuthenticatedError

router = APIRouter(tags=["System"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    """Liveness check used by Docker, CI and the web interface."""
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except SQLAlchemyError:
        database = "unavailable"
    status = "ok" if database == "ok" else "degraded"
    return JSONResponse(
        {"status": status, "database": database, "version": __version__},
        status_code=200 if status == "ok" else 503,
    )


@router.get("/metrics", response_class=PlainTextResponse)
def prometheus_metrics(authorization: str = Header(default="")) -> PlainTextResponse:
    """The API's own operational metrics in Prometheus text format (NFR-5.5), for a Prometheus to
    scrape and a Grafana to draw. It exports what this process knows about itself and nothing of
    any organization (NFR-3.3); the database, Redis and Celery export their own metrics.

    Open while METRICS_TOKEN is empty, as a scrape target inside the deployment's own network;
    with a token set it must arrive as `Authorization: Bearer <token>`.
    """
    token = get_settings().metrics_token
    if token and authorization.removeprefix("Bearer ").strip() != token:
        raise NotAuthenticatedError("This endpoint needs the metrics token.")
    found = metrics.summary()
    lines = [
        "# HELP sentra_build_info The running version of Sentra.",
        "# TYPE sentra_build_info gauge",
        f'sentra_build_info{{version="{__version__}"}} 1',
        "# HELP sentra_uptime_seconds How long this API process has been running.",
        "# TYPE sentra_uptime_seconds gauge",
        f"sentra_uptime_seconds {found.uptime_seconds}",
        "# HELP sentra_api_requests The requests in this process's window.",
        "# TYPE sentra_api_requests gauge",
        f"sentra_api_requests {found.requests}",
        "# HELP sentra_api_server_errors The requests in the window that failed with a 5xx.",
        "# TYPE sentra_api_server_errors gauge",
        f"sentra_api_server_errors {found.server_errors}",
        "# HELP sentra_api_request_duration_ms The response time of the window, in milliseconds.",
        "# TYPE sentra_api_request_duration_ms summary",
        f'sentra_api_request_duration_ms{{quantile="0.5"}} {found.p50_ms}',
        f'sentra_api_request_duration_ms{{quantile="0.95"}} {found.p95_ms}',
    ]
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
