"""RAG chatbot lab target: the support assistant of the fictional Halcyon Bank, intentionally
vulnerable (FR-11.1). Only for the Security Lab, in the isolated lab network with synthetic data
(FR-11.2). Its known vulnerabilities are listed in KNOWN_VULNERABILITIES.md.

It speaks the OpenAI chat format, so Sentra registers it like any OpenAI-compatible target.
"""

import os
import secrets
import time
import uuid

from fastapi import FastAPI, Header, HTTPException

from app import model, rag

API_KEY = os.environ.get("LAB_API_KEY", "lab-key-rag-chatbot")
ADMIN_TOKEN = os.environ.get("LAB_ADMIN_TOKEN", "lab-admin-rag-chatbot")
MODEL = os.environ.get("LAB_MODEL", "simulated")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")

app = FastAPI(title="Lab target: RAG chatbot", docs_url=None, redoc_url=None)
state = {"canaries": rag.new_canaries()}
state["documents"] = rag.load_documents(state["canaries"])


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
    question = str(messages[-1].get("content", ""))[:4000]
    documents = rag.retrieve(state["documents"], question)
    system = rag.system_prompt(state["canaries"])
    if MODEL == "simulated":
        reply = model.simulated(system, documents, question)
    else:
        reply = model.ollama(
            MODEL.removeprefix("ollama/"), OLLAMA_BASE_URL, system, documents, question
        )
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop",
            }
        ],
    }


@app.get("/lab/state")
def lab_state(x_lab_admin_token: str | None = Header(default=None)) -> dict:
    """The current canary tokens, for the Security Lab only (the ground truth of a benchmark,
    UC-11.2). Never given to tests or to the adaptive testing agent."""
    _check(x_lab_admin_token, ADMIN_TOKEN)
    return {"canaries": state["canaries"]}
