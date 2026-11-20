import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users import organizations
from app.modules.m01_users.deps import current_session, current_user
from app.modules.m01_users.models import User, UserSession
from app.modules.m09_reporting import notifications
from app.modules.m09_reporting.api_key_routes import router as api_key_router
from app.modules.m09_reporting.events import EVENTS
from app.modules.m09_reporting.report_routes import router as report_router
from app.modules.m09_reporting.schemas import (
    MarkedOut,
    NotificationList,
    NotificationOut,
    PreferenceIn,
    PreferenceOut,
    UnreadOut,
)

router = APIRouter()
notifications_router = APIRouter(prefix="/notifications", tags=["M9 Notifications"])


def organization_id(
    session: UserSession = Depends(current_session), db: Session = Depends(get_db)
) -> uuid.UUID | None:
    """The organization this browser works in; its notifications are shown, with account alerts."""
    membership = organizations.current(db, session)
    return membership.organization_id if membership else None


@notifications_router.get("")
def list_notifications(
    unread: bool = False,
    tab: str = Query(default="", pattern="^(|assigned|approvals)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> NotificationList:
    """The notification centre (Screen 54): newest first, "Only unread" and the tabs."""
    items, total = notifications.list_notifications(db, user.id, org, unread, tab, limit, offset)
    return NotificationList(
        items=[NotificationOut.model_validate(item) for item in items],
        total=total,
        unread_count=notifications.unread_count(db, user.id, org),
    )


@notifications_router.get("/unread-count")
def unread_count(
    user: User = Depends(current_user),
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> UnreadOut:
    """For the dot on the bell in the top bar."""
    return UnreadOut(unread_count=notifications.unread_count(db, user.id, org))


@notifications_router.post("/read-all")
def mark_all_read(
    user: User = Depends(current_user),
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> MarkedOut:
    return MarkedOut(marked=notifications.mark_all_read(db, user.id, org))


@notifications_router.get("/preferences")
def get_preferences(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[PreferenceOut]:
    """The Notifications card of the Profile page (Screen 08)."""
    chosen = notifications.preferences(db, user.id)
    return [
        PreferenceOut(
            event=e.key,
            label=e.label,
            locked=e.locked,
            in_app=chosen[e.key][0],
            email=chosen[e.key][1],
        )
        for e in EVENTS
    ]


@notifications_router.put("/preferences")
def set_preferences(
    data: list[PreferenceIn], user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[PreferenceOut]:
    notifications.set_preferences(db, user, [d.model_dump() for d in data])
    return get_preferences(user, db)


@notifications_router.post("/{notification_id}/read")
def mark_read(
    notification_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> NotificationOut:
    """UC-9.3 step 6: opened, so read."""
    return NotificationOut.model_validate(notifications.mark_read(db, user.id, notification_id))


router.include_router(notifications_router)
router.include_router(api_key_router)
router.include_router(report_router)
