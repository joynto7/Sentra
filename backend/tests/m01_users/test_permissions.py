"""Tests for FR-1.6: role-based access control, and changing a member's role (UC-10.1)."""

import uuid

from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.email import outbox
from app.main import app
from app.modules.m01_users.models import Membership, Role, User
from app.modules.m01_users.permissions import PERMISSIONS, Action, allowed, require
from tests.m01_users.test_organizations import PASSWORD, create, log_in, new_user

# An endpoint that only AI Application Developers may use, as a later module's endpoints will.
probe = APIRouter(prefix="/_test")


@probe.post("/register-target")
def register_target_probe(membership: Membership = Depends(require(Action.MANAGE_TARGETS))) -> dict:
    return {"organization_id": str(membership.organization_id)}


app.include_router(probe, prefix="/api")


def organization_with(db, client: TestClient, members: dict[str, Role]) -> uuid.UUID:
    """Halcyon Bank, created by tom@example.com (its administrator), plus the given members."""
    new_user(db, "tom@example.com")
    log_in(client, "tom@example.com")
    organization_id = uuid.UUID(create(client, "Halcyon Bank").json()["id"])
    for email, role in members.items():
        new_user(db, email)
        user_id = db.scalar(select(User.id).where(User.email == email))
        db.add(Membership(user_id=user_id, organization_id=organization_id, role=role))
    db.flush()
    return organization_id


def membership_of(db, email: str) -> Membership:
    return db.scalar(
        select(Membership).join(User, User.id == Membership.user_id).where(User.email == email)
    )


def change(client: TestClient, membership: Membership, role: str, password: str = PASSWORD):
    return client.patch(
        f"/api/v1/organizations/current/members/{membership.id}",
        json={"role": role, "password": password},
    )


def test_every_action_belongs_to_at_least_one_role():
    assert all(permission.roles for permission in PERMISSIONS.values())
    assert set(PERMISSIONS) == set(Action)


def test_roles_follow_the_primary_actors_of_the_use_cases():
    assert allowed(Role.TARGET_OWNER, Action.MANAGE_TARGETS)  # UC-2.1
    assert not allowed(Role.SECURITY_ANALYST, Action.MANAGE_TARGETS)
    assert allowed(Role.SECURITY_MANAGER, Action.APPROVE_CAMPAIGN_SCOPE)  # UC-5.2
    assert not allowed(Role.SECURITY_ANALYST, Action.APPROVE_CAMPAIGN_SCOPE)
    assert allowed(Role.ORG_ADMIN, Action.MANAGE_MEMBERS)  # UC-1.8, UC-10.1
    assert not allowed(Role.ORG_ADMIN, Action.MANAGE_CAMPAIGNS)


def test_the_server_refuses_an_action_the_role_does_not_allow(client, db):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})

    response = client.post("/api/_test/register-target")  # Tom, the administrator
    assert response.status_code == 403
    assert response.json()["error"]["message"] == (
        "Your role (Organization Administrator) doesn't allow this: Register and change targets."
    )

    log_in(client, "maya@example.com")
    assert client.post("/api/_test/register-target").status_code == 200


def test_roles_are_listed_with_what_each_may_do(logged_in_client):
    roles = {r["role"]: r for r in logged_in_client.get("/api/v1/organizations/roles").json()}

    assert list(roles) == ["security_analyst", "target_owner", "security_manager", "org_admin"]
    assert roles["target_owner"]["label"] == "AI Application Developer"
    analyst = [p["label"] for p in roles["security_analyst"]["permissions"]]
    manager = [p["label"] for p in roles["security_manager"]["permissions"]]
    assert "Create and launch campaigns" in analyst and "Create and launch campaigns" not in manager
    assert "Approve campaign scope" in manager and "Approve campaign scope" not in analyst


def test_only_administrators_see_the_member_list(client, db):
    organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})

    members = client.get("/api/v1/organizations/current/members").json()
    assert [(m["name"], m["role_label"], m["is_you"]) for m in members] == [
        ("Priya", "Security Analyst", False),
        ("Tom", "Organization Administrator", True),
    ]

    log_in(client, "priya@example.com")
    assert client.get("/api/v1/organizations/current/members").status_code == 403


def test_administrator_changes_a_role_and_the_member_is_told(client, db):
    organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})

    response = change(client, membership_of(db, "priya@example.com"), "security_manager")

    assert response.status_code == 200
    assert response.json()["role_label"] == "Security Manager"
    assert [(m["To"], m["Subject"]) for m in outbox] == [
        ("priya@example.com", "Your role in Halcyon Bank has changed")
    ]
    log_in(client, "priya@example.com")
    assert client.get("/api/v1/auth/me").json()["organization"]["role"] == "security_manager"


def test_a_wrong_password_changes_nothing(client, db):
    organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})
    priya = membership_of(db, "priya@example.com")

    response = change(client, priya, "security_manager", password="Not-The-Password-1")

    assert response.status_code == 422
    assert response.json()["error"]["details"] == [
        {"field": "password", "message": "That password is incorrect."}
    ]
    db.refresh(priya)
    assert priya.role == Role.SECURITY_ANALYST


def test_the_only_administrator_keeps_the_role(client, db):
    organization_with(db, client, {})

    response = change(client, membership_of(db, "tom@example.com"), "security_analyst")

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "last_admin",
        "message": "Tom is the only Organization Administrator. "
        "Give another member this role first.",
    }


def test_members_of_another_organization_cannot_be_changed(client, db):
    new_user(db, "omar@example.com")
    log_in(client, "omar@example.com")
    create(client, "Other Company")
    omar = membership_of(db, "omar@example.com")

    organization_with(db, client, {})  # Tom, administrator of Halcyon Bank
    assert change(client, omar, "security_analyst").status_code == 404


def test_a_new_role_applies_from_the_next_request(client, db):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    maya_client = TestClient(app)
    log_in(maya_client, "maya@example.com")
    assert maya_client.post("/api/_test/register-target").status_code == 200

    change(client, membership_of(db, "maya@example.com"), "security_analyst")  # Tom changes it

    assert maya_client.post("/api/_test/register-target").status_code == 403  # no new login
