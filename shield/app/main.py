"""Sentra Shield: the gateway that stands in the traffic of a protected AI application (FR-8.3).

It forwards every request to the application and the answer back, applies the Shield Policy its
target's approved remediations were deployed as (UC-8.4), measures what it adds to each request
(NFR-1.5), and reports all of that to Sentra with the markers of Sentra's own test requests
(UC-8.1 step 5). A gateway without a policy forwards everything unchanged and only measures.

It is started in the application's own environment, next to it:

    docker run -d --name sentra-shield \\
      -e SENTRA_URL=https://sentra.example.com \\
      -e SENTRA_GATEWAY_TOKEN=sgw_… \\
      -e SHIELD_UPSTREAM_URL=http://the-application:8080 \\
      -p 8443:8443 sentra/shield:1.0.0
"""

import json
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response

from app.config import VERSION, load
from app.sentra import Link, now_ms

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("sentra.shield")

CHECK_HEADER = "x-sentra-check"
JSON = "application/json"
# Headers that belong to one connection and are never forwarded.
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}
# What the HTTP library unpacks by itself, so the answer's own content-encoding no longer
# describes the body the client is given. Anything else reaches the client exactly as it came —
# including its header — and the policy reports that it could not read it.
UNPACKED = {"gzip", "x-gzip", "deflate", "identity"}

settings = load()
link = Link(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    link.start()  # connects and then reports every window, outbound only
    yield
    link.stop()


app = FastAPI(title="Sentra Shield", version=VERSION, lifespan=lifespan)


@app.get("/_shield/health")
def health() -> dict:
    """What the gateway itself knows: its version, its policy, what that policy has done since
    its last heartbeat, and whether Sentra answers."""
    window = link.seen()
    return {
        "version": VERSION,
        "position": settings.position,
        "policy_version": link.policy.version,
        "rules": link.policy.rule_count,
        "enforced_rules": link.engine.rule_count,  # what this position can carry of them
        "connected_to_sentra": link.connected,
        "last_error": link.last_error,
        "upstream": settings.upstream_url,
        "window": {
            "requests": window.requests,
            "blocked": window.blocked,
            "changed": window.changed,
            "unreadable": window.unreadable,
            "added_latency_ms": window.added_latency_ms,
            "sightings": window.sightings,
        },
    }


def _answer(body: dict, status: int) -> Response:
    return Response(content=json.dumps(body).encode(), status_code=status, media_type=JSON)


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def forward(path: str, request: Request) -> Response:
    """Every request of the application's traffic: the policy is applied to it and to the answer,
    and what the gateway added to it is measured, never guessed."""
    if not settings.upstream_url:
        return _answer({"error": "This Sentra Shield gateway has no upstream to forward to."}, 503)
    # Three stamps of one clock, so the gateway never asks the HTTP library how long anything
    # took: everything before `asked` and after `answered` is the gateway's own work — the policy
    # included — and the time between them is the application's own (NFR-1.5).
    started = now_ms()
    body = await request.body()
    marker = request.headers.get(CHECK_HEADER)
    engine = link.engine  # read once: a new policy version never arrives inside a request

    coming = engine.on_request(body, request.headers.get("content-encoding"))
    if coming.blocked:
        # The application never sees it. The answer says what the approved fix says and names no
        # rule: what a policy matches is the target owner's, not its users' business.
        log.info("Rule %s of policy v%s blocked a request", coming.rule, link.policy.version)
        link.saw_request(now_ms() - started, marker, blocked=True)
        return _answer({"error": coming.message}, 403)

    headers = {
        name: value for name, value in request.headers.items() if name.lower() not in HOP_BY_HOP
    }
    if coming.drop_encoding:
        headers.pop("content-encoding", None)  # the gateway unpacked it to read it
    if not engine.empty:
        # A policy that cannot read the answer cannot protect anybody, so a gateway with rules
        # asks for it unpacked. A gateway without a policy changes nothing at all.
        headers["accept-encoding"] = "identity"
    url = f"{settings.upstream_url}/{path}"
    asked = started  # nothing has been waited for yet
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            asked = now_ms()
            answer = await client.request(
                request.method,
                url,
                content=coming.body,
                headers=headers,
                params=dict(request.query_params),
            )
    except httpx.HTTPError as exc:
        log.warning("The application could not be reached: %s", exc)
        # The wait for an application that never answered is not something the gateway added.
        link.saw_request(max(0.0, asked - started), marker, sources=coming.sources)
        return _answer({"error": "The application behind this gateway could not be reached."}, 502)
    answered = now_ms()

    # httpx has already unpacked the answer, so what the policy reads is the text itself and the
    # content-encoding of the answer no longer describes the body the client is given.
    going = engine.on_answer(answer.content)
    added = max(0.0, (asked - started) + (now_ms() - answered))
    link.saw_request(
        added,
        marker,
        blocked=going.blocked or bool(going.held_back),
        changed=coming.changed or going.changed,
        unreadable=coming.unreadable or going.unreadable,
        sources=tuple(dict.fromkeys(coming.sources + going.sources)),
    )
    if going.blocked:
        log.info("Rule %s of policy v%s blocked an answer", going.rule, link.policy.version)
        return _answer({"error": going.message}, 403)
    if going.held_back:
        log.info("Policy v%s held back the tool call %s", link.policy.version, going.held_back[0])
    unpacked = answer.headers.get("content-encoding", "").strip().lower() in UNPACKED
    passed = {
        name: value
        for name, value in answer.headers.items()
        if name.lower() not in HOP_BY_HOP and not (unpacked and name.lower() == "content-encoding")
    }
    return Response(content=going.body, status_code=answer.status_code, headers=passed)
