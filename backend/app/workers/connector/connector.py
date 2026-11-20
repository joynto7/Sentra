"""The Target Connector: the only code that sends requests to targets (architecture, 2.5.3).

It sends three kinds of request: the attempts of campaign runs and the discovery requests of a
target profile (send()), the one harmless request of a connection test (check_connection(),
FR-2.4) and the download of the ownership token (fetch_well_known(), FR-2.3).

send() delivers one attempt to a target and returns its reply. Before every request it
1. refuses a target that isn't verified (FR-5.7);
2. checks the endpoint's address again and connects to exactly the IP address it checked, so a
   host name that turns to a private address after the check can't divert the request (NFR-3.4);
3. waits for the target's turn, so requests are spaced to the target's rate (pacing.py, FR-5.7);
4. takes one attempt of the budget, and refuses the request when none is left (FR-5.7).
Then it builds the request in the target's format (FR-2.1), adds the credentials, decrypted only
now (FR-2.2), and reads the reply and the tool calls from the answer. Whatever the target sends
back is returned only as data (NFR-3.6). Redirects are not followed: one could lead to a private
address.
"""

import ipaddress
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy.orm import Session

from app import __version__
from app.core import addresses
from app.core.config import get_settings
from app.modules.m02_targets.formats import (
    OPENAI_REPLY_PATH,
    OPENAI_TOOL_CALLS_PATH,
    extract,
    render,
)
from app.modules.m02_targets.models import CredentialType, Target, TargetStatus
from app.workers.connector import pacing
from app.workers.connector.errors import (
    AddressRefused,
    BadResponse,
    BudgetExhausted,
    NotVerified,
    TargetHTTPError,
    TargetOverloaded,
    TargetRedirect,
    TargetTimeout,
    TargetUnreachable,
)

USER_AGENT = f"Sentra-Target-Connector/{__version__} (authorized AI security testing)"
MAX_ANSWER_BYTES = 1_000_000
MAX_TOKEN_FILE_BYTES = 4_096
WELL_KNOWN_PATH = "/.well-known/sentra-verification.txt"
# The connection test is one harmless request and never a security test (UC-2.2, quality
# requirement 1).
CONNECTION_TEST_MESSAGE = (
    "Hello, this is a connection test from Sentra. Please reply with a short greeting."
)
# The network, which the tests replace with httpx's MockTransport when they go through the API.
TRANSPORT: httpx.BaseTransport | None = None


@dataclass
class Reply:
    text: str
    tool_calls: Any  # what the target says it called, if its format names them
    status_code: int
    duration_ms: int
    body: str  # the whole answer (at most 1 MB), for the evidence (FR-6.3)
    reply_path: str = ""  # where the reply was found, e.g. $.output.text (Screen 19)
    # Headers such as X-RateLimit-Limit, for the observed rate limits of a profile (FR-2.5)
    rate_limit_headers: dict[str, str] = field(default_factory=dict)


class AttemptBudget(Protocol):
    """How many attempts a run may still send; take() raises BudgetExhausted when none are left.
    A campaign run (FR-5.4) keeps its own count."""

    def take(self) -> None: ...


@dataclass
class FixedBudget:
    limit: int
    used: int = 0

    def take(self) -> None:
        if self.used >= self.limit:
            raise BudgetExhausted()
        self.used += 1


def send(
    db: Session,
    target: Target,
    message: str,
    *,
    session_id: str | None = None,
    rate_per_minute: int | None = None,
    budget: AttemptBudget | None = None,
    transport: httpx.BaseTransport | None = None,
    wait: Callable[[float], None] | None = None,
    max_wait: float | None = None,
) -> Reply:
    """Sends `message` to `target` and returns its reply. `rate_per_minute` may lower the target's
    rate for a campaign, never raise it. `wait` replaces time.sleep for the wait for the target's
    turn, so a campaign run can stop while it waits (FR-5.6); if it raises, nothing is sent. With
    `max_wait`, a longer wait raises pacing.TooLongToWait instead. The budget is taken after the
    wait, at the last moment before the request. `transport` replaces the network in the tests."""
    if target.status != TargetStatus.VERIFIED:
        raise NotVerified()
    return _post(
        db, target, message, session_id, rate_per_minute, transport, wait, max_wait, budget
    )


