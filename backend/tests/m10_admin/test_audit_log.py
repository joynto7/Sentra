"""Tests for FR-10.2 Audit Log (UC-10.3 Review Audit Log, NFR-8.3)."""

import csv
import hashlib
import io
import json
import uuid
from contextlib import nullcontext

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core import audit
from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import Membership, Role, User
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m10_admin import platform_admin
from tests.m01_users.test_organizations import PASSWORD, create, log_in, new_user
from tests.m01_users.test_permissions import change, membership_of, organization_with
from tests.m02_targets.conftest import fake_resolve
from tests.m04_tests.test_custom_tests import refund_test

LOG = "/api/v1/admin/audit-log"
PLATFORM_LOG = "/api/v1/admin/platform/audit-log"


@pytest.fixture(autouse=True)
def _fake_dns(monkeypatch):
    from app.core import addresses

    monkeypatch.setattr(addresses, "resolve", fake_resolve)


def entries(db, organization_id) -> list[AuditLogEntry]:
    return list(
        db.scalars(
            select(AuditLogEntry)
            .where(AuditLogEntry.chain == audit.chain_key(organization_id))
            .order_by(AuditLogEntry.seq)
        )
    )


def recompute(entry: dict, chain: str) -> str:
    """An auditor's own check of one exported entry, written from the export's description."""
    payload = {
        "chain": chain,
        **{k: entry[k] for k in entry if k not in ("entry_hash", "verified")},
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


# ---------------------------------------------------------------- recording


def test_actions_are_recorded_with_who_what_when_and_where(client, db):
    organization_id = organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})

    change(client, membership_of(db, "grace@example.com"), "security_manager")

    created, changed = entries(db, organization_id)
    assert (created.action, created.actor_name, created.summary) == (
        "organization.created",
        "Tom",
        "Created the organization Halcyon Bank",
    )
    assert (changed.action, changed.summary) == (
        "member.role_changed",
        "Changed the role of Grace: Security Analyst → Security Manager",
    )
    assert changed.details == {
        "before": {"role": "Security Analyst"},
        "after": {"role": "Security Manager"},
    }
    assert (changed.item_type, changed.item_label) == ("member", "Grace")
    assert changed.source_address == "testclient"  # the address of the request
    assert changed.actor_id == db.scalar(select(User.id).where(User.email == "tom@example.com"))


def test_invitations_and_removals_are_recorded(client, db):
    organization_id = organization_with(db, client, {"omar@example.com": Role.TARGET_OWNER})
    client.post(
        "/api/v1/organizations/current/invitations",
        json={"email": "priya@example.com", "role": "security_analyst"},
    )
    invitation_id = client.get("/api/v1/organizations/current/invitations").json()[0]["id"]
    client.post(f"/api/v1/organizations/current/invitations/{invitation_id}/revoke")
    omar = membership_of(db, "omar@example.com")
    client.post(
        f"/api/v1/organizations/current/members/{omar.id}/remove", json={"password": PASSWORD}
    )

    assert [(e.action, e.summary) for e in entries(db, organization_id)][1:] == [
        ("invitation.sent", "Invited priya@example.com as Security Analyst"),
        ("invitation.revoked", "Revoked the invitation of priya@example.com"),
        ("member.removed", "Removed Omar from the organization"),
    ]


def test_target_changes_are_recorded_without_secrets(client, db):
    organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    log_in(client, "maya@example.com")
    target = client.post(
        "/api/v1/targets",
        json={
            "name": "Customer Support Assistant",
            "type": "chatbot",
            "endpoint_url": "https://support-assistant.halcyonbank.com/api/chat",
            "environment": "production",
            "max_request_rate": 20,
            "credentials": [
                {"credential_type": "api_key", "name": "X-Api-Key", "value": "sk-live-secret-1"}
            ],
        },
    ).json()
    client.patch(
        f"/api/v1/targets/{target['id']}",
        json={"endpoint_url": "https://payments-agent.staging.halcyonbank.com/v1/chat"},
    )
    client.put(
        f"/api/v1/targets/{target['id']}/credentials",
        json={
            "credentials": [
                {"credential_type": "api_key", "name": "X-Api-Key", "value": "sk-live-secret-2"}
            ]
        },
    )

    organization_id = membership_of(db, "maya@example.com").organization_id
    recorded = entries(db, organization_id)[1:]
    assert [e.action for e in recorded] == [
        "target.registered",
        "target.updated",
        "target.credentials_replaced",
    ]
    assert recorded[1].summary == (
        "Changed the configuration of target Customer Support Assistant; "
        "its new endpoint must be verified again"
    )
    assert recorded[1].details == {"changed": ["endpoint_url"]}
    assert recorded[2].details == {"headers": ["X-Api-Key"]}
    assert "sk-live" not in json.dumps([e.details for e in recorded])


