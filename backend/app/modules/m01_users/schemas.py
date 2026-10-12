import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.m01_users.models import Role


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    accept_terms: bool


class EmailRequest(BaseModel):
    email: EmailStr


class TokenRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    status: str


class MessageOut(BaseModel):
    message: str


class OrganizationCreate(BaseModel):
    name: str = Field(max_length=500)


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: str
    role_label: str
    is_current: bool = False


class MeOut(UserOut):
    """The logged-in user and the organization this browser is working in (None = none yet)."""

    organization: OrganizationOut | None


class PermissionOut(BaseModel):
    action: str
    label: str


class RoleOut(BaseModel):
    """A role with what it may do (FR-1.6), for role choices and the change-role dialog."""

    role: str
    label: str
    description: str
    permissions: list[PermissionOut]


class MemberOut(BaseModel):
    membership_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    email: str
    role: str
    role_label: str
    last_login_at: datetime | None
    joined_at: datetime
    is_you: bool


class RoleChangeIn(BaseModel):
    role: Role
    password: str = Field(min_length=1, max_length=256)  # UC-10.1 step 4 (NFR-3.5)
