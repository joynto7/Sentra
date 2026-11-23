"""Tests for FR-1.3 (M1) Single Sign-On: UC-1.7 steps 4-6 with 4a and 5a (connect the identity
provider) and UC-1.5 Log In with Single Sign-On with 2a, 5a and 5b.

The identity provider is a real one as far as Sentra can tell: it publishes a configuration
document and a JWKS, it checks the PKCE verifier, and it signs its ID tokens with an RSA key the
test generates. Nothing leaves the test — `sso.TRANSPORT` is replaced, the way the Target
Connector's network is in `tests/conftest.py`.
"""

import base64
import hashlib
import json
import socket
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.core import addresses
from app.core.audit import AuditLogEntry
from app.core.crypto import decrypt
from app.modules.m01_users import sso
from app.modules.m01_users.models import (
    AccountEvent,
    AccountEventKind,
    Membership,
    MembershipStatus,
    Role,
    SsoConnection,
    SsoLoginState,
    User,
)
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import organization_with

SECURITY = "/api/v1/organizations/current/security"
SSO = f"{SECURITY}/sso"
START = "/api/v1/auth/sso/start"
CALLBACK = "/api/v1/auth/sso/callback"

ISSUER = "https://login.example.com"
CLIENT_ID = "sentra-halcyon"
SECRET = "the-client-secret"
ADMIN = "tom@example.com"
MEMBER = "arif@example.com"
OUTSIDER = "nobody@example.com"

DETAILS = {
    "protocol": "oidc",
    "email_domain": "example.com",
    "issuer": ISSUER,
    "client_id": CLIENT_ID,
    "client_secret": SECRET,
}

# One key for the whole file: generating an RSA key is the slowest thing here by far.
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = "idp-2026"


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _jwk(key: rsa.RSAPrivateKey = KEY) -> dict:
    numbers = key.public_key().public_numbers()
    size = (numbers.n.bit_length() + 7) // 8
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": KID,
        "n": _b64u(numbers.n.to_bytes(size, "big")),
        "e": _b64u(numbers.e.to_bytes(3, "big")),
    }


class Idp:
    """A small OpenID Connect provider: the configuration, the keys and the token endpoint."""

    def __init__(self) -> None:
        self.reachable = True
        self.signing_key: rsa.RSAPrivateKey = KEY
        self.algorithms = ["RS256"]
        self.codes: dict[str, dict] = {}
        self.claims: dict = {}  # anything a test wants to put in or leave out of the ID token

    # -- what a browser would do at the provider's own login page
    def authorize(self, url: str) -> str:
        query = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        code = f"code-{len(self.codes) + 1}"
        self.codes[code] = query
        return code

    def _token(self, query: dict) -> str:
        now = datetime.now(UTC)
        claims = {
            "iss": ISSUER,
            "aud": query["client_id"],
            "sub": "idp-user-1",
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "nonce": query["nonce"],
            "email": query.get("login_hint", MEMBER),
            "email_verified": True,
        }
        claims.update(self.claims)
        return jwt.encode(
            {k: v for k, v in claims.items() if v is not None},
            self.signing_key,
            algorithm="RS256",
            headers={"kid": KID},
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        if not self.reachable:
            raise httpx.ConnectError("the provider is not reachable")
        url = str(request.url)
        if url == f"{ISSUER}{sso.DISCOVERY_PATH}":
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/jwks",
                    "id_token_signing_alg_values_supported": self.algorithms,
                },
            )
        if url == f"{ISSUER}/jwks":
            return httpx.Response(200, json={"keys": [_jwk()]})
        if url == f"{ISSUER}/token":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            asked = self.codes.get(form.get("code", ""))
            if asked is None or form.get("client_secret") != SECRET:
                return httpx.Response(400, json={"error": "invalid_grant"})
            # PKCE: the verifier must hash to the challenge of the authorization request.
            digest = hashlib.sha256(form.get("code_verifier", "").encode()).digest()
            if _b64u(digest) != asked.get("code_challenge"):
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(
                200, json={"token_type": "Bearer", "id_token": self._token(asked)}
            )
        return httpx.Response(404, json={"error": "not_found"})


