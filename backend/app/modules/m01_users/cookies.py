from fastapi import Response

from app.core.config import get_settings


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
