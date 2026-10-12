"""Tests for FR-1.4: organizations, memberships and switching (UC-1.6, NFR-3.3)."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.main import app
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User, UserStatus
from app.modules.m01_users.security import hash_password

PASSWORD = "Copper-Kettle-Morning-42"

# A small endpoint that needs an organization, as every later module's endpoints will.
probe = APIRouter(prefix="/_test")


@probe.get("/membership")
def membership_probe(membership: Membership = Depends(current_membership)) -> dict:
    return {"organization_id": str(membership.organization_id), "role": membership.role}


app.include_router(probe, prefix="/api")


def new_user(db, email: str) -> None:
    db.add(
        User(
            email=email,
            name=email.split("@")[0].title(),
            password_hash=hash_password(PASSWORD),
            status=UserStatus.ACTIVE,
            terms_accepted_at=datetime.now(UTC),
        )
    )
    db.flush()


def log_in(client: TestClient, email: str) -> TestClient:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return client


def create(client: TestClient, name: str):
    return client.post("/api/v1/organizations", json={"name": name})


def test_new_user_has_no_organization(logged_in_client):
    assert logged_in_client.get("/api/v1/auth/me").json()["organization"] is None


def test_creator_becomes_organization_administrator(logged_in_client):
    response = create(logged_in_client, "Halcyon Bank")

    assert response.status_code == 201
    body = response.json()
    assert (body["slug"], body["role"], body["role_label"], body["is_current"]) == (
        "halcyon-bank",
        "org_admin",
        "Organization Administrator",
        True,
    )
    assert logged_in_client.get("/api/v1/auth/me").json()["organization"]["name"] == "Halcyon Bank"


def test_organization_name_is_required(logged_in_client):
    response = create(logged_in_client, "   ")

    assert response.status_code == 422
    assert response.json()["error"]["details"] == [
        {"field": "name", "message": "Enter an organization name."}
    ]


def test_each_organization_gets_its_own_address(logged_in_client):
    create(logged_in_client, "Halcyon Bank")
    second = create(logged_in_client, "Halcyon Bank").json()

    assert second["slug"] == "halcyon-bank-2"
    assert len(logged_in_client.get("/api/v1/organizations").json()) == 2


def test_switching_between_organizations(logged_in_client):
    first = create(logged_in_client, "Halcyon Bank").json()
    create(logged_in_client, "Northwind Labs")

    response = logged_in_client.post(f"/api/v1/organizations/{first['id']}/switch")

    assert response.status_code == 200
    assert logged_in_client.get("/api/v1/auth/me").json()["organization"]["id"] == first["id"]
    current = [
        o["name"] for o in logged_in_client.get("/api/v1/organizations").json() if o["is_current"]
    ]
    assert current == ["Halcyon Bank"]


def test_nobody_can_open_another_users_organization(client, db):
    new_user(db, "arif@halcyonbank.com")
    new_user(db, "outsider@example.com")
    bank = create(log_in(client, "arif@halcyonbank.com"), "Halcyon Bank").json()

    with TestClient(app) as other:
        log_in(other, "outsider@example.com")
        response = other.post(f"/api/v1/organizations/{bank['id']}/switch")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
        assert other.get("/api/v1/organizations").json() == []
        assert other.get("/api/v1/auth/me").json()["organization"] is None


def test_the_last_organization_opens_again_after_login(client, db):
    new_user(db, "arif@halcyonbank.com")
    log_in(client, "arif@halcyonbank.com")
    bank = create(client, "Halcyon Bank").json()
    create(client, "Northwind Labs")
    client.post(f"/api/v1/organizations/{bank['id']}/switch")
    client.post("/api/v1/auth/logout")

    log_in(client, "arif@halcyonbank.com")

    assert client.get("/api/v1/auth/me").json()["organization"]["name"] == "Halcyon Bank"


def test_organization_data_needs_a_membership(logged_in_client):
    before = logged_in_client.get("/api/_test/membership")
    bank = create(logged_in_client, "Halcyon Bank").json()
    after = logged_in_client.get("/api/_test/membership")

    assert before.status_code == 403
    assert before.json()["error"]["code"] == "no_organization"
    assert after.json() == {"organization_id": bank["id"], "role": "org_admin"}
