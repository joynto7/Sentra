"""Tests for FR-1.1: registration, e-mail verification, login, logout and password reset."""

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.email import outbox
from app.modules.m01_users.models import LoginThrottle, OneTimeToken, User, UserSession
from app.modules.m01_users.security import hash_token

EMAIL = "arif.hossain@halcyonbank.com"
PASSWORD = "Copper-Kettle-Morning-42"


def register(client, email=EMAIL, password=PASSWORD, accept_terms=True):
    return client.post(
        "/api/v1/auth/register",
        json={
            "name": "Arif Hossain",
            "email": email,
            "password": password,
            "accept_terms": accept_terms,
        },
    )


def token_from_last_email() -> str:
    match = re.search(r"token=([\w-]+)", outbox[-1].get_content())
    assert match, "the e-mail contains no link"
    return match.group(1)


def register_and_verify(client):
    register(client)
    client.post("/api/v1/auth/verify-email", json={"token": token_from_last_email()})


def login(client, password=PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": EMAIL, "password": password})


# ---------------------------------------------------------------- registration (UC-1.1)


def test_register_creates_unverified_account_and_sends_link(client, db):
    response = register(client)

    assert response.status_code == 202
    user = db.scalar(select(User).where(User.email == EMAIL))
    assert user.status == "unverified"
    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    assert outbox[-1]["To"] == EMAIL
    assert "/verify-email?token=" in outbox[-1].get_content()


def test_register_requires_terms(client):
    response = register(client, accept_terms=False)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "accept_terms"


def test_register_rejects_weak_passwords(client):
    for weak in ["short-pass", "password1234", "arif.hossain-2026!"]:
        response = register(client, password=weak)
        assert response.status_code == 422, weak
        assert response.json()["error"]["details"][0]["field"] == "password"


def test_register_existing_address_gives_same_answer(client):
    register_and_verify(client)

    response = register(client)

    assert response.status_code == 202
    assert response.json() == register(client, email="new.person@halcyonbank.com").json()
    assert "already have one" in outbox[-2].get_content()


def test_verification_link_works_once(client):
    register(client)
    token = token_from_last_email()

    first = client.post("/api/v1/auth/verify-email", json={"token": token})
    second = client.post("/api/v1/auth/verify-email", json={"token": token})

    assert first.status_code == 200
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "link_invalid"


def test_expired_verification_link_is_rejected(client, db):
    register(client)
    token = token_from_last_email()
    db.execute(
        OneTimeToken.__table__.update().values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )

    response = client.post("/api/v1/auth/verify-email", json={"token": token})

    assert response.json()["error"]["code"] == "link_invalid"


# ---------------------------------------------------------------- login (UC-1.2)


def test_login_sets_http_only_session_cookie(client):
    register_and_verify(client)

    response = login(client)

    assert response.status_code == 200
    assert response.json()["email"] == EMAIL
    cookie = response.headers["set-cookie"]
    assert "sentra_session=" in cookie
    assert "HttpOnly" in cookie
    assert client.get("/api/v1/auth/me").json()["name"] == "Arif Hossain"


def test_session_token_is_stored_only_as_hash(client, db):
    register_and_verify(client)
    raw = login(client).cookies["sentra_session"]

    stored = db.scalar(select(UserSession.token_hash))

    assert stored != raw
    assert len(raw) >= 32  # at least 128 bits of randomness (NFR-3.5)


def test_wrong_password_and_unknown_email_give_same_error(client):
    register_and_verify(client)

    wrong_password = login(client, password="Not-The-Right-One-99")
    unknown = client.post(
        "/api/v1/auth/login", json={"email": "nobody@halcyonbank.com", "password": PASSWORD}
    )

    assert wrong_password.status_code == unknown.status_code == 401
    assert wrong_password.json() == unknown.json()
    assert unknown.json()["error"]["message"] == "The e-mail address or password is incorrect."


def test_unverified_account_cannot_log_in(client):
    register(client)

    response = login(client)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "email_not_verified"


def test_repeated_failures_lock_the_account_for_a_while(client):
    register_and_verify(client)
    for _ in range(5):
        login(client, password="Not-The-Right-One-99")

    response = login(client)  # even the right password is refused for now

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_attempts"


def test_a_lock_looks_the_same_for_an_address_without_an_account(client):
    """FR-1.1: even the lock after repeated failures doesn't tell which addresses have accounts."""
    register_and_verify(client)
    answers = {}
    for email in (EMAIL, "nobody@halcyonbank.com"):
        for _ in range(5):
            client.post("/api/v1/auth/login", json={"email": email, "password": "Wrong-Guess-1"})
        answers[email] = client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        )

    known, unknown = answers.values()
    assert known.status_code == unknown.status_code == 429
    assert known.json() == unknown.json()


def test_only_a_hash_of_a_typed_address_is_kept(client, db):
    client.post("/api/v1/auth/login", json={"email": "Nobody@HalcyonBank.com", "password": "x"})

    stored = db.scalar(select(LoginThrottle.email_hash))

    assert stored == hash_token("nobody@halcyonbank.com") and "@" not in stored


def test_idle_session_expires(client, db):
    register_and_verify(client)
    login(client)
    db.execute(
        UserSession.__table__.update().values(
            last_seen_at=datetime.now(UTC) - timedelta(minutes=31)
        )
    )

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_logout_ends_the_session(client):
    register_and_verify(client)
    login(client)

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_requires_login(client):
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


# ---------------------------------------------------------------- password reset (UC-1.3)


def test_password_reset_changes_password_and_ends_sessions(client, db):
    register_and_verify(client)
    login(client)
    client.post("/api/v1/auth/forgot-password", json={"email": EMAIL})
    token = token_from_last_email()
    new_password = "Silver-Harbor-Evening-77"

    response = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": new_password}
    )

    assert response.status_code == 200
    assert db.scalar(select(UserSession)) is None
    assert client.get("/api/v1/auth/me").status_code == 401
    assert login(client).status_code == 401
    assert login(client, password=new_password).status_code == 200
    assert "was just changed" in outbox[-1].get_content()


def test_forgot_password_does_not_reveal_unknown_addresses(client):
    register_and_verify(client)
    sent_before = len(outbox)

    known = client.post("/api/v1/auth/forgot-password", json={"email": EMAIL})
    unknown = client.post("/api/v1/auth/forgot-password", json={"email": "x@halcyonbank.com"})

    assert known.json() == unknown.json()
    assert len(outbox) == sent_before + 1


def test_reset_link_works_once(client):
    register_and_verify(client)
    client.post("/api/v1/auth/forgot-password", json={"email": EMAIL})
    token = token_from_last_email()
    body = {"token": token, "new_password": "Silver-Harbor-Evening-77"}

    assert client.post("/api/v1/auth/reset-password", json=body).status_code == 200
    second = client.post("/api/v1/auth/reset-password", json=body)

    assert second.json()["error"]["code"] == "link_invalid"


def test_password_policy_endpoint_lists_the_rules(client):
    labels = [rule["label"] for rule in client.get("/api/v1/auth/password-policy").json()]

    assert labels == [
        "At least 12 characters",
        "Not a commonly used or breached password",
        "Doesn't contain your e-mail address",
    ]
