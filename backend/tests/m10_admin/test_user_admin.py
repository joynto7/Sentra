"""Tests for FR-10.1 User Administration (UC-10.2 Suspend User Account, 1a and 1b)."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.core.email import outbox
from app.core.models import Organization
from app.main import app
from app.modules.m01_users.models import (
    AccountEvent,
    AccountEventKind,
    Membership,
    Role,
    User,
    UserSession,
)
from app.modules.m09_reporting.models import Notification
from tests.m01_users.test_organizations import PASSWORD, create, log_in, new_user
from tests.m01_users.test_permissions import membership_of, organization_with

MEMBERS = "/api/v1/organizations/current/members"
ACCOUNTS = "/api/v1/admin/platform/accounts"


def suspend(client: TestClient, membership: Membership, reason="Laptop reported stolen", **extra):
    body = {"reason": reason, "password": PASSWORD, **extra}
    return client.post(f"/api/v1/admin/members/{membership.id}/suspend", json=body)


def reactivate(client: TestClient, membership: Membership, password: str = PASSWORD):
    return client.post(
        f"/api/v1/admin/members/{membership.id}/reactivate", json={"password": password}
    )


def user(db, email: str) -> User:
    return db.scalar(select(User).where(User.email == email))


def second_client() -> TestClient:
    """Another browser: the test database is shared through the app's dependency override."""
    return TestClient(app)


def actions(db, organization_id=None) -> list[str]:
    chain = str(organization_id) if organization_id else "platform"
    return list(
        db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.chain == chain)
            .order_by(AuditLogEntry.seq)
        )
    )


# ---------------------------------------------------------------- in one organization


def test_a_suspended_member_loses_access_at_once_and_keeps_the_role(client, db):
    organization_id = organization_with(db, client, {"omar@example.com": Role.TARGET_OWNER})
    with second_client() as omar:
        log_in(omar, "omar@example.com")
        assert omar.get("/api/v1/targets").status_code == 200

        response = suspend(client, membership_of(db, "omar@example.com"))

        assert response.status_code == 200
        assert response.json()["status"] == "suspended"
        # Step 4: Omar's session in the organization has ended.
        assert omar.get("/api/v1/targets").status_code == 401
        assert (
            db.scalars(
                select(UserSession).where(UserSession.user_id == user(db, "omar@example.com").id)
            ).all()
            == []
        )
        # Logging in again doesn't open the organization either (every request is checked).
        log_in(omar, "omar@example.com")
        denied = omar.get("/api/v1/targets")
        assert denied.status_code == 403
        assert denied.json()["error"] == {
            "code": "membership_suspended",
            "message": "Your access to Halcyon Bank is suspended. "
            "Contact its Organization Administrator.",
        }
    membership = membership_of(db, "omar@example.com")
    assert (membership.role, membership.suspension_reason) == (
        Role.TARGET_OWNER,
        "Laptop reported stolen",
    )
    assert actions(db, organization_id)[-1] == "member.suspended"
    message = outbox[-1]
    assert (message["To"], message["Subject"]) == (
        "omar@example.com",
        "Your access to Halcyon Bank is suspended",
    )


