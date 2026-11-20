"""Tests for FR-1.2 (M1) Multi-Factor Authentication: UC-1.4 Enable Multi-Factor Authentication,
the second step of UC-1.2 Log In, UC-1.3 (a reset keeps it) and UC-1.7 Configure Organization
Security."""

import base64
import re
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.crypto import CryptoError, decrypt
from app.core.email import outbox
from app.main import app
from app.modules.m01_users import totp
from app.modules.m01_users.models import (
    AccountEvent,
    OneTimeToken,
    RecoveryCode,
    Role,
    TokenPurpose,
    User,
    UserSession,
)
from app.modules.m09_reporting.models import Notification
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import organization_with

EMAIL = "arif@example.com"
ACCOUNT = "/api/v1/account/mfa"
SECOND_STEP = "/api/v1/auth/login/mfa"
SECURITY = "/api/v1/organizations/current/security"
WRONG_CODE = "That code is incorrect or has expired. Enter the newest code from your app."


@pytest.fixture
def clock(monkeypatch):
    """The 30-second time step the server sees; a test moves it on with clock["step"] += 1."""
    now = {"step": totp.current_step()}
    monkeypatch.setattr(totp, "current_step", lambda at=None: now["step"])
    return now


@pytest.fixture
def arif(client, db):
    new_user(db, EMAIL)
    return log_in(client, EMAIL)


def user(db, email: str = EMAIL) -> User:
    return db.scalar(select(User).where(User.email == email))


def code(secret: str, clock: dict) -> str:
    """What the authenticator app shows right now."""
    return totp.code_for(secret, clock["step"])


def turn_on(client: TestClient, clock: dict) -> tuple[str, list[str]]:
    """UC-1.4 from the profile; returns the secret (the app's copy) and the recovery codes."""
    secret = client.post(f"{ACCOUNT}/setup", json={"password": PASSWORD}).json()["secret"]
    response = client.post(f"{ACCOUNT}/enable", json={"code": code(secret, clock)})
    assert response.status_code == 200
    clock["step"] += 1  # the next code
    return secret, response.json()["recovery_codes"]


def first_step(email: str = EMAIL) -> TestClient:
    """A new browser that entered the right password."""
    browser = TestClient(app)
    response = browser.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return browser


def locked_out() -> bool:
    """Whether even the right password is refused for now."""
    response = TestClient(app).post(
        "/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}
    )
    return response.json()["error"]["code"] == "too_many_attempts"