def test_secret_looking_details_are_dropped():
    cleaned = audit._clean({"password": "x", "nested": {"token": "y", "kept": 1}, "names": ["a"]})
    assert cleaned == {"nested": {"kept": 1}, "names": ["a"]}


def test_custom_tests_and_suites_are_recorded(client, db):
    sync_built_in_library(db)
    organization_id = organization_with(db, client, {"arif@example.com": Role.SECURITY_ANALYST})
    log_in(client, "arif@example.com")
    test = client.post("/api/v1/test-definitions", json={"definition": refund_test()}).json()
    client.post(
        "/api/v1/test-suites",
        json={
            "name": "Release regression",
            "purpose": "Fast checks before a release.",
            "tests": ["PI-DIR-001", test["code"]],
        },
    )

    recorded = [(e.action, e.item_type) for e in entries(db, organization_id)][1:]
    assert recorded == [("test.created", "test"), ("suite.created", "suite")]


# ---------------------------------------------------------------- integrity (NFR-8.3)


def test_each_organization_has_its_own_gapless_chain(client, db):
    halcyon = organization_with(db, client, {})
    new_user(db, "sam@example.com")
    log_in(client, "sam@example.com")
    northwind = uuid.UUID(create(client, "Northwind Labs").json()["id"])

    for organization_id in (halcyon, northwind):
        chain = entries(db, organization_id)
        assert [e.seq for e in chain] == list(range(1, len(chain) + 1))
        assert chain[0].prev_hash == audit.GENESIS
        assert all(b.prev_hash == a.entry_hash for a, b in zip(chain, chain[1:], strict=False))
        assert all(audit.digest(e) == e.entry_hash for e in chain)
        assert audit.verify(db, organization_id).ok


def test_entries_cannot_be_changed_or_deleted(client, db):
    organization_id = organization_with(db, client, {})
    entry_id = entries(db, organization_id)[0].id

    for statement in (
        "UPDATE audit_log_entries SET summary = 'nothing happened' WHERE id = :id",
        "DELETE FROM audit_log_entries WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match="can't be changed or deleted"), db.begin_nested():
            db.execute(text(statement), {"id": entry_id})


def _tamper(db, statement: str, entry_id) -> None:
    """What someone with direct database access could do after switching the trigger off."""
    db.execute(text("ALTER TABLE audit_log_entries DISABLE TRIGGER audit_log_entries_append_only"))
    db.execute(text(statement), {"id": entry_id})
    db.execute(text("ALTER TABLE audit_log_entries ENABLE TRIGGER audit_log_entries_append_only"))
    db.expire_all()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_log_entries SET summary = 'nothing happened' WHERE id = :id",
        "DELETE FROM audit_log_entries WHERE id = :id",
    ],
)
def test_a_changed_or_removed_entry_breaks_the_chain(client, db, statement):
    organization_id = organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")
    change(client, membership_of(db, "grace@example.com"), "security_analyst")
    middle = entries(db, organization_id)[1]

    _tamper(db, statement, middle.id)

    result = audit.verify(db, organization_id)
    assert not result.ok
    assert result.broken_seq in (2, 3)  # the changed entry, or the one after a removed entry
    page = client.get(LOG).json()
    assert page["integrity"]["verified"] is False


def test_removing_the_newest_entry_is_detected_too(client, db):
    organization_id = organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")

    _tamper(db, "DELETE FROM audit_log_entries WHERE id = :id", entries(db, organization_id)[-1].id)

    assert not audit.verify(db, organization_id).ok


# ---------------------------------------------------------------- reviewing (UC-10.3)


def test_the_administrator_reviews_the_log_newest_first(client, db):
    organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")

    page = client.get(LOG).json()

    assert page["total"] == 2
    first = page["items"][0]
    assert (first["action"], first["actor"]["name"], first["item"]["label"]) == (
        "member.role_changed",
        "Tom",
        "Grace",
    )
    assert page["integrity"]["verified"] is True
    assert page["integrity"]["entries"] == 2
    detail = client.get(f"{LOG}/{first['id']}").json()
    assert detail["hash_matches"] is True
    assert detail["details"]["after"] == {"role": "Security Manager"}
    assert len(detail["entry_hash"]) == len(detail["prev_hash"]) == 64