def _resolve(host: str, port: int) -> list[str]:
    """The tests have no internet; only the provider's host name is known."""
    if host == "login.example.com":
        return ["93.184.215.14"]
    raise socket.gaierror(f"{host} not found")


@pytest.fixture
def idp(monkeypatch) -> Idp:
    provider = Idp()
    monkeypatch.setattr(sso, "TRANSPORT", httpx.MockTransport(provider.handle))
    monkeypatch.setattr(addresses, "resolve", _resolve)
    return provider


@pytest.fixture
def halcyon(client, db):
    """Halcyon Bank with its administrator Tom and the analyst Arif, Tom logged in."""
    organization_id = organization_with(db, client, {MEMBER: Role.SECURITY_ANALYST})
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    return organization_id


def connect(client, **changes) -> httpx.Response:
    return client.put(SSO, json={**DETAILS, **changes})


def log_in_with_sso(client, idp: Idp, email: str = MEMBER):
    """UC-1.5 steps 1-5 as a browser walks them: ask Sentra, let the provider answer, come back."""
    answer = client.post(START, json={"email": email})
    assert answer.status_code == 200, answer.text
    url = answer.json()["authorization_url"]
    assert url is not None, answer.json()
    code = idp.authorize(url)
    state = parse_qs(urlsplit(url).query)["state"][0]
    return client.get(CALLBACK, params={"code": code, "state": state}, follow_redirects=False)


# ---------------------------------------------------------------- UC-1.7 steps 4-6


def test_the_connection_is_tested_before_it_is_saved(halcyon, client, idp, db):
    """Step 5: the provider is asked for its configuration and its keys."""
    answer = client.post(f"{SSO}/test", json=DETAILS)

    assert answer.status_code == 200
    assert answer.json()["ok"] is True
    assert "1 signing key" in answer.json()["message"]
    assert db.scalar(select(SsoConnection)) is None, "a test saves nothing"


def test_a_connection_that_does_not_answer_is_not_saved(halcyon, client, idp, db):
    """5a: the test fails, Sentra says what to look at, and nothing is written."""
    idp.reachable = False

    test_answer = client.post(f"{SSO}/test", json=DETAILS)
    saved = connect(client)

    assert test_answer.json()["ok"] is False
    assert "could not reach" in test_answer.json()["message"]
    assert saved.status_code == 422
    assert db.scalar(select(SsoConnection)) is None


def test_a_provider_that_names_another_issuer_is_refused(halcyon, client, idp, db, monkeypatch):
    """A configuration document that belongs to a different provider than the one that was
    typed: believing it would let any reachable address claim this organization's domain."""

    def someone_else(request: httpx.Request) -> httpx.Response:
        answer = idp.handle(request)
        if str(request.url).endswith(sso.DISCOVERY_PATH):
            return httpx.Response(
                200, json=answer.json() | {"issuer": "https://someone-else.example.com"}
            )
        return answer

    monkeypatch.setattr(sso, "TRANSPORT", httpx.MockTransport(someone_else))

    answer = client.post(f"{SSO}/test", json=DETAILS)

    assert answer.json()["ok"] is False
    assert "different issuer" in answer.json()["message"]
    assert db.scalar(select(SsoConnection)) is None


def test_the_client_secret_is_stored_encrypted_and_never_given_back(halcyon, client, idp, db):
    """Quality requirement 4."""
    answer = connect(client)

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["connected"] is True and body["client_id"] == CLIENT_ID
    assert "client_secret" not in body and SECRET not in json.dumps(body)
    row = db.scalar(select(SsoConnection))
    assert row.client_secret != SECRET
    assert decrypt(row.client_secret, f"sso-client-secret:{row.organization_id}") == SECRET


def test_screen_11_names_the_address_the_provider_answers_to(halcyon, client, idp):
    """The administrator copies it into the identity provider (UC-1.7 step 4)."""
    answer = client.get(SECURITY).json()

    assert answer["sso"]["connected"] is False
    assert answer["sso"]["redirect_uri"].endswith("/v1/auth/sso/callback")


def test_only_an_organization_administrator_connects_a_provider(halcyon, client, idp, db):
    """Quality requirement 6, checked on the server (FR-1.6)."""
    log_in(client, MEMBER)
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    assert connect(client).status_code == 403
    assert client.post(f"{SSO}/test", json=DETAILS).status_code == 403
    assert db.scalar(select(SsoConnection)) is None


