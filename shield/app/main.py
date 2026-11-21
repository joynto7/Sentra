"""Sentra Shield: the gateway that stands in the traffic of a protected AI application (FR-8.3).

It forwards every request to the application and the answer back, measures what it adds to each
request (NFR-1.5), and reports that to Sentra with the markers of Sentra's own test requests
(UC-8.1 step 5). The rules that may change or hold back a request arrive as a Shield Policy with
UC-8.4; until a policy is deployed the gateway forwards everything unchanged.

It is started in the application's own environment, next to it:

    docker run -d --name sentra-shield \\
      -e SENTRA_URL=https://sentra.example.com \\
      -e SENTRA_GATEWAY_TOKEN=sgw_… \\
      -e SHIELD_UPSTREAM_URL=http://the-application:8080 \\
      -p 8443:8443 sentra/shield:1.0.0
"""

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response

from app.config import VERSION, load
from app.sentra import Link, now_ms

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("sentra.shield")

CHECK_HEADER = "x-sentra-check"
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
    """What the gateway itself knows: its version, its policy and whether Sentra answers."""
    return {
        "version": VERSION,
        "position": settings.position,
        "policy_version": link.policy.version,
        "rules": link.policy.rule_count,
        "connected_to_sentra": link.connected,
        "last_error": link.last_error,
        "upstream": settings.upstream_url,
    }


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def forward(path: str, request: Request) -> Response:
    """Every request of the application's traffic: forwarded as it came, with the answer
    unchanged. What the gateway adds to it is measured and reported, never guessed."""
    if not settings.upstream_url:
        return Response(
            content=b'{"error":"This Sentra Shield gateway has no upstream to forward to."}',
            status_code=503,
            media_type="application/json",
        )
    # Three stamps of one clock, so the gateway never asks the HTTP library how long anything
    # took: everything before `asked` and after `answered` is the gateway's own work, and the
    # time between them is the application's own (NFR-1.5).
    started = now_ms()
    body = await request.body()
    headers = {
        name: value for name, value in request.headers.items() if name.lower() not in HOP_BY_HOP
    }
    url = f"{settings.upstream_url}/{path}"
    marker = request.headers.get(CHECK_HEADER)
    asked = started  # nothing has been waited for yet
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            asked = now_ms()
            answer = await client.request(
                request.method,
                url,
                content=body,
                headers=headers,
                params=dict(request.query_params),
            )
    except httpx.HTTPError as exc:
        log.warning("The application could not be reached: %s", exc)
        # The wait for an application that never answered is not something the gateway added.
        link.saw_request(max(0.0, asked - started), marker)
        return Response(
            content=b'{"error":"The application behind this gateway could not be reached."}',
            status_code=502,
            media_type="application/json",
        )
    answered = now_ms()
    link.saw_request(max(0.0, (asked - started) + (now_ms() - answered)), marker)
    passed = {
        name: value for name, value in answer.headers.items() if name.lower() not in HOP_BY_HOP
    }
    return Response(content=answer.content, status_code=answer.status_code, headers=passed)