def details(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def kinds(db, email: str = EMAIL) -> list[str]:
    """The account's recent activity (UC-1.11 step 6), oldest first."""
    return list(
        db.scalars(
            select(AccountEvent.kind)
            .where(AccountEvent.user_id == user(db, email).id)
            .order_by(AccountEvent.created_at)
        )
    )


# ---------------------------------------------------------------- the codes (RFC 6238)


def test_codes_match_the_test_values_of_rfc_6238():
    # Appendix B of RFC 6238: the secret "12345678901234567890" with SHA-1. The RFC lists
    # 8 digits; an app shows the last 6.
    secret = base64.b32encode(b"12345678901234567890").decode()
    expected = {
        59: "287082",
        1111111109: "081804",
        1111111111: "050471",
        1234567890: "005924",
        2000000000: "279037",
        20000000000: "353130",
    }

    for seconds, value in expected.items():
        assert totp.code_for(secret, totp.current_step(seconds)) == value


def test_codes_of_the_next_and_previous_step_count_but_no_older_ones():
    secret = totp.new_secret()
    now = 1_800_000_000

    def step_of(offset: int) -> int | None:
        entered = totp.code_for(secret, totp.current_step(now) + offset)
        return totp.matching_step(secret, entered, at=now)

    assert step_of(0) == totp.current_step(now)
    assert step_of(-1) is not None and step_of(1) is not None  # a phone clock a little off
    assert step_of(-2) is None and step_of(2) is None
    assert totp.matching_step(secret, "12 34", at=now) is None


def test_a_step_that_was_used_is_refused():
    secret = totp.new_secret()
    now = 1_800_000_000
    entered = totp.code_for(secret, totp.current_step(now))

    assert totp.matching_step(secret, entered, used_up_to=totp.current_step(now), at=now) is None


def test_the_qr_code_holds_the_key_uri_for_authenticator_apps():
    secret = totp.new_secret()
    uri = totp.setup_uri(secret, "arif@example.com")

    assert len(secret) == 32 and re.fullmatch(r"[A-Z2-7]+", secret)
    assert uri.startswith("otpauth://totp/Sentra%3Aarif%40example.com?")
    assert f"secret={secret}" in uri and "issuer=Sentra" in uri and "digits=6" in uri
    assert totp.qr_code(uri).startswith("data:image/svg+xml")


# ---------------------------------------------------------------- turning it on (UC-1.4)


def test_setup_needs_the_password_and_shows_the_secret_once(arif, db):
    wrong = arif.post(f"{ACCOUNT}/setup", json={"password": "Not-The-Right-One-99"})

    assert details(wrong) == {"password": "The password is incorrect."}  # 2a

    setup = arif.post(f"{ACCOUNT}/setup", json={"password": PASSWORD}).json()

    assert setup["uri"].startswith("otpauth://totp/Sentra%3Aarif%40example.com")
    assert setup["qr_code"].startswith("data:image/svg+xml")
    stored = user(db).mfa_pending_secret
    assert stored.startswith("v1:") and setup["secret"] not in stored  # encrypted (quality req. 3)
    assert arif.get(ACCOUNT).json()["enabled"] is False  # only the first code turns it on


def test_the_first_code_turns_it_on_and_gives_ten_recovery_codes(arif, db, clock):
    secret = arif.post(f"{ACCOUNT}/setup", json={"password": PASSWORD}).json()["secret"]
    wrong = arif.post(f"{ACCOUNT}/enable", json={"code": "000000"})

    assert details(wrong) == {"code": "That code didn't match. Wait for a new code and try again."}

    response = arif.post(f"{ACCOUNT}/enable", json={"code": code(secret, clock)})

    codes = response.json()["recovery_codes"]
    assert len(set(codes)) == 10
    assert all(re.fullmatch(r"[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}", c) for c in codes)
    status = arif.get(ACCOUNT).json()
    assert (status["enabled"], status["recovery_codes_left"], status["recovery_codes_total"]) == (
        True,
        10,
        10,
    )
    # Hashed like passwords, never kept as text (quality requirement 6).
    hashes = db.scalars(select(RecoveryCode.code_hash)).all()
    assert all(h.startswith("$argon2id$") for h in hashes)
    assert not any(c.replace("-", "") in h for c in codes for h in hashes)
    # The secret moved from pending to in use, still encrypted for this user only.
    arif_user = user(db)
    assert arif_user.mfa_pending_secret is None
    assert decrypt(arif_user.mfa_secret, f"mfa-secret:{arif_user.id}") == secret
    with pytest.raises(CryptoError):
        decrypt(arif_user.mfa_secret, "mfa-secret:someone-else")
    # Step 7: confirmed by e-mail, in the application and in the recent activity.
    assert outbox[-1]["Subject"] == "Two-step verification is on for your Sentra account"
    assert db.scalar(select(Notification.text)).startswith("Two-step verification was turned on")
    assert kinds(db)[-1] == "mfa_enabled"


def test_it_cannot_be_set_up_twice(arif, clock):
    turn_on(arif, clock)

    again = arif.post(f"{ACCOUNT}/setup", json={"password": PASSWORD})

    assert again.json()["error"]["code"] == "mfa_already_on"


# ---------------------------------------------------------------- logging in (UC-1.2)


def test_the_session_starts_only_after_the_code(arif, db, clock):
    secret, _ = turn_on(arif, clock)
    browser = TestClient(app)

    response = browser.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})

    assert response.json() == {"step": "mfa", "email": EMAIL, "required_by": []}
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "sentra_session" not in browser.cookies
    assert browser.get("/api/v1/auth/me").status_code == 401
    assert browser.get(SECOND_STEP).json()["email"] == EMAIL  # for the page, after a reload

    done = browser.post(SECOND_STEP, json={"code": code(secret, clock)})

    assert done.json()["step"] == "done"
    assert browser.get("/api/v1/auth/me").json()["email"] == EMAIL
    assert "sentra_second_step" not in browser.cookies
    assert kinds(db)[-1] == "logged_in"


def test_a_wrong_code_is_refused_and_counts_as_a_failed_login(arif, db, clock):
    secret, _ = turn_on(arif, clock)
    browser = first_step()

    wrong = browser.post(SECOND_STEP, json={"code": "000000"})

    assert details(wrong) == {"code": WRONG_CODE}  # 4b: ask again
    assert kinds(db)[-1] == "mfa_failed"
    for _ in range(4):
        last = browser.post(SECOND_STEP, json={"code": "000000"})
    assert last.status_code == 429  # the fifth wrong code locks the account for a while
    # The login has ended: even the right code doesn't open a session now.
    assert browser.post(SECOND_STEP, json={"code": code(secret, clock)}).status_code == 401
    assert locked_out()