def test_connecting_asks_for_the_password_again(client, db, idp):
    """Step 2 and quality requirement 2 (NFR-3.5): without a recent confirmation, no change."""
    organization_with(db, client, {MEMBER: Role.SECURITY_ANALYST})  # no confirm-password

    assert connect(client).status_code == 403
    assert db.scalar(select(SsoConnection)) is None


def test_one_e_mail_domain_belongs_to_one_organization(halcyon, client, idp, db):
    """Step 2 of UC-1.5 identifies the organization by the domain, so two claims cannot stand."""
    assert connect(client).status_code == 200
    new_user(db, "lea@other.example")
    log_in(client, "lea@other.example")
    client.post("/api/v1/organizations", json={"name": "Fjord Analytics"})
    client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    answer = connect(client)

    assert answer.status_code == 422
    assert "already connected" in json.dumps(answer.json())


def test_the_issuer_may_not_point_into_sentras_own_network(halcyon, client, idp, db):
    """NFR-3.4: the administrator types this address and Sentra calls it."""
    answer = connect(client, issuer="https://169.254.169.254")

    assert answer.status_code == 422
    assert "Private network" in json.dumps(answer.json())
    assert db.scalar(select(SsoConnection)) is None


def test_connecting_and_disconnecting_are_in_the_audit_log(halcyon, client, idp, db):
    assert connect(client).status_code == 200
    assert client.delete(SSO).json()["connected"] is False

    actions = list(db.scalars(select(AuditLogEntry.action)))
    assert "organization.sso_connected" in actions
    assert "organization.sso_disconnected" in actions
    assert db.scalar(select(SsoConnection)) is None


# ---------------------------------------------------------------- UC-1.5


def test_a_member_logs_in_through_the_provider(halcyon, client, idp, db):
    """Steps 1-6 end to end: the session is Sentra's own and the workspace opens."""
    assert connect(client).status_code == 200
    client.cookies.clear()

    answer = log_in_with_sso(client, idp)

    assert answer.status_code == 303
    assert answer.headers["location"].endswith("/dashboard")
    assert client.get("/api/v1/auth/me").json()["email"] == MEMBER
    kinds = list(db.scalars(select(AccountEvent.kind)))
    assert AccountEventKind.LOGGED_IN_SSO in kinds


def test_no_provider_for_the_domain_goes_back_to_the_password_form(client, db, idp):
    """2a."""
    answer = client.post(START, json={"email": "someone@nothing.example"})

    assert answer.status_code == 200
    assert answer.json()["authorization_url"] is None
    assert "password" in answer.json()["message"]


def test_a_login_can_only_be_answered_once(halcyon, client, idp, db):
    """The state is used once, so a code that is caught and replayed is worth nothing."""
    assert connect(client).status_code == 200
    client.cookies.clear()
    answer = client.post(START, json={"email": MEMBER})
    url = answer.json()["authorization_url"]
    code = idp.authorize(url)
    state = parse_qs(urlsplit(url).query)["state"][0]

    first = client.get(CALLBACK, params={"code": code, "state": state}, follow_redirects=False)
    client.cookies.clear()
    again = client.get(CALLBACK, params={"code": code, "state": state}, follow_redirects=False)

    assert first.headers["location"].endswith("/dashboard")
    assert again.headers["location"].endswith("/login?sso=failed")


def test_a_login_that_took_too_long_is_refused(halcyon, client, idp, db):
    """5a: the state has expired."""
    assert connect(client).status_code == 200
    client.cookies.clear()
    answer = client.post(START, json={"email": MEMBER})
    url = answer.json()["authorization_url"]
    code = idp.authorize(url)
    state = parse_qs(urlsplit(url).query)["state"][0]
    row = db.scalar(select(SsoLoginState).where(SsoLoginState.state == state))
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    back = client.get(CALLBACK, params={"code": code, "state": state}, follow_redirects=False)

    assert back.headers["location"].endswith("/login?sso=expired")