def check_connection(
    db: Session, target: Target, *, transport: httpx.BaseTransport | None = None
) -> Reply:
    """UC-2.2: one harmless request, also before the target is verified, because it only proves
    that the endpoint, the format and the credentials work. Every other protection applies: the
    address check, the pinned address, the rate, no redirects, the size limit."""
    return _post(db, target, CONNECTION_TEST_MESSAGE, None, None, transport)


def fetch_well_known(target: Target, *, transport: httpx.BaseTransport | None = None) -> str | None:
    """UC-2.3 step 4: the file /.well-known/sentra-verification.txt on the endpoint's own host
    (quality requirement 4: a token published elsewhere doesn't count). None if it isn't there."""
    parts = urlsplit(target.endpoint_url)
    url = urlunsplit((parts.scheme, parts.netloc, WELL_KNOWN_PATH, "", ""))
    pinned, host_header, extensions = _pinned(url)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/plain"}
    if host_header:
        headers["Host"] = host_header
    try:
        with (
            httpx.Client(
                transport=transport or TRANSPORT,
                timeout=httpx.Timeout(10, connect=5),
                follow_redirects=False,
            ) as client,
            client.stream("GET", pinned, headers=headers, extensions=extensions) as answer,
        ):
            if answer.status_code == 404:
                return None
            if 300 <= answer.status_code < 400:
                raise TargetRedirect(answer.status_code)
            if answer.status_code >= 400:
                raise TargetHTTPError(answer.status_code)
            raw = _read(answer, MAX_TOKEN_FILE_BYTES, "The verification file is larger than 4 KB.")
            return raw.decode("utf-8", errors="replace")
    except httpx.TimeoutException as exc:
        raise TargetTimeout(10) from exc
    except httpx.TransportError as exc:
        raise TargetUnreachable(f"The target can't be reached: {_reason(exc)}") from exc


def _post(
    db: Session,
    target: Target,
    message: str,
    session_id: str | None,
    rate_per_minute: int | None,
    transport: httpx.BaseTransport | None,
    wait: Callable[[float], None] | None = None,
    max_wait: float | None = None,
    budget: AttemptBudget | None = None,
) -> Reply:
    url, host_header, extensions = _pinned(target.endpoint_url)

    rate = min(rate_per_minute or target.max_request_rate, target.max_request_rate)
    seconds = pacing.reserve(db, target.id, rate, max_wait)
    if seconds > 0:
        (wait or time.sleep)(seconds)
    if budget is not None:
        budget.take()

    headers = _headers(target, host_header)
    body = _request_body(target, message, session_id or str(uuid.uuid4()))
    timeout = get_settings().connector_timeout_seconds
    start = time.monotonic()
    try:
        with (
            httpx.Client(
                transport=transport or TRANSPORT,
                timeout=httpx.Timeout(timeout, connect=10),
                follow_redirects=False,
            ) as client,
            client.stream("POST", url, json=body, headers=headers, extensions=extensions) as answer,
        ):
            raw = _read(answer)
            status_code = answer.status_code
            retry_after = answer.headers.get("retry-after")
            rate_headers = {
                k.lower(): v for k, v in answer.headers.items() if "ratelimit" in k.lower()
            }
    except httpx.TimeoutException as exc:
        raise TargetTimeout(timeout) from exc
    except httpx.TransportError as exc:
        raise TargetUnreachable(f"The target can't be reached: {_reason(exc)}") from exc
    duration_ms = int((time.monotonic() - start) * 1000)

    if status_code in (429, 503):
        raise TargetOverloaded(status_code, retry_after)
    if 300 <= status_code < 400:
        raise TargetRedirect(status_code)
    if status_code >= 400:
        raise TargetHTTPError(status_code)
    reply = _reply(target, raw, status_code, duration_ms)
    reply.rate_limit_headers = rate_headers
    return reply


