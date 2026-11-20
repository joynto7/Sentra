import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event: str
    text: str
    subject: str  # shown in bold inside the text
    link: str | None
    count: int
    read_at: datetime | None
    last_event_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int


class UnreadOut(BaseModel):
    unread_count: int


class MarkedOut(BaseModel):
    marked: int


class PreferenceOut(BaseModel):
    event: str
    label: str
    locked: bool  # "Always on for your protection."
    in_app: bool
    email: bool


class PreferenceIn(BaseModel):
    event: str = Field(max_length=40)
    in_app: bool
    email: bool
