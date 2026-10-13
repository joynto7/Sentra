"""Notifications (FR-9.3, UC-9.3): in the application and by e-mail, as each user chooses.

Other modules call `notify()` when something happens. It applies every recipient's preferences
(UC-9.3 step 2, 2a), combines repeated events (1a) and hands the e-mails to a worker, which retries
a failed delivery (3a). An e-mail holds only a short sentence and a link: never evidence or
secrets (quality requirement 3).
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.email import send_email
from app.core.errors import AppError, NotFoundError
from app.modules.m01_users.models import User
from app.modules.m09_reporting.events import BY_KEY, EVENTS
from app.modules.m09_reporting.models import Notification, NotificationPreference

COMBINE_WITHIN = timedelta(hours=1)
log = logging.getLogger("uvicorn.error")


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- preferences


def preferences(db: Session, user_id: uuid.UUID) -> dict[str, tuple[bool, bool]]:
    """(in-app, e-mail) for every event. Without a choice both are on; locked events always are."""
    stored = {
        p.event: p
        for p in db.scalars(
            select(NotificationPreference).where(NotificationPreference.user_id == user_id)
        )
    }
    result = {}
    for event in EVENTS:
        choice = stored.get(event.key)
        on = event.locked or choice is None
        result[event.key] = (True, True) if on else (choice.in_app, choice.email)
    return result


def set_preferences(db: Session, user: User, changes: list[dict]) -> None:
    """UC-1.11 step 2: the choices of the Notifications card (Screen 08)."""
    for change in changes:
        event = BY_KEY.get(change["event"])
        if event is None:
            raise AppError(
                f"Unknown event: {change['event']}.", code="unknown_event", status_code=422
            )
        if event.locked and not (change["in_app"] and change["email"]):
            raise AppError(
                "Account security alerts are always on, for your protection.",
                code="always_on",
                status_code=422,
            )
    for change in changes:
        row = db.scalar(
            select(NotificationPreference).where(
                NotificationPreference.user_id == user.id,
                NotificationPreference.event == change["event"],
            )
        )
        if row is None:
            row = NotificationPreference(user_id=user.id, event=change["event"])
            db.add(row)
        row.in_app, row.email = change["in_app"], change["email"]
    db.commit()


# ---------------------------------------------------------------- notifying


def notify(
    db: Session,
    *,
    event: str,
    user_ids: list[uuid.UUID],
    organization_id: uuid.UUID | None,
    text: str,
    subject: str,
    link: str | None = None,
    group_key: str | None = None,
    combined_text: str | None = None,
    email: bool = True,
) -> None:
    """UC-9.3 steps 1-3 for the given recipients. Call it after your own change is committed.

    `group_key` and `combined_text` (with "{count}") combine events of the same group within an
    hour into one notification (1a), and send only the first e-mail of the group. `email=False`
    when the caller sends its own e-mail, as M1 does for password changes.
    """
    assert event in BY_KEY, event
    mails = []
    for user_id in dict.fromkeys(user_ids):
        in_app, by_email = preferences(db, user_id)[event]
        combined = _combine(db, user_id, group_key, combined_text) if group_key else None
        if in_app and combined is None:
            db.add(
                Notification(
                    user_id=user_id,
                    organization_id=organization_id,
                    event=event,
                    text=text[:300],
                    subject=subject[:120],
                    link=link,
                    group_key=group_key,
                )
            )
        if email and by_email and combined is None:
            user = db.get(User, user_id)
            if user is not None:
                mails.append((user.email, *_email(user.name, text, link)))
    db.commit()
    for mail in mails:
        _deliver(*mail)


def _combine(
    db: Session, user_id: uuid.UUID, group_key: str, combined_text: str | None
) -> Notification | None:
    """The unread notification of the same group from the last hour, now counting one more."""
    earlier = db.scalar(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.group_key == group_key,
            Notification.read_at.is_(None),
            Notification.last_event_at > _now() - COMBINE_WITHIN,
        )
    )
    if earlier is not None:
        earlier.count += 1
        earlier.last_event_at = _now()
        if combined_text:
            earlier.text = combined_text.format(count=earlier.count)[:300]
    return earlier


def _email(name: str, text: str, link: str | None) -> tuple[str, str]:
    web = get_settings().web_url
    sentence = text if text.endswith((".", "!", "?")) else f"{text}."
    return (
        text[:150],
        f"Hello {name},\n\n{sentence}\n\nOpen it in Sentra: {web}{link or '/dashboard'}\n\n"
        f"You get this e-mail because of your notification settings: {web}/account/profile\n",
    )


def _deliver(to: str, subject: str, body: str) -> None:
    """Hands the e-mail to the worker, which retries a failed delivery (UC-9.3, 3a)."""
    if get_settings().email_backend == "memory":  # the tests: no queue, the outbox gets it now
        send_email(to, subject, body)
        return
    from app.workers.reporting.emails import send_notification_email

    try:
        send_notification_email.delay(to, subject, body)
    except Exception:  # the queue is down: the in-app notification is still there
        log.warning("Notification e-mail to %s could not be queued", to, exc_info=True)


# ---------------------------------------------------------------- reading


def _mine(user_id: uuid.UUID, organization_id: uuid.UUID | None):
    """A user's notifications of the organization they work in, plus their account alerts."""
    return (
        Notification.user_id == user_id,
        or_(
            Notification.organization_id.is_(None), Notification.organization_id == organization_id
        ),
    )


def list_notifications(
    db: Session,
    user_id: uuid.UUID,
    organization_id: uuid.UUID | None,
    unread_only: bool,
    tab: str,
    limit: int,
    offset: int,
) -> tuple[list[Notification], int]:
    query = select(Notification).where(*_mine(user_id, organization_id))
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    if tab:
        query = query.where(Notification.event.in_([e.key for e in EVENTS if e.tab == tab]))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(
        query.order_by(Notification.last_event_at.desc(), Notification.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return list(items), total


def unread_count(db: Session, user_id: uuid.UUID, organization_id: uuid.UUID | None) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(*_mine(user_id, organization_id), Notification.read_at.is_(None))
    )


def mark_read(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification:
    """UC-9.3 step 6."""
    notification = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user_id
        )
    )
    if notification is None:
        raise NotFoundError("Notification not found.")
    if notification.read_at is None:
        notification.read_at = _now()
        db.commit()
    return notification


def mark_all_read(db: Session, user_id: uuid.UUID, organization_id: uuid.UUID | None) -> int:
    result = db.execute(
        update(Notification)
        .where(*_mine(user_id, organization_id), Notification.read_at.is_(None))
        .values(read_at=_now())
    )
    db.commit()
    return result.rowcount
