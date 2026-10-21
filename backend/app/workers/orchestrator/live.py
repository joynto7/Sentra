"""Live events of campaign runs (FR-5.6, UC-5.6): what the live campaign monitor shows while a run
goes on, and what a monitor that lost its connection missed (UC-5.6, 3a).

Each run has its own Redis stream. The worker, and the API for pause and stop, add an event for
every status change, attempt and warning; the extensions add their own, such as a new finding.
The API serves the stream as Server-Sent Events. An event's id is its place in the stream, so a
browser that reconnects with the last id it saw gets exactly the events it missed. The database
stays the source of truth; the stream is the live view and is kept for a day after the run ends.

Publishing never fails a run: if Redis can't be reached, the event is only logged and the monitor
shows the run's state from the database.
"""

import asyncio
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from functools import cache

from app.core.config import get_settings

log = logging.getLogger("uvicorn.error")
MAX_EVENTS = 5_000  # per run; a monitor that is further behind loads the run again
KEEP_AFTER_END_SECONDS = 86_400


@dataclass(frozen=True)
class Event:
    id: str
    kind: str  # status, plan, attempt, warning, ended, or an extension's own kind
    data: dict

    def sse(self) -> str:
        """The event as Server-Sent Events text."""
        payload = json.dumps(self.data, ensure_ascii=False, default=str)
        return f"id: {self.id}\nevent: {self.kind}\ndata: {payload}\n\n"


@dataclass
class Batch:
    events: list[Event]
    missed: bool = False  # the events after `after` are no longer all kept


def _key(run_id: uuid.UUID | str) -> str:
    return f"sentra:run:{run_id}:events"


def _order(event_id: str) -> tuple[int, int]:
    first, _, second = event_id.partition("-")
    return int(first), int(second or 0)


class RedisEvents:
    def __init__(self, url: str) -> None:
        import redis

        self.url = url
        self.client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=5)

    def publish(self, run_id, kind: str, data: dict) -> str:
        fields = {"kind": kind, "data": json.dumps(data, ensure_ascii=False, default=str)}
        return self.client.xadd(_key(run_id), fields, maxlen=MAX_EVENTS, approximate=True)

    def last_id(self, run_id) -> str | None:
        newest = self.client.xrevrange(_key(run_id), count=1)
        return newest[0][0] if newest else None

    def expire(self, run_id) -> None:
        self.client.expire(_key(run_id), KEEP_AFTER_END_SECONDS)

    @staticmethod
    def _events(rows) -> list[Event]:
        return [Event(i, f.get("kind", ""), json.loads(f.get("data", "{}"))) for i, f in rows]

    async def follow(self, run_id, after: str | None, wait_ms: int) -> Batch:
        import redis.asyncio

        async with redis.asyncio.Redis.from_url(self.url, decode_responses=True) as client:
            key = _key(run_id)
            missed = False
            if after:
                oldest = await client.xrange(key, count=1)
                missed = bool(oldest) and _order(oldest[0][0]) > _order(after)
            found = await client.xread({key: after or "0-0"}, count=500, block=wait_ms)
            rows = found[0][1] if found else []
            return Batch(self._events(rows), missed)


class MemoryEvents:
    """For the tests, which have no Redis: the same behaviour in this process."""

    def __init__(self) -> None:
        self.streams: dict[str, list[Event]] = {}
        self.trimmed: dict[str, str] = {}  # the newest id that is no longer kept
        self.lock = threading.Lock()
        self.counter = 0

    def publish(self, run_id, kind: str, data: dict) -> str:
        with self.lock:
            self.counter += 1
            stored = json.loads(json.dumps(data, ensure_ascii=False, default=str))
            event = Event(f"{int(time.time() * 1000)}-{self.counter}", kind, stored)
            stream = self.streams.setdefault(str(run_id), [])
            stream.append(event)
            if len(stream) > MAX_EVENTS:
                self.trimmed[str(run_id)] = stream.pop(0).id
            return event.id

    def last_id(self, run_id) -> str | None:
        stream = self.streams.get(str(run_id))
        return stream[-1].id if stream else None

    def expire(self, run_id) -> None:
        pass

    def _after(self, run_id, after: str | None) -> Batch:
        with self.lock:
            stream = list(self.streams.get(str(run_id), []))
            trimmed = self.trimmed.get(str(run_id))
        missed = bool(after and trimmed and _order(trimmed) > _order(after))
        if not after:
            return Batch(stream, missed)
        return Batch([e for e in stream if _order(e.id) > _order(after)], missed)

    async def follow(self, run_id, after: str | None, wait_ms: int) -> Batch:
        deadline = time.monotonic() + wait_ms / 1000
        while True:
            batch = self._after(run_id, after)
            if batch.events or batch.missed or time.monotonic() >= deadline:
                return batch
            await asyncio.sleep(0.02)


@cache
def backend() -> RedisEvents | MemoryEvents:
    settings = get_settings()
    if settings.live_events_backend == "memory":
        return MemoryEvents()
    return RedisEvents(settings.redis_url)


def publish(run_id, kind: str, data: dict) -> str | None:
    """Adds an event to the run's stream; returns its id, or None if it couldn't be added."""
    try:
        return backend().publish(run_id, kind, data)
    except Exception:
        log.warning("Live event %s of run %s couldn't be published", kind, run_id, exc_info=True)
        return None


def last_id(run_id) -> str | None:
    """The id of the newest event: a monitor that loads the run follows the stream from there."""
    try:
        return backend().last_id(run_id)
    except Exception:
        log.warning("Live events of run %s can't be read", run_id, exc_info=True)
        return None


def expire(run_id) -> None:
    try:
        backend().expire(run_id)
    except Exception:
        log.warning("Live events of run %s couldn't be set to expire", run_id, exc_info=True)


async def follow(run_id, after: str | None, wait_ms: int) -> Batch:
    """The events after `after` (all kept events without it), waiting up to wait_ms for one."""
    return await backend().follow(run_id, after, wait_ms)