def test_filters_narrow_the_log(client, db):
    organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")
    tom = db.scalar(select(User.id).where(User.email == "tom@example.com"))

    def count(**params) -> int:
        return client.get(LOG, params=params).json()["total"]

    assert count(group="members") == 1
    assert count(group="organization") == 1
    assert count(group="targets") == 0
    assert count(actor_id=str(tom)) == 2
    assert count(search="security manager") == 1
    assert count(item_type="member") == 1
    assert count(start="2999-01-01T00:00:00Z") == 0
    options = client.get(f"{LOG}/filters").json()
    assert [g["key"] for g in options["groups"]] == ["organization", "members"]
    assert [a["name"] for a in options["actors"]] == ["Tom"]
    assert options["item_types"] == ["member", "organization"]


def test_only_the_organization_administrators_read_their_own_log(client, db):
    organization_with(db, client, {"arif@example.com": Role.SECURITY_ANALYST})
    entry_id = client.get(LOG).json()["items"][0]["id"]

    log_in(client, "arif@example.com")
    assert client.get(LOG).status_code == 403

    new_user(db, "sam@example.com")
    log_in(client, "sam@example.com")
    create(client, "Northwind Labs")
    assert client.get(LOG).json()["total"] == 1  # only Northwind's own creation
    assert client.get(f"{LOG}/{entry_id}").status_code == 404


def test_the_export_carries_the_hashes_and_is_recorded(client, db):
    organization_id = organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")

    response = client.post(f"{LOG}/export", json={"format": "json"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["content-disposition"].startswith('attachment; filename="sentra-audit')
    document = response.json()
    assert document["integrity"]["verified"] is True
    rows = document["entries"]
    assert [r["seq"] for r in rows] == [1, 2]
    assert all(r["verified"] for r in rows)
    # An auditor recomputes every hash and every link from the file alone.
    assert all(recompute(r, document["chain"]) == r["entry_hash"] for r in rows)
    assert rows[1]["prev_hash"] == rows[0]["entry_hash"]
    exported = entries(db, organization_id)[-1]
    assert (exported.action, exported.summary) == (
        "audit.exported",
        "Exported 2 audit log entries as JSON",
    )


def test_the_csv_export_has_one_row_per_entry(client, db):
    organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")

    response = client.post(f"{LOG}/export", json={"format": "csv", "group": "members"})

    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert [r["action"] for r in rows] == ["member.role_changed"]
    assert rows[0]["verified"] == "True"
    assert json.loads(rows[0]["details"])["before"] == {"role": "Security Analyst"}


def test_a_broken_chain_marks_the_export_and_alerts_the_platform_administrators(client, db):
    from app.core.email import outbox

    organization_id = organization_with(db, client, {"grace@example.com": Role.SECURITY_ANALYST})
    change(client, membership_of(db, "grace@example.com"), "security_manager")
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.flush()
    _tamper(
        db,
        "UPDATE audit_log_entries SET summary = 'x' WHERE id = :id",
        entries(db, organization_id)[0].id,
    )

    rows = client.post(f"{LOG}/export", json={"format": "json"}).json()["entries"]

    assert [r["verified"] for r in rows] == [False, False]
    alert = outbox[-1]
    assert alert["To"] == "lena@example.com"
    assert "audit log of Halcyon Bank" in alert.get_content()


# ---------------------------------------------------------------- the platform log (UC-10.3, 1a)


def test_platform_administrators_have_their_own_log(client, db, monkeypatch):
    organization_with(db, client, {})
    new_user(db, "lena@example.com")
    monkeypatch.setattr(platform_admin, "SessionLocal", lambda: nullcontext(db))

    assert platform_admin.main(["grant", "lena@example.com"]) == 0

    assert client.get(PLATFORM_LOG).status_code == 403  # Tom is an Organization Administrator
    log_in(client, "lena@example.com")
    assert client.get("/api/v1/auth/me").json()["platform_admin"] is True
    page = client.get(PLATFORM_LOG).json()
    assert [e["action"] for e in page["items"]] == ["platform.admin_granted"]
    assert page["items"][0]["summary"] == (
        "Gave the Platform Administrator role to Lena (server command)"
    )
    # The platform log holds no organization content, and Lena can't read Halcyon Bank's log.
    assert client.get(LOG).status_code == 403
    lena = db.scalar(select(User.id).where(User.email == "lena@example.com"))
    assert db.scalar(select(Membership).where(Membership.user_id == lena)) is None
