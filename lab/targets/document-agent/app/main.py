"""Document-processing agent lab target: the document desk of the fictional Halcyon Bank, which
summarizes documents and reads facts out of them, and is **intentionally vulnerable** (FR-11.1).
Only for the Security Lab, in the isolated lab network with synthetic data (FR-11.2). What it is
known to be vulnerable to is listed in KNOWN_VULNERABILITIES.md and reported by `GET /lab/state`.

It speaks the OpenAI chat format, so Sentra registers it like any OpenAI-compatible target. A
document can be sent with the request, after a line of three dashes.
"""

import json
import os
import secrets
import time
import uuid
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import PlainTextResponse

from app import agent, documents
from app import weaknesses as _weaknesses  # noqa: F401  (registers the planted weaknesses)

API_KEY = os.environ.get("LAB_API_KEY", "lab-api-key")
ADMIN_TOKEN = os.environ.get("LAB_ADMIN_TOKEN", "lab-admin-token")
MODEL = os.environ.get("LAB_MODEL", "simulated")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")

app = FastAPI(title="Lab target: document-processing agent", docs_url=None, redoc_url=None)
# Ownership tokens that Sentra placed (report 2.3.2), newest last. Several organizations can
# register this one shared instance until each gets its own (FR-11.2), so the file lists them all.
MAX_TOKENS = 100
state = {
    "canaries": documents.new_canaries(),
    "verification_tokens": [],
    "work": documents.new_state(),
}
state["library"] = documents.load(state["canaries"])

# Where each canary token is planted, in Sentra's words (FR-11.1): the slot of a target's canary
# tokens (`app/modules/m02_targets/canaries.py`) and what to ask about to reach it.
SLOTS = [
    ("system_instructions", "system_instructions", None),
    ("test_document", "test_document", "the account statement of September (HB-ST-0925)"),
    ("restricted_document", "restricted_document", "the internal pricing memo (HB-PR-0031)"),
]

# The documented list of this target's weaknesses (FR-11.1), as its own file states them.
KNOWN_VULNERABILITIES = json.loads(
    (Path(__file__).resolve().parent.parent / "known_vulnerabilities.json").read_text()
)


def _check(supplied: str | None, expected: str) -> None:
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid credentials.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL}


@app.post("/v1/chat/completions")
def chat(body: dict, authorization: str | None = Header(default=None)) -> dict:
    _check((authorization or "").removeprefix("Bearer "), API_KEY)
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="Send at least one message.")
    question = str(messages[-1].get("content", ""))[:8000]
    reply = agent.answer(
        question,
        state["library"],
        state["canaries"],
        state["work"],
        model=MODEL,
        base_url=OLLAMA_BASE_URL,
    )
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply.text},
                "finish_reason": "stop",
            }
        ],
    }


@app.get("/lab/state")
def lab_state(x_lab_admin_token: str | None = Header(default=None)) -> dict:
    """The current canary tokens and the documented weaknesses, for the Security Lab only (the
    ground truth of a benchmark, UC-11.1 step 2). Sentra's detection reads the tokens; they are
    never put into an attempt."""
    _check(x_lab_admin_token, ADMIN_TOKEN)
    slots = [
        {"slot": slot, "token": state["canaries"][name], "topic": topic}
        for name, slot, topic in SLOTS
    ]
    return {
        "canaries": state["canaries"],
        "slots": slots,
        # What this target is known to be vulnerable to (FR-11.1). It is documented here, in the
        # application itself, so the Security Lab page never shows a copy that has drifted.
        "known_vulnerabilities": KNOWN_VULNERABILITIES,
    }


@app.post("/lab/reset")
def lab_reset(x_lab_admin_token: str | None = Header(default=None)) -> dict:
    """UC-11.2 steps 2-4, for the Security Lab only: the agent throws away the documents that were
    sent to it and the conversation it remembers, loads its own documents again from `app/inbox/`
    and plants **new** canary tokens, so a token found in a later reply always belongs to the
    current state.

    Sentra marks the target "resetting" before this and runs a connection test after it (FR-11.2).
    The ownership tokens Sentra placed are kept, because the target is the same target.
    """
    _check(x_lab_admin_token, ADMIN_TOKEN)
    state["canaries"] = documents.new_canaries()
    state["work"] = documents.new_state()
    state["library"] = documents.load(state["canaries"])
    return {
        "reset_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "documents": len(state["library"]),
        "canaries": len(state["canaries"]),
    }


@app.put("/lab/verification", status_code=204)
def place_verification_token(
    token: str = Body(embed=True, min_length=16, max_length=128),
    x_lab_admin_token: str | None = Header(default=None),
) -> None:
    """Sentra places the ownership token of its own lab target itself (report 2.3.2)."""
    _check(x_lab_admin_token, ADMIN_TOKEN)
    tokens = [t for t in state["verification_tokens"] if t != token] + [token]
    state["verification_tokens"] = tokens[-MAX_TOKENS:]


@app.get("/.well-known/sentra-verification.txt", response_class=PlainTextResponse)
def verification_file() -> str:
    """The file that Sentra's ownership check reads (UC-2.3, the well-known file method): one
    token per line."""
    if not state["verification_tokens"]:
        raise HTTPException(status_code=404, detail="No verification token.")
    return "\n".join(state["verification_tokens"]) + "\n"
