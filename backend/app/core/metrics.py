"""What this API process has done, for the system health page and for Prometheus (FR-10.6,
NFR-5.5).

A middleware keeps the last `WINDOW` requests — how long each took and whether it failed — in
memory, and `summary()` turns them into the figures Screen 63 shows: the p95 response time and the
share of requests that answered with a server error. It is deliberately this process's own window:
Sentra cannot see another container's requests without a metrics pipeline, so the page says whose
numbers these are instead of implying a platform-wide figure.

Nothing here is kept between restarts, and no request path, user or organization is recorded — the
window holds a duration and a status code, nothing that belongs to an organization (NFR-3.3).
"""

import threading
import time
from collections import deque
from dataclasses import dataclass

WINDOW = 500  # requests
_started = time.monotonic()
_lock = threading.Lock()
_requests: deque[tuple[float, int]] = deque(maxlen=WINDOW)  # (duration in ms, status code)


@dataclass(frozen=True)
class Summary:
    requests: int  # in the window
    window: int
    p50_ms: int
    p95_ms: int
    server_errors: int
    error_rate_percent: float
    uptime_seconds: int


def record(duration_ms: float, status_code: int) -> None:
    with _lock:
        _requests.append((duration_ms, status_code))


def summary() -> Summary:
    with _lock:
        rows = list(_requests)
    uptime = int(time.monotonic() - _started)
    if not rows:
        return Summary(0, WINDOW, 0, 0, 0, 0.0, uptime)
    durations = sorted(duration for duration, _ in rows)
    errors = sum(1 for _, status in rows if status >= 500)
    return Summary(
        requests=len(rows),
        window=WINDOW,
        p50_ms=int(_quantile(durations, 0.50)),
        p95_ms=int(_quantile(durations, 0.95)),
        server_errors=errors,
        error_rate_percent=round(errors / len(rows) * 100, 2),
        uptime_seconds=uptime,
    )


def _quantile(sorted_values: list[float], share: float) -> float:
    """The value at `share` of the sorted window, the nearest-rank way: with 500 requests the p95
    is the 475th, which is what "95 % of requests were at least this fast" means."""
    if not sorted_values:
        return 0.0
    place = max(0, min(len(sorted_values) - 1, round(share * len(sorted_values)) - 1))
    return sorted_values[place]


def reset() -> None:
    """For the tests: an empty window."""
    with _lock:
        _requests.clear()


class RequestMetricsMiddleware:
    """Times every HTTP request and keeps its duration and status in the window."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        start = time.monotonic()
        status = {"code": 500}  # a request whose response never starts counts as a failure

        async def watched(message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, watched)
        finally:
            record((time.monotonic() - start) * 1000, status["code"])