def test_an_answer_to_a_login_sentra_did_not_start_is_refused(halcyon, client, idp):
    """Quality requirement 5: without a state of Sentra's own there is nothing to believe."""
    assert connect(client).status_code == 200
    client.cookies.clear()

    back = client.get(
        CALLBACK, params={"code": "made-up", "state": "made-up"}, follow_redirects=False
    )

    assert back.headers["location"].endswith("/login?sso=failed")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_a_token_signed_by_somebody_else_is_refused(halcyon, client, idp, db):
    """Quality requirement 5: only signed responses from the configured provider are accepted."""
    assert connect(client).status_code == 200
    client.cookies.clear()
    idp.signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    back = log_in_with_sso(client, idp)

    assert back.headers["location"].endswith("/login?sso=failed")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_a_token_minted_for_another_login_is_refused(halcyon, client, idp, db):
    """The nonce belongs to one login; a token from another one cannot be used here."""
    assert connect(client).status_code == 200
    client.cookies.clear()
    idp.claims = {"nonce": "a-nonce-of-another-login"}

    back = log_in_with_sso(client, idp)

    assert back.headers["location"].endswith("/login?sso=failed")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_the_provider_cannot_answer_about_another_address(halcyon, client, idp, db):
    """The login was started for one person; an answer about another is not that login."""
    assert connect(client).status_code == 200
    client.cookies.clear()
    idp.claims = {"email": ADMIN}

    back = log_in_with_sso(client, idp, email=MEMBER)

    assert back.headers["location"].endswith("/login?sso=failed")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_somebody_who_is_not_a_member_is_told_to_ask_for_an_invitation(halcyon, client, idp, db):
    """5b and 5b1."""
    assert connect(client).status_code == 200
    new_user(db, OUTSIDER)
    db.commit()
    client.cookies.clear()

    back = log_in_with_sso(client, idp, email=OUTSIDER)

    assert back.headers["location"].endswith("/login?sso=not_a_member")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_a_suspended_member_cannot_come_in(halcyon, client, idp, db):
    """5b: the membership, not the company account, is what Sentra goes by. A suspension
    (UC-10.2) closes this door the same way it closes the password one."""
    assert connect(client).status_code == 200
    membership = db.scalar(
        select(Membership).join(User, User.id == Membership.user_id).where(User.email == MEMBER)
    )
    membership.status = MembershipStatus.SUSPENDED
    db.commit()
    client.cookies.clear()

    back = log_in_with_sso(client, idp)

    assert back.headers["location"].endswith("/login?sso=not_a_member")


def test_the_organizations_two_step_requirement_still_applies(halcyon, client, idp, db):
    """Quality requirement 6: a session from single sign-on follows the same rules as one from a
    password, so the organization's own requirement is not skipped by it."""
    assert connect(client).status_code == 200
    assert client.put(SECURITY, json={"mfa_required": True}).status_code == 200
    client.cookies.clear()

    back = log_in_with_sso(client, idp)

    assert back.headers["location"].endswith("/login/two-step/setup")
    assert client.get("/api/v1/auth/me").status_code == 401, "the workspace waits for the setup"


def test_a_login_leaves_no_state_behind_when_single_sign_on_is_switched_off(
    halcyon, client, idp, db
):
    assert connect(client).status_code == 200
    client.post(START, json={"email": MEMBER})
    assert db.scalar(select(SsoLoginState)) is not None

    assert client.delete(SSO).status_code == 200

    assert db.scalar(select(SsoLoginState)) is None


def test_the_state_the_provider_is_given_is_unguessable(halcyon, client, idp, db):
    """Steps 2-5 hold together only because state, nonce and the PKCE verifier are random."""
    assert connect(client).status_code == 200
    seen: set[str] = set()
    for _ in range(3):
        url = client.post(START, json={"email": MEMBER}).json()["authorization_url"]
        query = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        assert query["code_challenge_method"] == "S256"
        assert query["redirect_uri"] == sso.redirect_uri()
        seen.update({query["state"], query["nonce"], query["code_challenge"]})

    assert len(seen) == 9, "every login gets its own state, nonce and challenge"
    rows = list(db.scalars(select(SsoLoginState.code_verifier)))
    assert len(set(rows)) == 3 and all(len(one) >= 43 for one in rows)
