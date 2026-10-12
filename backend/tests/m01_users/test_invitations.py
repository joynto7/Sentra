"""Tests for FR-1.5 Team Invitations (UC-1.8 Invite, UC-1.9 Accept, UC-1.10 Remove)."""

import re
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.email import outbox
from app.main import app
from app.modules.m01_users.models import (
    Invitation,
    InvitationStatus,
    Membership,
    Role,
    User,
    UserSession,
)
from app.modules.m01_users.permissions import ROLE_DESCRIPTIONS
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m01_users.test_permissions import membership_of, organization_with

INVITATIONS = "/api/v1/organizations/current/invitations"
NO_LONGER_VALID = (
    "This invitation is no longer valid. Ask your Organization Administrator to send a new one."
)


def invite(client: TestClient, email: str = "priya@example.com", role: str = "security_analyst"):
    return client.post(INVITATIONS, json={"email": email, "role": role})


def token_from_last_email() -> str:
    return re.search(r"token=([\w-]+)", outbox[-1].get_content()).group(1)


def details(client: TestClient, token: str):
    return client.post("/api/v1/invitations/details", json={"token": token})


# ---------------------------------------------------------------- inviting (UC-1.8)


def test_the_administrator_invites_by_e_mail_with_a_role(client, db):
    organization_with(db, client, {})

    response = invite(client, "Priya@Example.com")

    assert response.status_code == 201
    body = response.json()
    assert (body["email"], body["role_label"], body["invited_by"], body["status"]) == (
        "priya@example.com",
        "Security Analyst",
        "Tom",
        "pending",
    )
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(days=6, hours=23) < expires - datetime.now(UTC) <= timedelta(days=7)
    message = outbox[-1]
    assert (message["To"], message["Subject"]) == (
        "priya@example.com",
        "Tom invited you to Halcyon Bank on Sentra",
    )
    assert [i["email"] for i in client.get(INVITATIONS).json()] == ["priya@example.com"]


def test_members_and_pending_invitations_are_not_invited_twice(client, db):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})

    member = invite(client, "maya@example.com")
    assert member.json()["error"]["details"] == [
        {"field": "email", "message": "This person is already a member of Halcyon Bank."}
    ]
    invite(client)
    again = invite(client)
    assert again.json()["error"]["details"] == [
        {
            "field": "email",
            "message": "This address already has a pending invitation. Resend it instead.",
        }
    ]


def test_only_administrators_invite(client, db):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    log_in(client, "maya@example.com")
    assert invite(client).status_code == 403
    assert client.get(INVITATIONS).status_code == 403


def test_resending_replaces_the_link_and_revoking_ends_it(client, db):
    organization_with(db, client, {})
    invitation_id = invite(client).json()["id"]
    first = token_from_last_email()

    assert client.post(f"{INVITATIONS}/{invitation_id}/resend").status_code == 200
    second = token_from_last_email()
    assert details(client, first).status_code == 410  # the old link no longer works
    assert details(client, second).status_code == 200

    assert client.post(f"{INVITATIONS}/{invitation_id}/revoke").status_code == 204
    assert details(client, second).json()["error"]["message"] == NO_LONGER_VALID
    assert client.get(INVITATIONS).json() == []


def test_an_expired_invitation_is_marked_and_no_longer_works(client, db):
    organization_with(db, client, {})
    invite(client)
    token = token_from_last_email()
    invitation = db.scalar(select(Invitation))
    invitation.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.flush()

    assert client.get(INVITATIONS).json()[0]["status"] == "expired"
    assert details(client, token).status_code == 410
    assert invite(client).status_code == 201  # a new invitation can be sent (UC-1.8, 5b)


# ---------------------------------------------------------------- accepting (UC-1.9)


def test_the_invitation_page_shows_the_organization_and_the_role(client, db):
    organization_with(db, client, {})
    invite(client)
    token = token_from_last_email()
    client.post("/api/v1/auth/logout")

    body = details(client, token).json()

    assert body == {
        "organization": "Halcyon Bank",
        "email": "priya@example.com",
        "role": "security_analyst",
        "role_label": "Security Analyst",
        "role_description": ROLE_DESCRIPTIONS[Role.SECURITY_ANALYST],
        "invited_by": "Tom",
        "has_account": False,
        "logged_in_as": None,
    }