def test_the_members_list_shows_the_suspension(client, db):
    organization_with(db, client, {"omar@example.com": Role.TARGET_OWNER})
    suspend(client, membership_of(db, "omar@example.com"))

    omar = next(m for m in client.get(MEMBERS).json() if m["email"] == "omar@example.com")

    assert (omar["status"], omar["suspension_reason"], omar["suspended_by"]) == (
        "suspended",
        "Laptop reported stolen",
        "Tom",
    )
    assert omar["role_label"] == "AI Application Developer"
    assert omar["suspended_by_platform"] is False


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        ({"reason": "  "}, "reason", "Enter the reason. It is recorded in the audit log."),
        ({"password": "wrong-password"}, "password", "That password is incorrect."),
    ],
)
def test_a_suspension_needs_a_reason_and_the_password(client, db, changes, field, message):
    organization_with(db, client, {"omar@example.com": Role.TARGET_OWNER})
    membership = membership_of(db, "omar@example.com")
    body = {"reason": "Laptop reported stolen", "password": PASSWORD, **changes}

    response = client.post(f"/api/v1/admin/members/{membership.id}/suspend", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["details"] == [{"field": field, "message": message}]
    assert membership_of(db, "omar@example.com").active


def test_nobody_suspends_themselves_or_the_last_administrator(client, db):
    organization_with(db, client, {"nadia@example.com": Role.ORG_ADMIN})
    tom = membership_of(db, "tom@example.com")

    assert suspend(client, tom).json()["error"]["code"] == "suspend_self"
    assert suspend(client, membership_of(db, "nadia@example.com")).status_code == 200
    log_in(client, "nadia@example.com")  # suspended: Nadia can't act any more
    assert suspend(client, tom).status_code == 403


def test_other_administrators_are_informed(client, db):
    organization_with(
        db, client, {"nadia@example.com": Role.ORG_ADMIN, "omar@example.com": Role.TARGET_OWNER}
    )

    suspend(client, membership_of(db, "omar@example.com"))

    note = db.scalar(
        select(Notification).where(Notification.user_id == user(db, "nadia@example.com").id)
    )
    assert note.text == "Tom suspended Omar in Halcyon Bank: Laptop reported stolen"
    assert note.link == "/admin/members"


def test_reactivation_restores_the_previous_role(client, db):
    organization_id = organization_with(db, client, {"omar@example.com": Role.TARGET_OWNER})
    membership = membership_of(db, "omar@example.com")
    suspend(client, membership)

    assert reactivate(client, membership, "wrong-password").status_code == 422
    response = reactivate(client, membership)

    assert response.json()["status"] == "active"
    assert membership_of(db, "omar@example.com").role == Role.TARGET_OWNER
    log_in(client, "omar@example.com")
    assert client.get("/api/v1/targets").status_code == 200
    assert actions(db, organization_id)[-2:] == ["member.suspended", "member.reactivated"]


def test_another_organization_stays_open(client, db):
    organization_with(db, client, {"omar@example.com": Role.TARGET_OWNER})
    halcyon = membership_of(db, "omar@example.com")
    log_in(client, "omar@example.com")
    northwind = create(client, "Northwind Labs").json()["id"]  # Omar's own organization
    log_in(client, "tom@example.com")

    suspend(client, halcyon)

    log_in(client, "omar@example.com")
    me = client.get("/api/v1/auth/me").json()
    assert me["organization"]["name"] == "Northwind Labs"
    menu = {o["name"]: o["status"] for o in client.get("/api/v1/organizations").json()}
    assert menu == {"Halcyon Bank": "suspended", "Northwind Labs": "active"}
    switch = client.post(f"/api/v1/organizations/{halcyon.organization_id}/switch")
    assert switch.json()["error"]["code"] == "membership_suspended"
    assert northwind


def test_the_impact_is_shown_before_confirming(client, db):
    organization_with(
        db, client, {"nadia@example.com": Role.ORG_ADMIN, "omar@example.com": Role.TARGET_OWNER}
    )
    with second_client() as omar:
        log_in(omar, "omar@example.com")
        omar.get("/api/v1/auth/me")  # opens Halcyon Bank in this session

        response = client.get(
            f"/api/v1/admin/members/{membership_of(db, 'omar@example.com').id}/suspension"
        )

    assert response.json() == {"member": "Omar", "sessions": 1, "other_administrators": ["Nadia"]}


def test_only_organization_administrators_suspend(client, db):
    organization_with(
        db,
        client,
        {"arif@example.com": Role.SECURITY_ANALYST, "omar@example.com": Role.TARGET_OWNER},
    )
    log_in(client, "arif@example.com")
    assert suspend(client, membership_of(db, "omar@example.com")).status_code == 403


# ---------------------------------------------------------------- platform-wide (UC-10.2, 1a)


@pytest.fixture
def lena(client, db) -> TestClient:
    """Rahim belongs to Halcyon Bank (administrator Tom) and Kestrel Logistics (administrator
    Kim); Lena is a Platform Administrator and belongs to no organization. Lena is logged in."""
    organization_with(db, client, {"rahim@example.com": Role.SECURITY_ANALYST})
    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    kestrel = create(client, "Kestrel Logistics").json()["id"]
    db.add(
        Membership(
            user_id=user(db, "rahim@example.com").id,
            organization_id=kestrel,
            role=Role.SECURITY_ANALYST,
        )
    )
    new_user(db, "lena@example.com")
    user(db, "lena@example.com").platform_admin = True
    db.flush()
    return log_in(client, "lena@example.com")


def suspend_account(client, db, email="rahim@example.com", **extra):
    body = {"reason": "Logins from an unexpected country", "password": PASSWORD, **extra}
    return client.post(f"{ACCOUNTS}/{user(db, email).id}/suspend", json=body)


def test_a_platform_administrator_suspends_an_account_everywhere(lena, db):
    with second_client() as rahim:
        log_in(rahim, "rahim@example.com")

        response = suspend_account(lena, db)

        assert response.status_code == 200
        assert response.json()["status"] == "suspended"
        assert rahim.get("/api/v1/auth/me").status_code == 401  # every session ended
        login = rahim.post(
            "/api/v1/auth/login", json={"email": "rahim@example.com", "password": PASSWORD}
        )
        assert login.json()["error"]["code"] == "account_disabled"
    memberships = db.scalars(
        select(Membership).where(Membership.user_id == user(db, "rahim@example.com").id)
    ).all()
    assert {(m.status, m.suspended_by_platform) for m in memberships} == {("suspended", True)}
    assert actions(db)[-1] == "account.suspended"
    for membership in memberships:  # each organization sees it in its own log …
        assert actions(db, membership.organization_id)[-1] == "member.suspended"
    informed = {
        n.user_id for n in db.scalars(select(Notification).where(Notification.subject == "Rahim"))
    }
    # … and its administrators are informed (Tom and Kim), not the Platform Administrator.
    assert informed == {user(db, "tom@example.com").id, user(db, "kim@example.com").id}


def test_reactivating_restores_only_what_the_platform_suspended(lena, db, client):
    halcyon = db.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(User.email == "rahim@example.com", Organization.name == "Halcyon Bank")
    )
    log_in(client, "tom@example.com")
    suspend(client, halcyon, reason="Left the project")
    log_in(client, "lena@example.com")
    suspend_account(client, db)

    # An Organization Administrator can't undo the platform's suspension.
    log_in(client, "kim@example.com")
    kestrel = db.scalar(
        select(Membership).where(
            Membership.user_id == user(db, "rahim@example.com").id,
            Membership.id != halcyon.id,
        )
    )
    assert reactivate(client, kestrel).json()["error"]["code"] == "account_suspended"
    listed = next(m for m in client.get(MEMBERS).json() if m["email"] == "rahim@example.com")
    assert (listed["suspended_by_platform"], listed["suspended_by"]) == (
        True,
        "Lena (Sentra platform)",
    )
    log_in(client, "lena@example.com")
    response = client.post(
        f"{ACCOUNTS}/{user(db, 'rahim@example.com').id}/reactivate", json={"password": PASSWORD}
    )

    assert response.json()["status"] == "active"
    db.expire_all()
    assert db.get(Membership, kestrel.id).status == "active"
    assert db.get(Membership, halcyon.id).status == "suspended"  # Tom's own suspension stays
    assert db.get(Membership, halcyon.id).suspension_reason == "Left the project"


