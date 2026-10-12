import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
