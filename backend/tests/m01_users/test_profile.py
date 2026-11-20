"""Tests for FR-1.7 (M1) Profile Management: UC-1.11 Manage Profile."""

import pytest
from fastapi.testclient import TestClient

from app.core.email import outbox
from app.main import app
from tests.m01_users.test_auth import token_from_last_email
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user

URL = "/api/v1/account"
EMAIL = "arif@example.com"
NEW_PASSWORD = "Silver-Harbor-Evening-77"


@pytest.fixture
def arif(client, db):
    new_user(db, EMAIL)
    return log_in(client, EMAIL)


def other_browser(email: str = EMAIL) -> TestClient:
    """The same person, logged in from a second browser."""
    return log_in(TestClient(app), email)


def details(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def test_profile_shows_the_personal_details(arif):
    body = arif.get(f"{URL}/profile").json()

    assert (body["name"], body["email"], body["phone"]) == ("Arif", EMAIL, None)
    assert body["pending_email"] is None
    assert body["password_changed_at"] is not None


def test_name_and_phone_are_saved(arif):
    response = arif.patch(
        f"{URL}/profile", json={"name": "Arif Hossain", "phone": "+880 1712 345678"}
    )

    assert response.status_code == 200
    assert (response.json()["name"], response.json()["phone"]) == (
        "Arif Hossain",
        "+880 1712 345678",
    )


def test_an_empty_name_or_a_wrong_phone_is_refused(arif):
    response = arif.patch(f"{URL}/profile", json={"name": " ", "phone": "call me"})

    assert details(response) == {
        "name": "Enter your name.",
        "phone": "Enter a phone number such as +880 1712 345678.",
    }


def test_a_new_address_changes_only_after_its_link_is_opened(arif):
    requested = arif.post(
        f"{URL}/email", json={"email": "arif.h@example.com", "password": PASSWORD}
    )

    assert requested.status_code == 202
    assert outbox[-1]["To"] == "arif.h@example.com"
    before = arif.get(f"{URL}/profile").json()
    assert (before["email"], before["pending_email"]) == (EMAIL, "arif.h@example.com")

    confirmed = arif.post(f"{URL}/email/confirm", json={"token": token_from_last_email()})

    assert confirmed.json()["message"] == "Your e-mail address is now arif.h@example.com."
    assert arif.get(f"{URL}/profile").json()["email"] == "arif.h@example.com"
    assert outbox[-1]["To"] == EMAIL  # the old address is told
    assert (
        TestClient(app)
        .post("/api/v1/auth/login", json={"email": "arif.h@example.com", "password": PASSWORD})
        .status_code
        == 200
    )


def test_changing_the_address_needs_the_password(arif):
    response = arif.post(f"{URL}/email", json={"email": "arif.h@example.com", "password": "wrong"})

    assert details(response) == {"password": "The password is incorrect."}


def test_an_address_of_another_account_is_refused_only_when_confirming(arif, db):
    new_user(db, "taken@example.com")

    requested = arif.post(f"{URL}/email", json={"email": "taken@example.com", "password": PASSWORD})
    confirmed = arif.post(f"{URL}/email/confirm", json={"token": token_from_last_email()})

    assert requested.status_code == 202  # the form doesn't reveal which addresses have accounts
    assert confirmed.status_code == 409
    assert confirmed.json()["error"]["code"] == "email_taken"


def test_a_pending_change_can_be_cancelled(arif):
    arif.post(f"{URL}/email", json={"email": "arif.h@example.com", "password": PASSWORD})
    token = token_from_last_email()

    assert arif.delete(f"{URL}/email").status_code == 204
    assert arif.get(f"{URL}/profile").json()["pending_email"] is None
    assert arif.post(f"{URL}/email/confirm", json={"token": token}).status_code == 400


def test_a_new_password_ends_the_other_sessions(arif):
    second = other_browser()

    response = arif.post(
        f"{URL}/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}
    )

    assert response.status_code == 204
    assert second.get("/api/v1/auth/me").status_code == 401
    assert arif.get("/api/v1/auth/me").status_code == 200  # this browser stays logged in
    assert "changed in your profile" in outbox[-1].get_content()
    assert (
        TestClient(app)
        .post("/api/v1/auth/login", json={"email": EMAIL, "password": NEW_PASSWORD})
        .status_code
        == 200
    )


def test_a_wrong_current_password_is_refused(arif):
    response = arif.post(
        f"{URL}/password", json={"current_password": "wrong", "new_password": NEW_PASSWORD}
    )

    assert details(response) == {"current_password": "The current password is incorrect."}


def test_a_new_password_must_meet_the_policy(arif):
    response = arif.post(
        f"{URL}/password", json={"current_password": PASSWORD, "new_password": "short"}
    )

    assert details(response)["new_password"].startswith("The password must meet:")


def test_the_session_list_marks_this_device(arif):
    other_browser()

    sessions = arif.get(f"{URL}/sessions").json()

    assert len(sessions) == 2
    assert [s["current"] for s in sessions].count(True) == 1


def test_an_ended_session_is_refused_at_once(arif):
    second = other_browser()
    other = next(s for s in arif.get(f"{URL}/sessions").json() if not s["current"])

    assert arif.post(f"{URL}/sessions/{other['id']}/end").status_code == 204
    assert second.get("/api/v1/auth/me").status_code == 401


def test_this_session_is_ended_by_logging_out(arif):
    this = next(s for s in arif.get(f"{URL}/sessions").json() if s["current"])

    response = arif.post(f"{URL}/sessions/{this['id']}/end")

    assert response.status_code == 409


def test_another_persons_session_is_not_found(arif, db):
    new_user(db, "nadia@example.com")
    nadia = other_browser("nadia@example.com")
    hers = nadia.get(f"{URL}/sessions").json()[0]["id"]

    assert arif.post(f"{URL}/sessions/{hers}/end").status_code == 404
    assert nadia.get("/api/v1/auth/me").status_code == 200


def test_all_other_sessions_can_end_together(arif):
    browsers = [other_browser(), other_browser()]

    response = arif.post(f"{URL}/sessions/end-others")

    assert response.json()["message"] == "2 other sessions logged out."
    assert all(b.get("/api/v1/auth/me").status_code == 401 for b in browsers)


def test_recent_activity_lists_logins_and_failed_attempts(arif):
    TestClient(app).post("/api/v1/auth/login", json={"email": EMAIL, "password": "wrong"})
    other_browser()

    kinds = [event["kind"] for event in arif.get(f"{URL}/activity").json()]

    assert kinds[:3] == ["logged_in", "login_failed", "logged_in"]
