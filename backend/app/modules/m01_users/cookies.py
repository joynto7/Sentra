from fastapi import Response

from app.core.config import get_settings
from app.modules.m01_users.service import SECOND_STEP_VALID_FOR


def set_session_cookie(response: Response, raw: str) -> None:
    """The login session cookie: HTTP-only, so page scripts cannot read it (NFR-3.5)."""
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        raw,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def set_second_step_cookie(response: Response, raw: str) -> None:
    """A login whose password was right, waiting for its second step (FR-1.2). HTTP-only like the
    session cookie, and gone after 15 minutes. It opens no page of the workspace."""
    settings = get_settings()
    response.set_cookie(
        settings.second_step_cookie_name,
        raw,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
        max_age=int(SECOND_STEP_VALID_FOR.total_seconds()),
    )


def clear_second_step_cookie(response: Response) -> None:
    response.delete_cookie(get_settings().second_step_cookie_name, path="/")
