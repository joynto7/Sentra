"""Endpoints of two-step verification (FR-1.2): the second step of a login (UC-1.2 steps 3-5),
setting it up (UC-1.4) and an organization's requirement (UC-1.7)."""

from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.models import Organization
from app.modules.m01_users import mfa, organizations, service
from app.modules.m01_users.cookies import clear_second_step_cookie, set_session_cookie
from app.modules.m01_users.deps import current_session, current_user, recent_password_confirmation
from app.modules.m01_users.models import Membership, User, UserSession
from app.modules.m01_users.permissions import Action, require
from app.modules.m01_users.schemas import (
    CodeIn,
    LoginOut,
    MfaSetupOut,
    MfaStatusOut,
    OrganizationSecurityIn,
    OrganizationSecurityOut,
    PasswordIn,
    RecoveryCodesOut,
    SecondStepIn,
)
from app.modules.m01_users.sso_routes import state_of

login_router = APIRouter(prefix="/auth/login/mfa", tags=["M1 Authentication"])
account_router = APIRouter(prefix="/account/mfa", tags=["M1 Profile"])
organization_router = APIRouter(prefix="/organizations/current/security", tags=["M1 Organizations"])


def login_out(db: Session, user: User, step: service.LoginStep) -> LoginOut:
    setup = step == service.LoginStep.MFA_SETUP
    required_by = organizations.mfa_required_by(db, user) if setup else []
    return LoginOut(step=step, email=user.email, required_by=required_by)


def _second_step(request: Request) -> str | None:
    return request.cookies.get(get_settings().second_step_cookie_name)


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ---------------------------------------------------------------- the second step of a login


@login_router.get("")
def second_step(request: Request, db: Session = Depends(get_db)) -> LoginOut:
    """What the second-step page shows, also after a reload: the address and what comes next."""
    user = service.pending_login(db, _second_step(request))
    step = service.LoginStep.MFA if user.mfa_enabled else service.LoginStep.MFA_SETUP
    return login_out(db, user, step)


@login_router.post("")
def verify_second_step(
    data: SecondStepIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> LoginOut:
    """UC-1.2 steps 4-5 (4a, 4b): the code from the app or a recovery code; then the session
    starts."""
    user, raw = mfa.log_in_with_code(
        db,
        _second_step(request),
        data.code,
        data.recovery_code,
        _ip(request),
        request.headers.get("user-agent"),
        background,
    )
    set_session_cookie(response, raw)
    clear_second_step_cookie(response)
    return login_out(db, user, service.LoginStep.DONE)


@login_router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def cancel_second_step(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    """ "Back to login", "Not you?" or "Log out": the waiting login ends."""
    service.cancel_login(db, _second_step(request))
    clear_second_step_cookie(response)


@login_router.post("/setup")
def start_setup_at_login(request: Request, db: Session = Depends(get_db)) -> MfaSetupOut:
    """UC-1.4, 1a: an organization requires two-step verification, and the user has none yet."""
    return MfaSetupOut(**asdict(mfa.start_setup_at_login(db, _second_step(request))))


@login_router.post("/enable")
def enable_at_login(
    data: CodeIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RecoveryCodesOut:
    """UC-1.4 steps 4-7 during the login (5a); then the session starts (UC-1.2 step 5)."""
    codes, raw = mfa.enable_at_login(
        db,
        _second_step(request),
        data.code,
        _ip(request),
        request.headers.get("user-agent"),
        background,
    )
    set_session_cookie(response, raw)
    clear_second_step_cookie(response)
    return RecoveryCodesOut(recovery_codes=codes)


# ---------------------------------------------------------------- in the profile (UC-1.4)


@account_router.get("")
def mfa_status(user: User = Depends(current_user), db: Session = Depends(get_db)) -> MfaStatusOut:
    """The Two-step verification card of the Security page (Screen 09)."""
    found = mfa.status(db, user)
    return MfaStatusOut(enabled=user.mfa_enabled, **asdict(found))


@account_router.post("/setup")
def start_setup(
    data: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> MfaSetupOut:
    """Steps 1-3 (2a): after the password, a new secret as a QR code."""
    return MfaSetupOut(**asdict(mfa.start_setup(db, user, data.password)))


@account_router.post("/enable")
def enable(
    data: CodeIn,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> RecoveryCodesOut:
    """Steps 4-7 (5a): the first code turns it on; the recovery codes are shown once."""
    codes = mfa.enable_mfa(
        db, user, data.code, _ip(request), request.headers.get("user-agent"), background
    )
    return RecoveryCodesOut(recovery_codes=codes)


@account_router.post("/recovery-codes")
def renew_recovery_codes(
    data: PasswordIn,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> RecoveryCodesOut:
    """ "Generate new codes": ten new codes; the old ones stop working."""
    codes = mfa.renew_recovery_codes(
        db, user, data.password, _ip(request), request.headers.get("user-agent"), background
    )
    return RecoveryCodesOut(recovery_codes=codes)


# ---------------------------------------------------------------- the organization (UC-1.7)


def _security_out(
    db: Session, membership: Membership, session: UserSession
) -> OrganizationSecurityOut:
    organization = db.get_one(Organization, membership.organization_id)
    return OrganizationSecurityOut(
        mfa_required=organization.mfa_required,
        members_without_mfa=len(mfa.members_without_mfa(db, organization.id)),
        sso=state_of(db, organization.id),
        password_confirmed_at=session.password_confirmed_at,
        password_confirmed_until=service.password_confirmed_until(session),
    )


@organization_router.get("")
def organization_security(
    membership: Membership = Depends(require(Action.MANAGE_ORGANIZATION_SECURITY)),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> OrganizationSecurityOut:
    """Screen 11, for Organization Administrators only (UC-1.7 quality requirement 3)."""
    return _security_out(db, membership, session)


@organization_router.put("")
def update_organization_security(
    data: OrganizationSecurityIn,
    background: BackgroundTasks,
    membership: Membership = Depends(require(Action.MANAGE_ORGANIZATION_SECURITY)),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> OrganizationSecurityOut:
    """Steps 3, 6 and 7 (3a), with the password confirmed in the last 10 minutes (step 2)."""
    organization = db.get_one(Organization, membership.organization_id)
    admin = db.get_one(User, membership.user_id)
    mfa.require_mfa(db, organization, admin, data.mfa_required, background)
    return _security_out(db, membership, session)
