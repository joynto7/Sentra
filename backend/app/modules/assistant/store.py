"""Conversations, messages and proposed actions in the database. Every function takes the person's
organization and user, and every query is limited to them: a conversation is private to its owner
(NFR-3.3), and a guessed id of someone else's answers "not found", like one that does not exist.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.modules.assistant.models import (
    RETENTION_DAYS,
    Action,
    ActionStatus,
    Conversation,
    Message,
)

HISTORY_MESSAGES = 14  # how much of a conversation the model reads
REPLAYED_TURNS = 2  # of those, the newest turns whose tool results it reads again
PROPOSAL_MINUTES = 60  # how long a proposed action may be confirmed


def conversation(
    db: Session, organization_id: uuid.UUID, user_id: uuid.UUID, id: uuid.UUID
) -> Conversation:
    found = db.scalar(
        select(Conversation).where(
            Conversation.id == id,
            Conversation.organization_id == organization_id,
            Conversation.user_id == user_id,
        )
    )
    if found is None:
        raise NotFoundError("This conversation doesn't exist.")
    return found


def start(
    db: Session, organization_id: uuid.UUID, user_id: uuid.UUID, first_message: str
) -> Conversation:
    title = " ".join(first_message.split())[:80] or "New conversation"
    made = Conversation(organization_id=organization_id, user_id=user_id, title=title)
    db.add(made)
    db.commit()
    return made


def list_conversations(
    db: Session, organization_id: uuid.UUID, user_id: uuid.UUID, limit: int = 30
) -> list[Conversation]:
    return list(
        db.scalars(
            select(Conversation)
            .where(Conversation.organization_id == organization_id, Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
            .limit(limit)
        )
    )


def delete_conversation(db: Session, found: Conversation) -> None:
    db.delete(found)
    db.commit()


def messages(db: Session, conversation_id: uuid.UUID) -> list[Message]:
    return list(
        db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at, Message.id)
        )
    )


def count_messages(db: Session, conversation_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation_id)
        )
        or 0
    )


def add_message(
    db: Session, conversation_id: uuid.UUID, role: str, content: str = "", **fields
) -> Message:
    made = Message(conversation_id=conversation_id, role=role, content=content, **fields)
    db.add(made)
    # The conversation moves to the top of the list.
    db.execute(
        update(Conversation).where(Conversation.id == conversation_id).values(updated_at=func.now())
    )
    db.commit()
    return made


def actions_of(db: Session, conversation_id: uuid.UUID) -> dict[uuid.UUID, list[Action]]:
    by_message: dict[uuid.UUID, list[Action]] = {}
    for action in db.scalars(
        select(Action).where(Action.conversation_id == conversation_id).order_by(Action.created_at)
    ):
        if action.message_id:
            by_message.setdefault(action.message_id, []).append(action)
    return by_message


def propose(
    db: Session,
    *,
    organization_id,
    user_id,
    conversation_id,
    tool,
    tool_call_id,
    arguments,
    summary,
    risk,
) -> Action:
    made = Action(
        organization_id=organization_id,
        user_id=user_id,
        conversation_id=conversation_id,
        tool=tool,
        tool_call_id=tool_call_id,
        arguments=arguments,
        summary=summary,
        risk=risk,
        status=ActionStatus.PENDING,
    )
    db.add(made)
    db.commit()
    return made


def attach(db: Session, actions: list[Action], message_id: uuid.UUID) -> None:
    for action in actions:
        action.message_id = message_id
    db.commit()


def action(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID, id: uuid.UUID) -> Action:
    found = db.scalar(
        select(Action).where(
            Action.id == id, Action.organization_id == organization_id, Action.user_id == user_id
        )
    )
    if found is None:
        raise NotFoundError("This action doesn't exist.")
    return found


def claim(db: Session, found: Action) -> bool:
    """Takes a pending action for execution, once. Two clicks, or two tabs, can never run it twice:
    only the update that finds it still pending wins."""
    oldest = datetime.now(UTC) - timedelta(minutes=PROPOSAL_MINUTES)
    result = db.execute(
        update(Action)
        .where(
            Action.id == found.id, Action.status == ActionStatus.PENDING, Action.created_at > oldest
        )
        .values(status=ActionStatus.RUNNING)
    )
    db.commit()
    db.refresh(found)
    return result.rowcount == 1


def finish(
    db: Session, found: Action, status: str, *, result=None, error: str | None = None
) -> None:
    found.status = status
    found.result = result
    found.error = error
    found.decided_at = datetime.now(UTC)
    db.commit()


def history(db: Session, conversation_id: uuid.UUID) -> list[dict]:
    """The conversation as the model reads it, in the OpenAI form. The newest turns keep their tool
    calls and results; older ones are only what was said, so a long conversation stays cheap."""
    rows = messages(db, conversation_id)[-HISTORY_MESSAGES:]
    assistant_turns = [i for i, m in enumerate(rows) if m.role == "assistant"]
    replay = set(assistant_turns[-REPLAYED_TURNS:])
    out: list[dict] = []
    for i, row in enumerate(rows):
        if row.role == "assistant":
            if i in replay and row.trace:
                out.extend(row.trace)
            elif row.content:
                out.append({"role": "assistant", "content": row.content})
        elif row.role == "event":
            out.append({"role": "user", "content": f"[Sentra, not the person] {row.content}"})
        else:
            out.append({"role": "user", "content": row.content})
    return _consistent(out)


def _consistent(items: list[dict]) -> list[dict]:
    """Drops a tool result whose call is not there (a trace cut at the window's edge), which
    providers reject."""
    seen: set[str] = set()
    kept = []
    for item in items:
        if item["role"] == "assistant":
            seen.update(call["id"] for call in item.get("tool_calls") or [])
        if item["role"] == "tool" and item.get("tool_call_id") not in seen:
            continue
        kept.append(item)
    return kept


def purge(db: Session, at: datetime | None = None) -> int:
    """The daily clean-up: conversations that were last used `RETENTION_DAYS` ago."""
    limit = (at or datetime.now(UTC)) - timedelta(days=RETENTION_DAYS)
    result = db.execute(delete(Conversation).where(Conversation.updated_at < limit))
    db.commit()
    return result.rowcount or 0
