import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)
    conversation_id: uuid.UUID | None = None
    page: str = Field(default="", max_length=200)  # the path the person is on, for "this target"


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: str = Field(pattern="^(confirm|cancel)$")
    page: str = Field(default="", max_length=200)


class StatusOut(BaseModel):
    available: bool  # a model is configured for the assistant and this organization may use it
    mode: str  # "ai" or "guide"
    model: str | None  # the model as a person calls it, never a key or an address
    deployment: str | None  # "local" or "external": where the conversation goes
    starters: list[str]
    can_do: list[str]  # what this role can ask the assistant to do, in words


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    updated_at: datetime


class ActionOut(BaseModel):
    id: uuid.UUID
    tool: str
    summary: str
    risk: str
    status: str
    error: str | None
    fields: list[list[str]]


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str  # "user", "assistant" or "event" (the outcome of a confirmed action)
    content: str
    steps: list[dict]
    cards: list[dict]
    suggestions: list[str]
    actions: list[ActionOut]
    mode: str
    created_at: datetime


class ConversationDetail(BaseModel):
    id: uuid.UUID
    title: str
    messages: list[MessageOut]
