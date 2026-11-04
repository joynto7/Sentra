"""The endpoints of single sign-on (FR-1.3): connecting an identity provider on Screen 11
(UC-1.7 steps 4-6) and logging in with it on Screen 01 (UC-1.5)."""

import uuid

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.core.models import Organization
from app.modules.m01_users import service, sso
from app.modules.m01_users.cookies import set_second_step_cookie, set_session_cookie
from app.modules.m01_users.deps import recent_password_confirmation
from app.modules.m01_users.models import Membership, SsoProtocol, User, UserSession
from app.modules.m01_users.permissions import Action, require
from app.modules.m01_users.schemas import (
    SsoDetailsIn,
    SsoOut,
    SsoStartIn,
    SsoStartOut,
    SsoTestOut,
)

organization_router = APIRouter(
    prefix="/organizations/current/security/sso", tags=["M1 Organizations"]
)
login_router = APIRouter(prefix="/auth/sso", tags=["M1 Authentication"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def state_of(db: Session, organization_id: uuid.UUID) -> SsoOut:
    """What Screen 11 shows about the connection. The client secret is never part of it
    (UC-1.7 quality requirement 4)."""
    connection = sso.connection_of(db, organization_id)
    return SsoOut(
        connected=connection is not None,
        protocol=connection.protocol if connection else SsoProtocol.OIDC,
        email_domain=connection.email_domain if connection else None,
        issuer=connection.issuer if connection else None,
        client_id=connection.client_id if connection else None,
        tested_at=connection.tested_at if connection else None,
        redirect_uri=sso.redirect_uri(),
    )


# ---------------------------------------------------------------- UC-1.7 steps 4-6


@organization_router.post("/test")
def test_connection(
    data: SsoDetailsIn,
    membership: Membership = Depends(require(Action.MANAGE_ORGANIZATION_SECURITY)),
    db: Session = Depends(get_db),
) -> SsoTestOut:
    """Step 5: ask the identity provider, before anything is saved. 5a answers with what to look
    at, and nothing is written either way."""
    try:
        message = sso.test(db, membership.organization_id, data.details())
    except sso.ConnectionFailed as exc:
        return SsoTestOut(ok=False, message=str(exc))
    return SsoTestOut(ok=True, message=message)


@organization_router.put("")
def connect(
    data: SsoDetailsIn,
    request: Request,
    membership: Membership = Depends(require(Action.MANAGE_ORGANIZATION_SECURITY)),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> SsoOut:
    """Steps 4-6, with the password confirmed in the last 10 minutes (step 2). The connection is
    tested again here, so what is saved is what was proved to work a moment ago (5a)."""
    organization = db.get_one(Organization, membership.organization_id)
    admin = db.get_one(User, membership.user_id)
    try:
        connection = sso.save(db, organization, admin, data.details())
    except sso.ConnectionFailed as exc:
        db.rollback()
        raise AppError(str(exc), code="sso_test_failed", status_code=422) from exc
    audit.record(
        db,
        organization_id=organization.id,
        actor=admin,
        action="organization.sso_connected",
        summary=f"Connected single sign-on for @{connection.email_domain} (OpenID Connect)",
        item=audit.Item("organization", organization.id, organization.name),
        details={"issuer": connection.issuer, "email_domain": connection.email_domain},
        source_address=_ip(request),
    )
    db.commit()
    return state_of(db, organization.id)


@organization_router.delete("")
def disconnect(
    request: Request,
    membership: Membership = Depends(require(Action.MANAGE_ORGANIZATION_SECURITY)),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> SsoOut:
    """Single sign-on off again. Nobody loses an account: everybody logs in with a password."""
    organization = db.get_one(Organization, membership.organization_id)
    admin = db.get_one(User, membership.user_id)
    if sso.disconnect(db, organization.id):
        audit.record(
            db,
            organization_id=organization.id,
            actor=admin,
            action="organization.sso_disconnected",
            summary="Disconnected single sign-on",
            item=audit.Item("organization", organization.id, organization.name),
            source_address=_ip(request),
        )
    db.commit()
    return state_of(db, organization.id)


# ---------------------------------------------------------------- UC-1.5


@login_router.post("/start")
def start(data: SsoStartIn, db: Session = Depends(get_db)) -> SsoStartOut:
    """Steps 1-2. 2a: no provider is connected for the domain, so Screen 01 goes back to the
    password form. That is not a secret — the person typed their own address."""
    try:
        url = sso.start(db, data.email)
    except sso.ConnectionFailed as exc:
        db.rollback()
        raise AppError(sso.FAILED, code="sso_failed", status_code=502) from exc
    db.commit()
    if url is None:
        return SsoStartOut(authorization_url=None, message=sso.NO_PROVIDER)
    return SsoStartOut(authorization_url=url, message=None)


@login_router.get("/callback")
def callback(
    request: Request,
    db: Session = Depends(get_db),
    code: str = "",
    state: str = "",
    error: str = "",
) -> RedirectResponse:
    """Steps 4-6: the identity provider's answer. The browser is sent here, so the answer is a
    redirect — into the workspace when the login holds, and back to Screen 01 with a short
    reason when it does not (5a, 5b). The reason is a code; the sentence lives in the page."""
    web = get_settings().web_url
    if error or not code or not state:
        return _back(web, "failed")
    try:
        user, connection, _ = sso.finish(db, code, state)
    except sso.SsoError as exc:
        db.commit()  # the login state stays used, whatever went wrong
        return _back(web, exc.reason)

    step, raw = service.sso_session(
        db,
        user,
        connection.organization_id,
        request.headers.get("user-agent"),
        _ip(request),
    )
    db.commit()
    if step == service.LoginStep.DONE:
        answer = _to(f"{web}/dashboard")
        set_session_cookie(answer, raw)
        return answer
    where = "/login/two-step" if step == service.LoginStep.MFA else "/login/two-step/setup"
    answer = _to(f"{web}{where}")
    set_second_step_cookie(answer, raw)
    return answer


def _to(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)


def _back(web: str, reason: str) -> RedirectResponse:
    return _to(f"{web}/login?sso={reason}")
