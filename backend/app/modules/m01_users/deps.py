"""FastAPI dependencies for other modules: `Depends(current_user)` protects an endpoint."""

from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import NotAuthenticatedError, PermissionDeniedError
from app.modules.m01_users import organizations, service
from app.modules.m01_users.models import Membership, User, UserSession


def current_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    raw = request.cookies.get(get_settings().session_cookie_name)
    found = service.session_user(db, raw) if raw else None
    if found is None:
        raise NotAuthenticatedError("Log in to continue.")
    return found[0]


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    raw = request.cookies.get(get_settings().session_cookie_name)
    found = service.session_user(db, raw) if raw else None
    if found is None:
        raise NotAuthenticatedError("Log in to continue.")
    return found[1]


def current_membership(
    session: UserSession = Depends(current_session), db: Session = Depends(get_db)
) -> Membership:
    """The user's membership in the organization this browser works in.

    Every query on organization data must use `membership.organization_id`, for example
    `scoped_select(Target, membership.organization_id)`, so that no organization can see
    another organization's data (NFR-3.3).
    """
    membership = organizations.current(db, session)
    if membership is None:
        raise PermissionDeniedError(
            "Create an organization or accept an invitation first.", code="no_organization"
        )
    return membership


def platform_admin(user: User = Depends(current_user)) -> User:
    """Only Platform Administrators get through (UC-10.2, 1a; UC-10.3, 1a). The role is
    platform-wide and is not an organization role, so it is checked on the user itself."""
    if not user.platform_admin:
        raise PermissionDeniedError(
            "Only Platform Administrators can open this page.", code="platform_admin_only"
        )
    return user


def recent_password_confirmation(
    session: UserSession = Depends(current_session),
) -> UserSession:
    """For settings that need the password again (UC-1.7 step 2, NFR-3.5): this session must have
    confirmed it in the last 10 minutes, with POST /auth/confirm-password."""
    until = service.password_confirmed_until(session)
    if until is None or until <= datetime.now(UTC):
        raise PermissionDeniedError(
            "Enter your password again to change these settings.",
            code="password_confirmation_required",
        )
    return session
