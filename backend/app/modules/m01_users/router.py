from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.modules.m01_users import service
from app.modules.m01_users.deps import current_user
from app.modules.m01_users.models import User
from app.modules.m01_users.password_policy import RULES
from app.modules.m01_users.schemas import (
    EmailRequest,
    LoginRequest,
    MessageOut,
    RegisterRequest,
    ResetPasswordRequest,
    TokenRequest,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["M1 Authentication"])

CHECK_EMAIL = "If the address can be used, we've sent an e-mail with the next step."


def _set_session_cookie(response: Response, raw: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        raw,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.get("/password-policy")
def password_policy() -> list[dict[str, str]]:
    """The checklist shown under the password field."""
    return [{"key": rule.key, "label": rule.label} for rule in RULES]


@router.post("/register", status_code=status.HTTP_202_ACCEPTED)
def register(
    data: RegisterRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.register(db, data, background)
    return MessageOut(message=CHECK_EMAIL)


@router.post("/verify-email")
def verify_email(data: TokenRequest, db: Session = Depends(get_db)) -> MessageOut:
    service.verify_email(db, data.token)
    return MessageOut(message="Your e-mail address is confirmed. You can log in now.")


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    data: EmailRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.resend_verification(db, data.email, background)
    return MessageOut(message=CHECK_EMAIL)


@router.post("/login")
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
    _set_session_cookie(response, raw)
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie_name)
    if raw:
        service.logout(db, raw)
    response.delete_cookie(settings.session_cookie_name, path="/")


@router.get("/me")
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    data: EmailRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.forgot_password(db, data.email, background)
    return MessageOut(
        message="If an account exists for this address, we've sent a reset link. "
        "It expires in 30 minutes."
    )


@router.post("/reset-password")
def reset_password(
    data: ResetPasswordRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    service.reset_password(db, data.token, data.new_password, background)
    return MessageOut(message="Your password was changed. Log in with the new password.")
