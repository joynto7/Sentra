import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

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


class OnboardingOut(BaseModel):
    done: bool
    skipped: bool
    step: int
    answers: dict[str, str]
    # The next question to ask after the setup (progressive profiling), or None
    ask: str | None = None


class OnboardingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int | None = None
    answers: dict[str, str] = Field(default_factory=dict, max_length=4)


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
    status: str = "active"  # "suspended": shown in the organization menu, but it can't be opened
    # False until the person has finished or skipped the first-run setup of this organization
    onboarding_done: bool = True


class MeOut(UserOut):
    """The logged-in user and the organization this browser is working in (None = none yet)."""

    organization: OrganizationOut | None
    # Platform Administrators get the platform pages (report 2.4); it is not an organization role.
    platform_admin: bool = False


class LoginOut(BaseModel):
    """The answer to a correct password (UC-1.2): logged in, or the second step comes first.
    Before the second step it tells no more than the address that was typed in."""

    step: str  # "done", "mfa" (enter a code, steps 3-4) or "mfa_setup" (set it up first, 3b)
    email: str
    required_by: list[str] = []  # 3b: the organizations that require two-step verification


class JoinedOut(MeOut):
    """A new account made from an invitation (UC-1.9): logged in, or the organization requires
    two-step verification, which is set up first (step "mfa_setup", UC-1.2 3b)."""

    step: str


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
    mfa_enabled: bool  # the "Two-step verification" column (UC-10.1 step 1)
    last_login_at: datetime | None
    joined_at: datetime
    is_you: bool
    # FR-10.1: the Status column; a suspension keeps its reason, time and who suspended
    status: str = "active"
    suspended_at: datetime | None = None
    suspension_reason: str | None = None
    suspended_by: str | None = None
    # UC-10.2, 1a: only a Platform Administrator can undo a suspension of the whole account
    suspended_by_platform: bool = False


class RoleChangeIn(BaseModel):
    role: Role
    password: str = Field(min_length=1, max_length=256)  # UC-10.1 step 4 (NFR-3.5)


class InviteIn(BaseModel):
    email: EmailStr
    role: Role


class InvitationOut(BaseModel):
    """A pending or expired invitation, for the Pending invitations tab (Screen 12)."""

    id: uuid.UUID
    email: str
    role: str
    role_label: str
    invited_by: str | None
    status: str  # pending or expired
    expires_at: datetime
    created_at: datetime


class InvitationTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class InvitationRegisterIn(InvitationTokenIn):
    """Create an account from an invitation (UC-1.9 step 3). The e-mail is the invited one."""

    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=256)
    accept_terms: bool


class InvitationDetailsOut(BaseModel):
    """What the invited person sees before accepting (Screen 05)."""

    organization: str
    email: str
    role: str
    role_label: str
    role_description: str
    invited_by: str | None
    has_account: bool
    logged_in_as: str | None  # the e-mail of the account logged in in this browser, if any


class PasswordIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


# ---------------------------------------------------------------- profile (FR-1.7)


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    pending_email: str | None  # a new address waiting for its confirmation link (UC-1.11, 2a)
    phone: str | None
    password_changed_at: datetime | None
    created_at: datetime


class ProfileIn(BaseModel):
    name: str = Field(default="", max_length=400)
    phone: str | None = Field(default=None, max_length=64)


class EmailChangeIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class SessionOut(BaseModel):
    id: uuid.UUID
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    last_seen_at: datetime
    current: bool  # the session of this browser ("This device")


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: str
    ip_address: str | None
    user_agent: str | None
    created_at: datetime


# ---------------------------------------------------------------- two-step verification (FR-1.2)


class SecondStepIn(BaseModel):
    """UC-1.2 step 4: a code from the app, or a recovery code instead (4a)."""

    code: str | None = Field(default=None, max_length=20)
    recovery_code: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def one_of_them(self) -> "SecondStepIn":
        if (self.code is None) == (self.recovery_code is None):
            raise ValueError("Send either a code or a recovery code.")
        return self


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)


class MfaSetupOut(BaseModel):
    """UC-1.4 step 3, shown only during the setup: the QR code and the same secret as a key."""

    secret: str
    uri: str  # the otpauth:// address inside the QR code
    qr_code: str  # an SVG image as a data: URI


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]  # shown only this once (UC-1.4 step 6)


class MfaStatusOut(BaseModel):
    """The Two-step verification card of the Security page (Screen 09)."""

    enabled: bool
    enabled_at: datetime | None
    recovery_codes_left: int
    recovery_codes_total: int
    required_by: list[str]  # the user's organizations that require it


class SsoDetailsIn(BaseModel):
    """What an Organization Administrator types in the "Single sign-on" card (UC-1.7 step 4)."""

    protocol: str = "oidc"
    email_domain: str
    issuer: str
    client_id: str
    client_secret: str

    def details(self):
        from app.modules.m01_users.sso import Details

        return Details(
            email_domain=self.email_domain,
            issuer=self.issuer,
            client_id=self.client_id,
            client_secret=self.client_secret,
            protocol=self.protocol,
        )


class SsoOut(BaseModel):
    """The connection as Screen 11 shows it. The client secret is never given back."""

    connected: bool
    protocol: str
    email_domain: str | None
    issuer: str | None
    client_id: str | None
    tested_at: datetime | None
    # The one address the provider may answer to; the administrator copies it into the provider.
    redirect_uri: str


class SsoTestOut(BaseModel):
    """The answer of "Test connection" (UC-1.7 step 5 and 5a)."""

    ok: bool
    message: str


class SsoStartIn(BaseModel):
    email: str


class SsoStartOut(BaseModel):
    """Where to send the browser (UC-1.5 step 2), or why not (2a)."""

    authorization_url: str | None
    message: str | None


class OrganizationSecurityIn(BaseModel):
    mfa_required: bool
    # FR-5.2 (M5), optional: campaigns need a Security Manager's approval before they can run.
    # None leaves the requirement as it is, so a page that only changes one of the two may send
    # only that one.
    requires_scope_approval: bool | None = None


class OrganizationSecurityOut(BaseModel):
    """The Organization security page (Screen 11, UC-1.7)."""

    mfa_required: bool
    members_without_mfa: int
    # The identity provider of FR-1.3, in the same answer: Screen 11 is one page.
    sso: SsoOut
    # FR-5.2 (M5): the requirement, and how many people could approve a campaign. Turning the
    # requirement on without a Security Manager is refused, because no campaign could run.
    requires_scope_approval: bool
    security_managers: int
    # This session's last password confirmation, and until when it allows changes (step 2).
    password_confirmed_at: datetime | None
    password_confirmed_until: datetime | None


class FirstStepTarget(BaseModel):
    id: uuid.UUID
    name: str


class FirstStepsOut(BaseModel):
    """Screen 07: which of the five first steps are done (UC-1.6 step 6, NFR-4.1)."""

    organization: str
    created_at: datetime
    created_by: str | None
    members: int
    open_invitations: int
    first_target: FirstStepTarget | None  # the first target registered (step 3)
    unverified_target: FirstStepTarget | None  # the target to verify next (step 4)
    verified_target: FirstStepTarget | None  # the target for the first campaign (step 5)
    campaign_run_finished: bool
    done: list[str]  # organization, team, target, verification, campaign_run


class MyInvitationOut(BaseModel):
    """An open invitation to the logged-in person's own address (no link: that is in the e-mail)."""

    organization: str
    role: str
    role_label: str
    invited_by: str | None
    expires_at: datetime