def test_entering_the_password_again_gives_no_extra_tries(arif, clock):
    turn_on(arif, clock)
    for _ in range(4):
        first_step().post(SECOND_STEP, json={"code": "000000"})

    response = first_step().post(SECOND_STEP, json={"code": "000000"})

    assert response.status_code == 429


def test_a_code_works_only_once(arif, clock):
    secret, _ = turn_on(arif, clock)
    used = code(secret, clock)
    assert first_step().post(SECOND_STEP, json={"code": used}).status_code == 200

    again = first_step().post(SECOND_STEP, json={"code": used})

    assert details(again) == {"code": WRONG_CODE}


def test_a_recovery_code_works_once_instead_of_the_app(arif, db, clock):
    _, codes = turn_on(arif, clock)
    browser = first_step()

    # 4a: typed in lower case and without the dash, as people do.
    response = browser.post(SECOND_STEP, json={"recovery_code": codes[0].lower().replace("-", "")})

    assert response.json()["step"] == "done"
    assert arif.get(ACCOUNT).json()["recovery_codes_left"] == 9
    assert outbox[-1]["Subject"] == "A recovery code was used to log in to Sentra"
    assert "9 recovery codes are left" in outbox[-1].get_content()
    assert "recovery_code_used" in kinds(db)
    again = first_step().post(SECOND_STEP, json={"recovery_code": codes[0]})
    assert details(again) == {
        "recovery_code": "That recovery code is incorrect or has already been used."
    }


def test_new_recovery_codes_replace_the_old_ones(arif, clock):
    _, old = turn_on(arif, clock)

    wrong = arif.post(f"{ACCOUNT}/recovery-codes", json={"password": "Not-The-Right-One-99"})
    new = arif.post(f"{ACCOUNT}/recovery-codes", json={"password": PASSWORD})

    assert details(wrong) == {"password": "The password is incorrect."}
    assert len(new.json()["recovery_codes"]) == 10
    assert outbox[-1]["Subject"] == "New Sentra recovery codes were generated"
    assert first_step().post(SECOND_STEP, json={"recovery_code": old[1]}).status_code == 422
    assert (
        first_step()
        .post(SECOND_STEP, json={"recovery_code": new.json()["recovery_codes"][0]})
        .status_code
        == 200
    )


def test_a_password_reset_keeps_two_step_verification(arif, clock):
    turn_on(arif, clock)
    arif.post("/api/v1/auth/forgot-password", json={"email": EMAIL})
    token = re.search(r"token=([\w-]+)", outbox[-1].get_content()).group(1)
    new_password = "Silver-Harbor-Evening-77"
    arif.post("/api/v1/auth/reset-password", json={"token": token, "new_password": new_password})

    response = TestClient(app).post(
        "/api/v1/auth/login", json={"email": EMAIL, "password": new_password}
    )

    assert response.json()["step"] == "mfa"  # UC-1.3 quality requirement 5


