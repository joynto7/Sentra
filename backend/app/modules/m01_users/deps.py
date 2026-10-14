"""FastAPI dependencies for other modules: `Depends(current_user)` protects an endpoint."""

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import NotAuthenticatedError
from app.modules.m01_users import service
from app.modules.m01_users.models import User, UserSession


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
