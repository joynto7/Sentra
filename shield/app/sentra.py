"""The gateway's side of its conversation with Sentra (UC-8.1 steps 4-6, UC-8.4 steps 3-4).

Every call goes **outbound**: Sentra never opens a connection into the environment the gateway
runs in (quality requirement 4). The gateway announces itself once, then reports what it has seen
every window and takes the policy version Sentra names. When Sentra cannot be reached, nothing here
raises into the traffic path — the gateway keeps forwarding and keeps enforcing the version it
already has (UC-8.1, quality requirement 3).
"""

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from statistics import median

import httpx

from app.config import VERSION, Settings
from app.enforce import Engine
from app.policy import Policy, load, save

log = logging.getLogger("sentra.shield")
MAX_MARKERS = 50
MAX_SOURCES = 50


@dataclass
class Window:
    """What passed through the gateway since its last heartbeat."""

    requests: int = 0
    blocked: int = 0  # what its policy stopped: a guardrail, or a tool call held back
    changed: int = 0  # what a masking guardrail took something out of
    # Bodies no policy could be matched against: a picture, or a compression the gateway does not
    # know. They are forwarded exactly as they came, and the health page says how many there were.
    unreadable: int = 0
    added_latency_ms: int | None = None  # the median of what the gateway itself added (NFR-1.5)
    markers: list[str] = field(default_factory=list)
    sightings: dict[str, int] = field(default_factory=dict)  # a restricted source, and how often


class Link:
    """What the gateway knows about Sentra, and what it has seen since its last heartbeat."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.policy = load(settings.policy_file)
        self.engine = Engine(self.policy.document, settings.position)
        self.connected = False
        self.last_error: str | None = None
        self._lock = threading.Lock()
        self._window = Window()
        self._latencies: deque[float] = deque(maxlen=500)
        self._stop = threading.Event()

    # ---------------------------------------------------------------- what the proxy records

    def saw_request(
        self,
        added_ms: float,
        marker: str | None,
        *,
        blocked: bool = False,
        changed: bool = False,
        unreadable: bool = False,
        sources: tuple[str, ...] = (),
    ) -> None:
        """One request passed through the gateway: what it added to it, Sentra's own marker when
        the request carried one (UC-8.1 step 5), and what its policy did with it (FR-8.3)."""
        with self._lock:
            window = self._window
            window.requests += 1
            window.blocked += 1 if blocked else 0
            window.changed += 1 if changed else 0
            window.unreadable += 1 if unreadable else 0
            self._latencies.append(added_ms)
            if marker and len(window.markers) < MAX_MARKERS:
                window.markers.append(marker)
            for source in sources:
                if source in window.sightings or len(window.sightings) < MAX_SOURCES:
                    window.sightings[source] = window.sightings.get(source, 0) + 1

    def seen(self) -> Window:
        """The window as it stands, for the gateway's own health page. It is not taken."""
        with self._lock:
            return Window(
                requests=self._window.requests,
                blocked=self._window.blocked,
                changed=self._window.changed,
                unreadable=self._window.unreadable,
                added_latency_ms=self._median(),
                markers=list(self._window.markers),
                sightings=dict(self._window.sightings),
            )

    def _take_window(self) -> Window:
        with self._lock:
            window = self._window
            window.added_latency_ms = self._median()
            self._window = Window()
            self._latencies.clear()
        return window

    def _median(self) -> int | None:
        return round(median(self._latencies)) if self._latencies else None

    # ---------------------------------------------------------------- the calls to Sentra

    def _post(self, path: str, body: dict) -> dict | None:
        settings = self.settings
        if not settings.sentra_url or not settings.token:
            return None
        try:
            with httpx.Client(timeout=10) as client:
                answer = client.post(
                    f"{settings.sentra_url}/api/v1/shield{path}",
                    json=body,
                    headers={"Authorization": f"Bearer {settings.token}"},
                )
            if answer.status_code >= 400:
                self.last_error = f"Sentra answered {answer.status_code} on {path}"
                log.warning(self.last_error)
                return None
            self.last_error = None
            return answer.json()
        except httpx.HTTPError as exc:  # Sentra is not reachable: the policy stays as it is
            self.last_error = f"Sentra can't be reached: {exc}"
            log.warning(self.last_error)
            return None

    def connect(self) -> bool:
        """Step 4: the gateway announces itself with its version and its position."""
        answer = self._post("/connect", {"version": VERSION, "position": self.settings.position})
        self.connected = answer is not None
        if answer:
            self._accept_version(answer.get("policy_version", 0))
        return self.connected

    def heartbeat(self) -> bool:
        """What the window held: the requests, what the policy did with them, the latency the
        gateway added, Sentra's markers, and the policy version it is enforcing (UC-8.4 step 4)."""
        window = self._take_window()
        answer = self._post(
            "/heartbeat",
            {
                "requests": window.requests,
                "blocked": window.blocked,
                "changed": window.changed,
                "added_latency_ms": window.added_latency_ms,
                "markers": window.markers,
                "sightings": window.sightings,
                "policy_version": self.policy.version,
            },
        )
        if answer is None:
            self.connected = False
            # Nothing is lost that matters: the counts start again, and the markers are only
            # useful while Sentra is waiting for them.
            return False
        self.connected = True
        self._accept_version(answer.get("policy_version", 0))
        return True

    def _accept_version(self, version: int) -> None:
        """A version Sentra names that the gateway does not have yet is fetched, kept, enforced
        and confirmed (UC-8.4 steps 3-4)."""
        if not isinstance(version, int) or version <= self.policy.version:
            return
        settings = self.settings
        try:
            with httpx.Client(timeout=10) as client:
                answer = client.get(
                    f"{settings.sentra_url}/api/v1/shield/policy",
                    headers={"Authorization": f"Bearer {settings.token}"},
                )
            answer.raise_for_status()
            document = answer.json()
        except (httpx.HTTPError, ValueError) as exc:
            self.last_error = f"The policy could not be read: {exc}"
            log.warning(self.last_error)
            return
        policy = Policy(
            version=int(document.get("version", 0)), document=document.get("document") or {}
        )
        if policy.version <= self.policy.version:
            return
        engine = Engine(policy.document, settings.position)
        # The policy is on disk before it is enforced, so a restart in the next second enforces
        # the same thing, and the engine is swapped in one step, between two requests.
        save(settings.policy_file, policy)
        self.policy, self.engine = policy, engine
        log.info("Shield Policy v%s is active (%s rules)", policy.version, policy.rule_count)
        self._confirm()

    def _confirm(self) -> None:
        """Step 4: the gateway tells Sentra which version it has activated, and how many rules it
        holds. A confirmation that is lost costs nothing: the next heartbeat carries the version
        too, and Sentra treats that as the confirmation (UC-8.4, 4a)."""
        self._post("/confirm", {"version": self.policy.version, "rules": self.policy.rule_count})

    # ---------------------------------------------------------------- the background loop

    def run_forever(self) -> None:
        self.connect()
        while not self._stop.wait(self.settings.heartbeat_seconds):
            if not self.connected:
                self.connect()
            else:
                self.heartbeat()

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self.run_forever, name="sentra-link", daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self._stop.set()


def now_ms() -> float:
    return time.monotonic() * 1000