def test_the_second_step_can_be_cancelled_and_expires(arif, db, clock):
    turn_on(arif, clock)
    browser = first_step()
    raw = browser.cookies["sentra_second_step"]

    assert browser.delete(SECOND_STEP).status_code == 204  # "Back to login"
    # The token itself stopped working, not only the browser's cookie.
    copied = TestClient(app, cookies={"sentra_second_step": raw})
    assert copied.get(SECOND_STEP).json()["error"]["code"] == "login_expired"

    late = first_step()
    db.execute(
        OneTimeToken.__table__.update()
        .where(OneTimeToken.purpose == TokenPurpose.MFA_LOGIN)
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    assert late.get(SECOND_STEP).json()["error"] == {
        "code": "login_expired",
        "message": "Your login has expired. Log in again.",
    }


def test_the_second_step_needs_one_kind_of_code(arif, clock):
    turn_on(arif, clock)

    response = first_step().post(SECOND_STEP, json={})

    assert response.status_code == 422


# ---------------------------------------------------------------- the organization (UC-1.7)


@pytest.fixture
def tom(client, db):
    """Tom administers Halcyon Bank; Maya and Priya are members without two-step verification."""
    organization_with(
        db,
        client,
        {"maya@example.com": Role.TARGET_OWNER, "priya@example.com": Role.SECURITY_ANALYST},
    )
    return client


def require(client: TestClient, required: bool = True):
    return client.put(SECURITY, json={"mfa_required": required})


def test_changing_the_requirement_needs_the_password_again(tom, db):
    assert tom.get(SECURITY).json() == {
        "mfa_required": False,
        "members_without_mfa": 3,
        "password_confirmed_at": None,
        "password_confirmed_until": None,
    }
    assert require(tom).json()["error"]["code"] == "password_confirmation_required"
    wrong = tom.post("/api/v1/auth/confirm-password", json={"password": "Not-The-Right-One-99"})
    assert details(wrong) == {"password": "The password is incorrect."}

    assert tom.post("/api/v1/auth/confirm-password", json={"password": PASSWORD}).status_code == 204
    body = require(tom).json()

    assert body["mfa_required"] is True
    until = datetime.fromisoformat(body["password_confirmed_until"])
    assert timedelta(minutes=9) < until - datetime.now(UTC) <= timedelta(minutes=10)


def test_the_confirmation_lasts_ten_minutes(tom, db):
    tom.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    db.execute(
        UserSession.__table__.update().values(
            password_confirmed_at=datetime.now(UTC) - timedelta(minutes=11)
        )
    )

    assert require(tom).json()["error"]["code"] == "password_confirmation_required"


def test_members_without_it_are_told_and_asked_at_their_next_login(tom, db, clock):
    tom.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    outbox.clear()

    require(tom)

    told = sorted(m["To"] for m in outbox)
    assert told == ["maya@example.com", "priya@example.com", "tom@example.com"]
    assert outbox[0]["Subject"] == "Halcyon Bank requires two-step verification"
    maya = user(db, "maya@example.com")
    assert db.scalar(select(Notification.text).where(Notification.user_id == maya.id)).startswith(
        "Halcyon Bank now requires two-step verification"
    )

    # UC-1.2, 3b and UC-1.4, 1a: the next login sets it up, without asking the password again.
    browser = TestClient(app)
    response = browser.post(
        "/api/v1/auth/login", json={"email": "maya@example.com", "password": PASSWORD}
    )
    assert response.json() == {
        "step": "mfa_setup",
        "email": "maya@example.com",
        "required_by": ["Halcyon Bank"],
    }
    assert browser.get("/api/v1/auth/me").status_code == 401
    secret = browser.post(f"{SECOND_STEP}/setup").json()["secret"]
    wrong = browser.post(f"{SECOND_STEP}/enable", json={"code": "000000"})
    assert details(wrong) == {"code": "That code didn't match. Wait for a new code and try again."}

    done = browser.post(f"{SECOND_STEP}/enable", json={"code": code(secret, clock)})

    assert len(done.json()["recovery_codes"]) == 10
    assert browser.get("/api/v1/auth/me").json()["organization"]["name"] == "Halcyon Bank"
    clock["step"] += 1
    assert first_step("maya@example.com").get(SECOND_STEP).json()["step"] == "mfa"


def test_turning_it_off_tells_nobody(tom):
    tom.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    require(tom)
    outbox.clear()

    body = require(tom, False).json()

    assert body["mfa_required"] is False
    assert outbox == []  # 3a
    response = TestClient(app).post(
        "/api/v1/auth/login", json={"email": "maya@example.com", "password": PASSWORD}
    )
    assert response.json()["step"] == "done"


def test_only_the_organization_administrator_changes_it(tom):
    member = log_in(TestClient(app), "maya@example.com")
    member.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    assert member.get(SECURITY).status_code == 403
    assert require(member).status_code == 403


def test_the_members_page_shows_who_has_it_on(tom, clock):
    turn_on(tom, clock)

    members = tom.get("/api/v1/organizations/current/members").json()

    assert {m["email"]: m["mfa_enabled"] for m in members} == {
        "maya@example.com": False,
        "priya@example.com": False,
        "tom@example.com": True,
    }
    assert tom.get(SECURITY).json()["members_without_mfa"] == 2


def test_a_new_member_from_an_invitation_sets_it_up_first(tom, db, clock):
    tom.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    require(tom)
    tom.post(
        "/api/v1/organizations/current/invitations",
        json={"email": "omar@example.com", "role": "security_analyst"},
    )
    token = re.search(r"token=([\w-]+)", outbox[-1].get_content()).group(1)
    browser = TestClient(app)

    response = browser.post(
        "/api/v1/invitations/register",
        json={"token": token, "name": "Omar", "password": PASSWORD, "accept_terms": True},
    )

    assert response.json()["step"] == "mfa_setup"
    assert response.json()["organization"]["name"] == "Halcyon Bank"
    assert browser.get("/api/v1/auth/me").status_code == 401  # no session before the setup
    secret = browser.post(f"{SECOND_STEP}/setup").json()["secret"]
    browser.post(f"{SECOND_STEP}/enable", json={"code": code(secret, clock)})
    assert browser.get("/api/v1/auth/me").json()["organization"]["name"] == "Halcyon Bank"
