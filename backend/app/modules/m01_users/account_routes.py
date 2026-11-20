"""Endpoints of the profile pages (FR-1.7, UC-1.11): /api/v1/account/…"""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users import account
from app.modules.m01_users.deps import current_session, current_user
from app.modules.m01_users.models import User, UserSession
from app.modules.m01_users.schemas import (
    ActivityOut,
    EmailChangeIn,
    MessageOut,
    PasswordChangeIn,
    ProfileIn,
    ProfileOut,
    SessionOut,
    TokenRequest,
)

account_router = APIRouter(prefix="/account", tags=["M1 Profile"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@account_router.get("/profile")
def get_profile(user: User = Depends(current_user)) -> ProfileOut:
    return ProfileOut.model_validate(user)


@account_router.patch("/profile")
def update_profile(
    data: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> ProfileOut:
    """UC-1.11 steps 2-3: name and phone."""
    return ProfileOut.model_validate(account.update_profile(db, user, data.name, data.phone))


@account_router.post("/email", status_code=status.HTTP_202_ACCEPTED)
def request_email_change(
    data: EmailChangeIn,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> MessageOut:
    """UC-1.11, 2a: a confirmation link goes to the new address."""
    account.request_email_change(db, user, data.email, data.password, background, _ip(request))
    return MessageOut(
        message="We sent a link to the new address. Your address changes once you open it."
    )


@account_router.delete("/email", status_code=status.HTTP_204_NO_CONTENT)
def cancel_email_change(user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    account.cancel_email_change(db, user)


@account_router.post("/email/confirm")
def confirm_email_change(
    data: TokenRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    """Opened from the e-mail, perhaps in another browser: the link itself is the proof."""
    user = account.confirm_email_change(db, data.token, background)
    return MessageOut(message=f"Your e-mail address is now {user.email}.")


@account_router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: PasswordChangeIn,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> None:
    """UC-1.11 steps 4-5: every other session ends; this one stays logged in."""
    account.change_password(
        db, user, session, data.current_password, data.new_password, background, _ip(request)
    )


@account_router.get("/sessions")
def list_sessions(
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    return [
        SessionOut(
            id=s.id,
            user_agent=s.user_agent,
            ip_address=s.ip_address,
            created_at=s.created_at,
            last_seen_at=s.last_seen_at,
            current=s.id == session.id,
        )
        for s in account.active_sessions(db, user)
    ]


@account_router.post("/sessions/{session_id}/end", status_code=status.HTTP_204_NO_CONTENT)
def end_session(
    session_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> None:
    """UC-1.11 step 7: ends one of the user's other sessions at once."""
    account.end_session(db, user, session, session_id, _ip(request))


@account_router.post("/sessions/end-others")
def end_other_sessions(
    request: Request,
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> MessageOut:
    ended = account.end_other_sessions(db, user, session, _ip(request))
    return MessageOut(message=f"{ended} other session{'' if ended == 1 else 's'} logged out.")


@account_router.get("/activity")
def recent_activity(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[ActivityOut]:
    """UC-1.11 step 6: the latest security events of the account."""
    return [ActivityOut.model_validate(event) for event in account.recent_activity(db, user)]
