"""The gateway's side of its conversation with Sentra (UC-8.1 steps 4-6).

Every call goes **outbound**: Sentra never opens a connection into the environment the gateway
runs in (quality requirement 4). The gateway announces itself once, then reports what it has seen
every window and reads its policy. When Sentra cannot be reached, nothing here raises into the
traffic path — the gateway keeps forwarding with the policy it already has.
"""

import logging
import threading
import time
from collections import deque
from statistics import median

import httpx

from app.config import VERSION, Settings
from app.policy import Policy, load, save

log = logging.getLogger("sentra.shield")
MAX_MARKERS = 50


class Link:
    """What the gateway knows about Sentra, and what it has seen since its last heartbeat."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.policy = load(settings.policy_file)
        self.connected = False
        self.last_error: str | None = None
        self._lock = threading.Lock()
        self._requests = 0
        self._latencies: deque[float] = deque(maxlen=500)
        self._markers: list[str] = []
        self._stop = threading.Event()

    # ---------------------------------------------------------------- what the proxy records

    def saw_request(self, added_ms: float, marker: str | None) -> None:
        """One request passed through the gateway: what it added to it, and Sentra's own marker
        when the request carried one (step 5)."""
        with self._lock:
            self._requests += 1
            self._latencies.append(added_ms)
            if marker and len(self._markers) < MAX_MARKERS:
                self._markers.append(marker)

    def _take_window(self) -> tuple[int, int | None, list[str]]:
        with self._lock:
            requests, markers = self._requests, self._markers
            latency = round(median(self._latencies)) if self._latencies else None
            self._requests, self._markers = 0, []
            self._latencies.clear()
        return requests, latency, markers

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
        """What the window held: the requests, the latency it added, and Sentra's markers."""
        requests, latency, markers = self._take_window()
        answer = self._post(
            "/heartbeat",
            {"requests": requests, "added_latency_ms": latency, "markers": markers},
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
        """A version Sentra names that the gateway does not have yet is fetched and kept."""
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
        self.policy = policy
        save(settings.policy_file, policy)
        log.info("Shield Policy v%s is active (%s rules)", policy.version, policy.rule_count)

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