def _pinned(url: str) -> tuple[str, str | None, dict]:
    """The URL to connect to, with the host replaced by the IP address that was checked, and the
    Host header and TLS name that keep the request addressed to the real host name."""
    settings = get_settings()
    parts = urlsplit(url)
    try:
        addresses.check_url(url, allow_private=True)  # the form of the URL
    except addresses.AddressNotAllowed as exc:
        raise AddressRefused(str(exc)) from exc
    host = parts.hostname or ""
    if settings.allow_private_targets or host in settings.lab_hosts:
        return url, None, {}  # an on-premises deployment, or Sentra's own lab targets (FR-11.2)

    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        found = [str(ipaddress.ip_address(host))]
    except ValueError:
        try:
            found = addresses.resolve(host, port)
        except (OSError, UnicodeError) as exc:
            raise AddressRefused(addresses.UNKNOWN_HOST) from exc
    if not found or not all(addresses.is_public(address) for address in found):
        raise AddressRefused(addresses.PRIVATE_ADDRESS)

    address = found[0]
    netloc = f"[{address}]" if ":" in address else address
    if parts.port:
        netloc += f":{parts.port}"
    pinned = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
    host_header = f"{host}:{parts.port}" if parts.port else host
    return pinned, host_header, {"sni_hostname": host}


def _headers(target: Target, host_header: str | None) -> dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    for credential in target.credentials:
        value = credential.decrypt()  # only here, at the moment of the request (FR-2.2)
        if credential.credential_type == CredentialType.BEARER_TOKEN:
            headers["Authorization"] = f"Bearer {value}"
        else:
            headers[credential.name] = value
    if host_header:
        headers["Host"] = host_header
    return headers


def _request_body(target: Target, message: str, session_id: str) -> dict:
    if target.request_template is None:  # an OpenAI-compatible chat API
        return {"messages": [{"role": "user", "content": message}]}
    return render(target.request_template, message, session_id)


def _read(
    answer: httpx.Response,
    limit: int = MAX_ANSWER_BYTES,
    too_large: str = "The target's answer is larger than 1 MB.",
) -> bytes:
    chunks, size = [], 0
    for chunk in answer.iter_bytes():
        size += len(chunk)
        if size > limit:
            raise BadResponse(too_large)
        chunks.append(chunk)
    return b"".join(chunks)


def _reply(target: Target, raw: bytes, status_code: int, duration_ms: int) -> Reply:
    text = raw.decode("utf-8", errors="replace")
    try:
        answer = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BadResponse("The target's answer isn't JSON.", excerpt=text) from exc
    if target.request_template is None:
        reply_path, tools_path = OPENAI_REPLY_PATH, OPENAI_TOOL_CALLS_PATH
    else:
        template = target.response_template or {}
        reply_path, tools_path = template.get("reply", ""), template.get("tool_calls")
    reply = extract(answer, reply_path)
    if reply is None:
        raise BadResponse(f"There's no reply at {reply_path} in the target's answer.", excerpt=text)
    tool_calls = extract(answer, tools_path) if tools_path else None
    return Reply(
        text=reply if isinstance(reply, str) else json.dumps(reply),
        tool_calls=tool_calls,
        status_code=status_code,
        duration_ms=duration_ms,
        body=text,
        reply_path=reply_path,
    )


def _reason(error: httpx.TransportError) -> str:
    text = str(error).lower()
    if "certificate" in text or "ssl" in text or "tls" in text:
        return "its TLS certificate isn't valid."
    if "refused" in text:
        return "the connection was refused."
    return "no connection could be made."
