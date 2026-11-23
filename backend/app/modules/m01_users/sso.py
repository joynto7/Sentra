"""Single sign-on (FR-1.3): connecting an organization's identity provider (UC-1.7 steps 4-5)
and logging in with it (UC-1.5).

**OpenID Connect.** FR-1.3 asks for "OpenID Connect or SAML 2.0", and this deployment speaks
OpenID Connect. The protocol is kept in a column, so a second one can be added later without a
migration, but nothing here hand-writes cryptography: the ID token's signature is checked by
PyJWT against the provider's own JWKS, and the rest of UC-1.5 step 5 — issuer, audience, validity
period — is PyJWT's work too. (SAML 2.0 would mean XML signature verification, which is not
something to hand-write in a security product.)

**What makes the answer trustworthy** (UC-1.5 step 5, quality requirement 5):

- the authorization code flow with PKCE, so a code caught in transit is useless without the
  verifier that only Sentra has;
- `state`, so the answer belongs to a login Sentra itself started;
- `nonce` inside the signed ID token, so a token minted for another login is refused;
- the signature, issuer, audience and validity period of the ID token;
- the address the person typed, compared with the address the provider answers with;
- and an existing, active membership of the organization that owns the e-mail domain (5b).

Sentra never creates an account here. A person who is not a member is told to ask for an
invitation (UC-1.8), which is the one way into an organization.
"""

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlsplit

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import addresses, crypto
from app.core.config import get_settings
from app.core.errors import AppError, FieldValidationError
from app.core.models import Organization
from app.modules.m01_users.models import (
    Membership,
    MembershipStatus,
    SsoConnection,
    SsoLoginState,
    SsoProtocol,
    User,
    UserStatus,
)

# UC-1.5 steps 2-5: how long a login may be away at the identity provider.
STATE_VALID_FOR = timedelta(minutes=10)
# Only signatures Sentra can check, and only asymmetric ones: with a shared-secret algorithm the
# client secret would be the signing key, and anyone holding it could mint tokens.
ALGORITHMS = ("RS256", "RS384", "RS512", "ES256", "ES384", "PS256", "PS384", "PS512")
SCOPE = "openid email profile"
TIMEOUT = httpx.Timeout(10.0)
DISCOVERY_PATH = "/.well-known/openid-configuration"
# The tests replace this with an identity provider of their own, the way the Target Connector's
# network is replaced (tests/conftest.py).
TRANSPORT: httpx.BaseTransport | None = None

# What the person sees. A failed single sign-on says what went wrong but never why in detail: the
# detail is for the administrator, in the connection test.
FAILED = "Single sign-on didn't work. Try again, or log in with your password."
EXPIRED = "That login took too long. Start again."
NO_PROVIDER = "No identity provider is connected for that e-mail domain. Log in with your password."
NOT_A_MEMBER = (
    "Your company account was accepted, but you are not a member of this organization in Sentra. "
    "Ask an Organization Administrator to invite you."
)


