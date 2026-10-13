from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.models import Organization
from app.modules.m01_users import organizations, service
from app.modules.m01_users.account_routes import account_router
from app.modules.m01_users.cookies import set_session_cookie
from app.modules.m01_users.deps import current_session, current_user
from app.modules.m01_users.invitation_routes import admin_router as invitation_admin_router
from app.modules.m01_users.invitation_routes import public_router as invitation_router
from app.modules.m01_users.member_routes import router as member_router
from app.modules.m01_users.models import User, UserSession
from app.modules.m01_users.organization_routes import organization_out
from app.modules.m01_users.organization_routes import router as organization_router
from app.modules.m01_users.password_policy import RULES
from app.modules.m01_users.schemas import (
    EmailRequest,
    LoginRequest,
    MeOut,
    MessageOut,
    RegisterRequest,
    ResetPasswordRequest,
    TokenRequest,
    UserOut,
)

auth_router = APIRouter(prefix="/auth", tags=["M1 Authentication"])

CHECK_EMAIL = "If the address can be used, we've sent an e-mail with the next step."


@auth_router.get("/password-policy")
def password_policy() -> list[dict[str, str]]:
    """The checklist shown under the password field."""
    return [{"key": rule.key, "label": rule.label} for rule in RULES]


@auth_router.post("/register", status_code=status.HTTP_202_ACCEPTED)
def register(
    data: RegisterRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.register(db, data, background)
    return MessageOut(message=CHECK_EMAIL)


@auth_router.post("/verify-email")
def verify_email(data: TokenRequest, db: Session = Depends(get_db)) -> MessageOut:
    service.verify_email(db, data.token)
    return MessageOut(message="Your e-mail address is confirmed. You can log in now.")


@auth_router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    data: EmailRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.resend_verification(db, data.email, background)
    return MessageOut(message=CHECK_EMAIL)


@auth_router.post("/login")
def login(
    data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> UserOut:
    user, raw = service.login(
        db,
        data.email,
        data.password,
        request.headers.get("user-agent"),
        request.client.host if request.client else None,
    )
    set_session_cookie(response, raw)
    return UserOut.model_validate(user)


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie_name)
    if raw:
        service.logout(db, raw)
    response.delete_cookie(settings.session_cookie_name, path="/")


@auth_router.get("/me")
def me(
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> MeOut:
    """The logged-in user and the organization this browser works in (None = none yet)."""
    membership = organizations.current(db, session)
    organization = None
    if membership is not None:
        org = db.get_one(Organization, membership.organization_id)
        organization = organization_out(membership, org, org.id)
    return MeOut(**UserOut.model_validate(user).model_dump(), organization=organization)


@auth_router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    data: EmailRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.forgot_password(db, data.email, background)
    return MessageOut(
        message="If an account exists for this address, we've sent a reset link. "
        "It expires in 30 minutes."
    )


@auth_router.post("/reset-password")
def reset_password(
    data: ResetPasswordRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.reset_password(db, data.token, data.new_password, background)
    return MessageOut(message="Your password was changed. Log in with the new password.")


# All M1 endpoints; the module loader picks up `router`.
router = APIRouter()
router.include_router(auth_router)
router.include_router(account_router)
router.include_router(organization_router)
router.include_router(member_router)
router.include_router(invitation_admin_router)
router.include_router(invitation_router)
