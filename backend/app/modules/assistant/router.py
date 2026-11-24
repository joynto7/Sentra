"""The assistant's API (everything under /api/v1/assistant).

POST /chat and POST /actions/{id} answer with a stream of server-sent events, one JSON object per
`data:` line, so the page can show each step as it happens:

    step          a tool is running, or has finished (with what it found)
    card          a result the page draws: a table, a record, figures or a link
    action        a change the assistant proposes and the person must confirm
    action_result what happened when the person confirmed or cancelled
    message       the assistant's answer, the last event of a turn
    error         the turn could not be done, with a sentence for the person
"""

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.llm import LLMTask, model_for
from app.llm.layer import local_models_only
from app.modules.assistant import agent, store, tools
from app.modules.assistant.schemas import (
    ActionOut,
    ChatIn,
    ConversationDetail,
    ConversationOut,
    DecisionIn,
    MessageOut,
    StatusOut,
)
from app.modules.assistant.service import limiter
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import ROLE_LABELS, Membership, Role

router = APIRouter(prefix="/assistant", tags=["Assistant"])

MAX_MESSAGES_IN_CONVERSATION = 200
HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

CAN_DO = {
    None: [
        "Answer questions about any feature",
        "Look up targets, campaigns, runs, findings, fixes and reports",
        "Show the risk overview and what needs attention",
    ],
}


def _caller(request: Request, membership: Membership, page: str) -> agent.Caller:
    cookie = get_settings().session_cookie_name
    return agent.Caller(
        user_id=membership.user_id,
        organization_id=membership.organization_id,
        role=membership.role,
        role_label=ROLE_LABELS[Role(membership.role)],
        cookies={cookie: request.cookies.get(cookie, "")},
        client_host=request.client.host if request.client else None,
        page=page,
    )


def _events(stream: AsyncIterator[dict], first: dict | None = None) -> AsyncIterator[bytes]:
    async def generate() -> AsyncIterator[bytes]:
        if first:
            yield _line(first)
        try:
            async for event in stream:
                yield _line(event)
        except AppError as exc:
            yield _line({"event": "error", "message": exc.message})
        except Exception:  # never leave the page waiting on a stream that died
            yield _line(
                {"event": "error", "message": "Something went wrong on my side. Please try again."}
            )
            raise

    return generate()


def _line(event: dict) -> bytes:
    return f"data: {json.dumps(event, default=str)}\n\n".encode()


@router.get("/status")
def status(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> StatusOut:
    """What the assistant can do for this person, for the panel's first screen."""
    choice = model_for(
        db, LLMTask.ASSISTANT, local_only=local_models_only(db, membership.organization_id)
    )
    can_do = list(CAN_DO[None])
    actions = {t.action for t in tools.available(membership.role) if t.kind == tools.WRITE}
    labels = {
        "manage_targets": "Register and update targets",
        "verify_targets": "Check ownership of a target",
        "manage_threat_models": "Generate and approve threat models",
        "manage_campaigns": "Create campaigns and launch runs",
        "pause_campaign_runs": "Pause and resume runs",
        "triage_findings": "Triage findings",
        "request_remediations": "Request fixes",
        "approve_remediations": "Approve fixes",
        "approve_campaign_scope": "Approve a campaign's scope",
        "generate_reports": "Generate reports",
    }
    can_do += [
        labels[a.value] for a in sorted(actions, key=lambda a: a.value) if a and a.value in labels
    ]
    return StatusOut(
        available=choice is not None,
        mode="ai" if choice is not None else "guide",
        model=(choice.label or choice.model.split("/", 1)[-1]) if choice else None,
        deployment=choice.deployment.value if choice else None,
        starters=agent.starters(membership.role),
        can_do=can_do,
    )


@router.get("/conversations")
def list_conversations(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> list[ConversationOut]:
    rows = store.list_conversations(db, membership.organization_id, membership.user_id)
    return [ConversationOut.model_validate(row) for row in rows]


def _message_out(message, actions) -> MessageOut:
    return MessageOut(
        id=message.id,
        role=message.role,
        content=message.content if message.role != "event" else _event_text(message),
        steps=message.steps or [],
        cards=message.cards or [],
        suggestions=message.suggestions or [],
        actions=[ActionOut(**agent.action_view(a)) for a in actions],
        mode=message.mode,
        created_at=message.created_at,
    )


def _event_text(message) -> str:
    """The outcome of an action as the person reads it: not the note the model was given."""
    if message.content.startswith("The person cancelled"):
        return "Cancelled. Nothing was changed."
    if "but Sentra refused it:" in message.content:
        return message.content.split("but Sentra refused it:", 1)[1].strip()
    return "Done."


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> ConversationDetail:
    found = store.conversation(db, membership.organization_id, membership.user_id, conversation_id)
    by_message = store.actions_of(db, found.id)
    return ConversationDetail(
        id=found.id,
        title=found.title,
        messages=[_message_out(m, by_message.get(m.id, [])) for m in store.messages(db, found.id)],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> None:
    found = store.conversation(db, membership.organization_id, membership.user_id, conversation_id)
    store.delete_conversation(db, found)


@router.post("/chat")
async def chat(
    data: ChatIn,
    request: Request,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    limiter.check(membership.user_id)
    if data.conversation_id:
        found = await run_in_threadpool(
            store.conversation,
            db,
            membership.organization_id,
            membership.user_id,
            data.conversation_id,
        )
        if (
            await run_in_threadpool(store.count_messages, db, found.id)
            >= MAX_MESSAGES_IN_CONVERSATION
        ):
            raise AppError("This conversation is full. Start a new one.", code="conversation_full")
    else:
        found = await run_in_threadpool(
            store.start, db, membership.organization_id, membership.user_id, data.message
        )
    caller = _caller(request, membership, data.page)
    stream = agent.chat(request.app, db, caller, found.id, data.message.strip())
    return StreamingResponse(
        _events(
            stream,
            {"event": "conversation", "conversation": {"id": str(found.id), "title": found.title}},
        ),
        media_type="text/event-stream",
        headers=HEADERS,
    )


@router.post("/actions/{action_id}")
async def decide(
    action_id: uuid.UUID,
    data: DecisionIn,
    request: Request,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # Looked up before the stream starts, so someone else's proposal answers 404, not a stream.
    action = await run_in_threadpool(
        store.action, db, membership.organization_id, membership.user_id, action_id
    )
    caller = _caller(request, membership, data.page)
    stream = agent.decide(request.app, db, caller, action, data.decision)
    return StreamingResponse(_events(stream), media_type="text/event-stream", headers=HEADERS)