class SsoError(AppError):
    """A login through the identity provider that cannot go on. `reason` is the short code the
    login page turns into a sentence (the message itself never travels in a URL)."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message, code="sso_failed", status_code=401)
        self.reason = reason


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- the connection (UC-1.7)


def redirect_uri() -> str:
    """The one address the identity provider may send its answer to. It is Sentra's own API,
    not the web app: the session cookie is set here, in the answer to this request."""
    return f"{get_settings().api_url}/v1/auth/sso/callback"


def connection_of(db: Session, organization_id: uuid.UUID) -> SsoConnection | None:
    return db.scalar(select(SsoConnection).where(SsoConnection.organization_id == organization_id))


def _domain(value: str) -> str:
    """The e-mail domain as it is stored and compared: lower case, without a leading @."""
    domain = value.strip().lower().lstrip("@")
    if not domain or "." not in domain or "@" in domain or " " in domain:
        raise FieldValidationError(
            "email_domain", "Enter the e-mail domain of your organization, such as example.com."
        )
    return domain


def _issuer(value: str) -> str:
    """The issuer, as OpenID Connect writes it: an https address without a query or fragment."""
    issuer = value.strip().rstrip("/")
    parts = urlsplit(issuer)
    if parts.scheme != "https" or not parts.hostname or parts.query or parts.fragment:
        raise FieldValidationError(
            "issuer", "Enter the issuer URL of your identity provider, starting with https://."
        )
    try:
        # NFR-3.4: the administrator types this address and Sentra calls it, so it may not point
        # into Sentra's own network. app/core/addresses.py is the same check targets get.
        addresses.check_url(issuer, allow_private=get_settings().allow_private_targets)
    except addresses.AddressNotAllowed as exc:
        raise FieldValidationError("issuer", str(exc)) from exc
    return issuer


def _free_domain(db: Session, domain: str, organization_id: uuid.UUID) -> None:
    """One domain belongs to one organization: step 2 of UC-1.5 identifies the organization by
    it, and two claims on the same domain would make that step ambiguous."""
    taken = db.scalar(
        select(SsoConnection).where(
            SsoConnection.email_domain == domain,
            SsoConnection.organization_id != organization_id,
        )
    )
    if taken is not None:
        raise FieldValidationError(
            "email_domain", "Another organization has already connected this e-mail domain."
        )


@dataclass(frozen=True)
class Details:
    """What an administrator types on Screen 11 (UC-1.7 step 4)."""

    email_domain: str
    issuer: str
    client_id: str
    client_secret: str
    protocol: str = SsoProtocol.OIDC


def _checked(db: Session, organization_id: uuid.UUID, details: Details) -> Details:
    if details.protocol != SsoProtocol.OIDC:
        raise FieldValidationError(
            "protocol", "This Sentra deployment connects identity providers over OpenID Connect."
        )
    domain = _domain(details.email_domain)
    _free_domain(db, domain, organization_id)
    if not details.client_id.strip():
        raise FieldValidationError("client_id", "Enter the client ID your provider gave Sentra.")
    if not details.client_secret.strip():
        raise FieldValidationError(
            "client_secret", "Enter the client secret your provider gave Sentra."
        )
    return Details(
        email_domain=domain,
        issuer=_issuer(details.issuer),
        client_id=details.client_id.strip(),
        client_secret=details.client_secret.strip(),
        protocol=SsoProtocol.OIDC,
    )


class ConnectionFailed(Exception):
    """UC-1.7, 5a: the connection test failed. The message is meant for the administrator, and
    says what to look at."""


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, transport=TRANSPORT)


def _get(url: str) -> dict:
    with _client() as client:
        answer = client.get(url, headers={"Accept": "application/json"})
    if answer.status_code != 200:
        raise ConnectionFailed(f"{url} answered {answer.status_code}.")
    try:
        found = answer.json()
    except ValueError as exc:
        raise ConnectionFailed(f"{url} did not answer with JSON.") from exc
    if not isinstance(found, dict):
        raise ConnectionFailed(f"{url} did not answer with an object.")
    return found


def discover(issuer: str) -> dict:
    """The provider's own description of itself. Its `issuer` must be the one that was
    configured: a document that names another issuer belongs to another provider."""
    try:
        document = _get(issuer + DISCOVERY_PATH)
    except httpx.HTTPError as exc:
        raise ConnectionFailed(
            f"Sentra could not reach {issuer}{DISCOVERY_PATH} ({type(exc).__name__})."
        ) from exc
    if document.get("issuer", "").rstrip("/") != issuer:
        raise ConnectionFailed(
            "The provider's configuration names a different issuer than the one you entered."
        )
    for field in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        value = document.get(field)
        if not isinstance(value, str) or not value:
            raise ConnectionFailed(f"The provider's configuration has no {field}.")
        if not value.startswith("https://"):
            raise ConnectionFailed(f"The provider's {field} is not an https address.")
    return document


def keys(document: dict) -> list[dict]:
    try:
        found = _get(document["jwks_uri"]).get("keys")
    except httpx.HTTPError as exc:
        raise ConnectionFailed(
            f"Sentra could not reach the provider's keys ({type(exc).__name__})."
        ) from exc
    if not isinstance(found, list) or not found:
        raise ConnectionFailed("The provider published no signing keys.")
    return found


def test(db: Session, organization_id: uuid.UUID, details: Details) -> str:
    """UC-1.7 step 5: ask the provider for its configuration and its signing keys, before
    anything is saved. Raises ConnectionFailed with what to look at (5a)."""
    checked = _checked(db, organization_id, details)
    document = discover(checked.issuer)
    found = keys(document)
    algorithms = document.get("id_token_signing_alg_values_supported") or ["RS256"]
    if not any(algorithm in ALGORITHMS for algorithm in algorithms):
        raise ConnectionFailed(
            "The provider signs its tokens with an algorithm Sentra does not accept "
            f"({', '.join(str(one) for one in algorithms)})."
        )
    return (
        f"The provider answered. {len(found)} signing "
        f"{'key' if len(found) == 1 else 'keys'} and the endpoints Sentra needs are in place."
    )


def save(db: Session, organization: Organization, admin: User, details: Details) -> SsoConnection:
    """UC-1.7 steps 5-6: the connection is tested first and saved only if the test succeeded
    (5a). The client secret is stored encrypted and never given back (quality requirement 4)."""
    checked = _checked(db, organization.id, details)
    test(db, organization.id, checked)  # 5a: a failure raises and nothing is written

    connection = connection_of(db, organization.id)
    if connection is None:
        connection = SsoConnection(organization_id=organization.id)
        db.add(connection)
    connection.protocol = checked.protocol
    connection.email_domain = checked.email_domain
    connection.issuer = checked.issuer
    connection.client_id = checked.client_id
    connection.client_secret = crypto.encrypt(
        checked.client_secret, f"sso-client-secret:{organization.id}"
    )
    connection.tested_at = _now()
    connection.updated_by_id = admin.id
    db.flush()
    return connection


def disconnect(db: Session, organization_id: uuid.UUID) -> bool:
    """Single sign-on is switched off: the connection and any login still on its way are gone.
    Nobody loses their account — everybody logs in with their password again."""
    connection = connection_of(db, organization_id)
    if connection is None:
        return False
    db.execute(
        SsoLoginState.__table__.delete().where(SsoLoginState.organization_id == organization_id)
    )
    db.delete(connection)
    db.flush()
    return True


# ---------------------------------------------------------------- the login (UC-1.5)


def connection_for_email(db: Session, email: str) -> SsoConnection | None:
    """Step 2: the organization behind the e-mail domain, if one has connected a provider. No
    provider means 2a — the normal login form."""
    _, _, domain = email.strip().lower().partition("@")
    if not domain:
        return None
    return db.scalar(select(SsoConnection).where(SsoConnection.email_domain == domain))


def _random() -> str:
    return secrets.token_urlsafe(32)[:43]


def start(db: Session, email: str) -> str | None:
    """Steps 1-2: the address the provider is to be asked about, or None when no provider is
    connected for the domain (2a). The caller commits."""
    connection = connection_for_email(db, email)
    if connection is None:
        return None
    document = discover(connection.issuer)

    verifier = _random()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    row = SsoLoginState(
        organization_id=connection.organization_id,
        state=_random(),
        nonce=_random(),
        code_verifier=verifier,
        email=email.strip().lower(),
        expires_at=_now() + STATE_VALID_FOR,
    )
    db.add(row)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": connection.client_id,
            "redirect_uri": redirect_uri(),
            "scope": SCOPE,
            "state": row.state,
            "nonce": row.nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            # The provider shows its own login page; Sentra never sees the company password.
            "login_hint": row.email,
        }
    )
    separator = "&" if "?" in document["authorization_endpoint"] else "?"
    return f"{document['authorization_endpoint']}{separator}{query}"


def _state_row(db: Session, state: str) -> SsoLoginState:
    row = db.scalar(select(SsoLoginState).where(SsoLoginState.state == state))
    if row is None or row.used_at is not None:
        raise SsoError(FAILED, "failed")
    if row.expires_at <= _now():
        raise SsoError(EXPIRED, "expired")
    row.used_at = _now()  # once, whatever happens next
    return row


def _tokens(connection: SsoConnection, document: dict, code: str, verifier: str) -> dict:
    secret = crypto.decrypt(
        connection.client_secret, f"sso-client-secret:{connection.organization_id}"
    )
    try:
        with _client() as client:
            answer = client.post(
                document["token_endpoint"],
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri(),
                    "client_id": connection.client_id,
                    "client_secret": secret,
                    "code_verifier": verifier,
                },
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise SsoError(FAILED, "failed") from exc
    if answer.status_code != 200:
        raise SsoError(FAILED, "failed")
    try:
        found = answer.json()
    except ValueError as exc:
        raise SsoError(FAILED, "failed") from exc
    if not isinstance(found, dict) or not isinstance(found.get("id_token"), str):
        raise SsoError(FAILED, "failed")
    return found


def _claims(connection: SsoConnection, document: dict, id_token: str, nonce: str) -> dict:
    """Step 5: the signature, the issuer, the audience and the validity period, all checked by
    PyJWT against the provider's published keys, and then the nonce of this very login."""
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        raise SsoError(FAILED, "failed") from exc
    algorithm = header.get("alg")
    if algorithm not in ALGORITHMS:
        raise SsoError(FAILED, "failed")

    for key in keys(document):
        if header.get("kid") and key.get("kid") and key["kid"] != header["kid"]:
            continue
        try:
            public_key = jwt.PyJWK.from_dict(key, algorithm=algorithm).key
            claims = jwt.decode(
                id_token,
                public_key,
                algorithms=[algorithm],
                audience=connection.client_id,
                issuer=connection.issuer,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except (jwt.PyJWTError, jwt.exceptions.InvalidKeyError, ValueError, KeyError):
            continue
        if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
            raise SsoError(FAILED, "failed")
        return claims
    raise SsoError(FAILED, "failed")


def finish(db: Session, code: str, state: str) -> tuple[User, SsoConnection, str]:
    """Steps 4-5: the provider's answer, checked. Returns the member it belongs to, the
    connection it came through, and the address the provider named."""
    row = _state_row(db, state)
    connection = connection_of(db, row.organization_id)
    if connection is None:  # switched off while this login was away
        raise SsoError(FAILED, "failed")

    try:
        document = discover(connection.issuer)
    except ConnectionFailed as exc:
        raise SsoError(FAILED, "failed") from exc
    tokens = _tokens(connection, document, code, row.code_verifier)
    try:
        claims = _claims(connection, document, tokens["id_token"], row.nonce)
    except ConnectionFailed as exc:
        raise SsoError(FAILED, "failed") from exc

    email = str(claims.get("email", "")).strip().lower()
    if not email or email != row.email:
        # The provider answered about somebody other than the person who started this login.
        raise SsoError(FAILED, "failed")
    if claims.get("email_verified") is False:
        raise SsoError(FAILED, "failed")

    user = db.scalar(select(User).where(User.email == email))
    member = None
    if user is not None:
        member = db.scalar(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.organization_id == connection.organization_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
    if user is None or member is None:  # 5b
        raise SsoError(NOT_A_MEMBER, "not_a_member")
    if user.status != UserStatus.ACTIVE:
        raise SsoError(FAILED, "failed")
    return user, connection, email
