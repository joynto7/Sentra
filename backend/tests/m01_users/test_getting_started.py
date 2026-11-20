"""Tests for Screen 07 Getting started: the five first steps of a new organization (UC-1.6 step 6,
UC-7.3 2a, NFR-4.1)."""

from datetime import UTC, datetime, timedelta

from app.modules.m01_users.models import Invitation, InvitationStatus, Role
from app.modules.m02_targets.models import Target
from tests.m01_users.test_organizations import create, log_in, new_user
from tests.m01_users.test_permissions import organization_with

URL = "/api/v1/organizations/current/getting-started"


def add_target(db, organization_id, name="Payments Operations Agent", status="unverified"):
    target = Target(
        organization_id=organization_id,
        name=name,
        type="chatbot",
        endpoint_url="https://payments-agent.staging.halcyonbank.com/v1/chat",
        environment="staging",
        max_request_rate=20,
        status=status,
        verification_token="t" * 32,
    )
    db.add(target)
    db.flush()
    return target


def test_a_new_organization_has_only_its_first_step_done(logged_in_client):
    create(logged_in_client, "Halcyon Bank")

    body = logged_in_client.get(URL).json()

    assert body["done"] == ["organization"]
    assert (body["organization"], body["created_by"]) == ("Halcyon Bank", "Test User")
    assert (body["members"], body["open_invitations"]) == (1, 0)
    assert body["first_target"] is None and body["verified_target"] is None
    assert body["campaign_run_finished"] is False


def test_an_open_invitation_or_another_member_completes_the_team_step(client, db):
    organization_id = organization_with(db, client, {})
    db.add(
        Invitation(
            organization_id=organization_id,
            email="old@example.com",
            role=Role.SECURITY_ANALYST,
            token_hash="x" * 64,
            status=InvitationStatus.PENDING,
            expires_at=datetime.now(UTC) - timedelta(days=1),  # expired: doesn't count
        )
    )
    db.flush()
    assert "team" not in client.get(URL).json()["done"]

    response = client.post(
        "/api/v1/organizations/current/invitations",
        json={"email": "priya@example.com", "role": "security_analyst"},
    )

    assert response.status_code == 201
    body = client.get(URL).json()
    assert "team" in body["done"]
    assert body["open_invitations"] == 1


def test_targets_complete_the_next_steps(client, db):
    organization_id = organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    add_target(db, organization_id, "Old Chatbot", status="archived")  # doesn't count
    assert client.get(URL).json()["done"] == ["organization", "team"]

    first = add_target(db, organization_id)
    body = client.get(URL).json()
    assert body["done"] == ["organization", "team", "target"]
    assert body["first_target"] == {"id": str(first.id), "name": "Payments Operations Agent"}
    assert body["unverified_target"] == body["first_target"]

    first.status = "verified"
    db.flush()
    body = client.get(URL).json()
    assert body["done"] == ["organization", "team", "target", "verification"]
    assert body["verified_target"]["name"] == "Payments Operations Agent"
    assert body["unverified_target"] is None


def test_every_member_reads_only_their_own_organization(client, db):
    organization_id = organization_with(db, client, {"arif@example.com": Role.SECURITY_ANALYST})
    add_target(db, organization_id)
    new_user(db, "kim@example.com")
    log_in(client, "kim@example.com")
    create(client, "Kestrel Logistics")

    assert client.get(URL).json()["done"] == ["organization"]  # Kestrel has no target
    log_in(client, "arif@example.com")
    assert client.get(URL).json()["organization"] == "Halcyon Bank"
    assert "target" in client.get(URL).json()["done"]