def test_the_accounts_page_shows_account_data_only(lena, db):
    rahim = user(db, "rahim@example.com")
    now = datetime.now(UTC)
    for days, address in [(10, "203.0.113.7"), (5, "203.0.113.7"), (0, "198.51.100.23")]:
        db.add(
            AccountEvent(
                user_id=rahim.id,
                kind=AccountEventKind.LOGGED_IN,
                ip_address=address,
                created_at=now - timedelta(days=days),
            )
        )
    db.flush()

    page = lena.get(ACCOUNTS, params={"search": "rahim"}).json()

    assert page["total"] == 1
    row = page["items"][0]
    assert row["organizations"] == [
        {"name": "Halcyon Bank", "status": "active"},
        {"name": "Kestrel Logistics", "status": "active"},
    ]
    assert row["last_login_new_address"] is True  # an address not used in the 30 days before
    assert set(row) == {
        "id",
        "name",
        "email",
        "organizations",
        "mfa_enabled",
        "last_login_at",
        "last_login_new_address",
        "status",
        "suspended_at",
        "suspension_reason",
        "platform_admin",
    }
    suspend_account(lena, db)
    assert lena.get(ACCOUNTS, params={"status": "suspended"}).json()["total"] == 1


def test_only_platform_administrators_see_accounts(lena, client, db):
    log_in(client, "tom@example.com")
    assert client.get(ACCOUNTS).status_code == 403
    assert suspend_account(client, db).status_code == 403


def test_platform_suspension_needs_the_password_and_never_hits_oneself(lena, db):
    assert suspend_account(lena, db, password="wrong-password").status_code == 422
    assert suspend_account(lena, db, email="lena@example.com").json()["error"]["code"] == (
        "suspend_self"
    )