def test_a_new_person_creates_an_account_and_joins_in_one_step(client, db):
    organization_with(db, client, {})
    invite(client)
    token = token_from_last_email()
    client.post("/api/v1/auth/logout")
    outbox.clear()

    response = client.post(
        "/api/v1/invitations/register",
        json={"token": token, "name": "Priya Raman", "password": PASSWORD, "accept_terms": True},
    )

    assert response.status_code == 200
    assert (response.json()["status"], response.json()["organization"]["role"]) == (
        "active",
        "security_analyst",
    )
    # Logged in and working in Halcyon Bank, without a separate verification e-mail.
    assert client.get("/api/v1/auth/me").json()["organization"]["name"] == "Halcyon Bank"
    assert [m["To"] for m in outbox] == ["tom@example.com"]  # the inviter is told (step 5)
    assert details(client, token).status_code == 410  # the link works once


def test_registering_through_an_invitation_checks_terms_and_password(client, db):
    organization_with(db, client, {})
    invite(client)
    token = token_from_last_email()

    no_terms = client.post(
        "/api/v1/invitations/register",
        json={"token": token, "name": "Priya", "password": PASSWORD, "accept_terms": False},
    )
    weak = client.post(
        "/api/v1/invitations/register",
        json={"token": token, "name": "Priya", "password": "short", "accept_terms": True},
    )
    assert no_terms.json()["error"]["details"][0]["field"] == "accept_terms"
    assert weak.json()["error"]["details"][0]["field"] == "password"


def test_a_person_with_an_account_logs_in_and_accepts(client, db):
    organization_with(db, client, {})
    invite(client)
    token = token_from_last_email()
    new_user(db, "priya@example.com")

    log_in(client, "priya@example.com")
    assert details(client, token).json()["has_account"] is True
    assert (
        client.post(
            "/api/v1/invitations/register",
            json={"token": token, "name": "Priya", "password": PASSWORD, "accept_terms": True},
        ).json()["error"]["code"]
        == "account_exists"
    )

    accepted = client.post("/api/v1/invitations/accept", json={"token": token})
    assert (accepted.json()["name"], accepted.json()["role"], accepted.json()["is_current"]) == (
        "Halcyon Bank",
        "security_analyst",
        True,
    )


def test_only_the_invited_address_can_accept(client, db):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    invite(client)
    token = token_from_last_email()

    log_in(client, "maya@example.com")
    assert details(client, token).json()["logged_in_as"] == "maya@example.com"
    response = client.post("/api/v1/invitations/accept", json={"token": token})
    assert response.status_code == 403
    assert response.json()["error"]["message"] == (
        "This invitation is for priya@example.com. Log in with that address to accept it."
    )


def test_declining_closes_the_invitation_and_tells_the_administrator(client, db):
    organization_with(db, client, {})
    invite(client)
    token = token_from_last_email()
    outbox.clear()

    assert client.post("/api/v1/invitations/decline", json={"token": token}).status_code == 204
    assert db.scalar(select(Invitation)).status == InvitationStatus.DECLINED
    assert outbox[-1]["Subject"] == "priya@example.com declined your invitation to Halcyon Bank"


# ---------------------------------------------------------------- removing (UC-1.10)


def remove(client: TestClient, membership: Membership, password: str = PASSWORD):
    return client.post(
        f"/api/v1/organizations/current/members/{membership.id}/remove", json={"password": password}
    )


def test_removing_a_member_ends_their_access_at_once(client, db):
    organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})
    priya_client = TestClient(app)
    log_in(priya_client, "priya@example.com")
    assert priya_client.get("/api/v1/auth/me").json()["organization"] is not None

    assert (
        remove(client, membership_of(db, "priya@example.com"), "wrong-password-1").status_code
        == 422
    )
    assert remove(client, membership_of(db, "priya@example.com")).status_code == 204

    assert priya_client.get("/api/v1/auth/me").status_code == 401  # her session in it ended
    priya = db.scalar(select(User).where(User.email == "priya@example.com"))
    assert priya is not None  # the account and its history are kept
    assert db.scalar(select(UserSession).where(UserSession.user_id == priya.id)) is None
    assert outbox[-1]["Subject"] == "You were removed from Halcyon Bank"


def test_the_administrator_cannot_remove_themselves(client, db):
    organization_with(db, client, {})
    response = remove(client, membership_of(db, "tom@example.com"))
    assert response.status_code == 409
    assert response.json()["error"]["message"] == "You can't remove yourself from the organization."
