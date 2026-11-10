"""What needs the attention of the person reading the Risk Dashboard (Screen 42, UC-7.3): at most
five things for the role, each with the count of the page it opens. Dummy values only: the
messages ATTEMPT-1 …, invented replies, fake tokens and keys that are only hashes of nothing.
"""

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.models import Organization
from app.modules.m01_users.models import Invitation, Role, User
from app.modules.m03_threat_models.models import Origin, ThreatModel, ThreatModelStatus
from app.modules.m05_campaigns.models import ApprovalStatus, Campaign, CampaignRun, RunStatus
from app.modules.m06_findings.models import FindingStatus
from app.modules.m07_risk import router as risk_router
from app.modules.m08_remediation.models import (
    ApplicationChange,
    Enforcement,
    FixKind,
    GatewayPosition,
    GatewayStatus,
    Remediation,
    RemediationFix,
    RemediationStatus,
    ShieldGateway,
)
from app.modules.m08_remediation.models import Origin as RemediationOrigin
from app.modules.m09_reporting.models import ApiKey
from app.modules.search.service import Limiter
from tests.m01_users.test_organizations import create, log_in, new_user
from tests.m05_campaigns.test_campaigns import add_target
from tests.m07_risk.conftest import REFUND_TOOL, findings_of, profile_for
from tests.m07_risk.test_paths import model_finding, tool_finding

ATTENTION = "/api/v1/risk/attention"


def attention(client) -> dict:
    response = client.get(ATTENTION)
    assert response.status_code == 200, response.text
    return response.json()


def counts(shown: dict) -> dict[str, int]:
    return {item["key"]: item["count"] for item in shown["items"]}


def user_id(db, email: str):
    return db.scalar(select(User.id).where(User.email == email))


def findings_total(client, **query) -> int:
    """What the Findings list says it holds for this view and these filters (Screen 38)."""
    response = client.get("/api/v1/findings", params={"page_size": 1, **query})
    assert response.status_code == 200, response.text
    return response.json()["total"]


def two_findings(team, run_with):
    """Two findings of the Payments Operations Agent, both new."""
    profile_for(team.db, team.agent, tools=[REFUND_TOOL])
    model_finding(team, run_with, category="LLM01")
    tool_finding(team, run_with, category="LLM06")
    return findings_of(team.db)


def three_findings(team, run_with):
    """Three findings of the Payments Operations Agent, all new."""
    two_findings(team, run_with)
    model_finding(team, run_with, category="LLM07")
    return findings_of(team.db)


def awaiting_approval(team, finding, *, edited_by=None) -> Remediation:
    """Version 1 of the finding's proposal, sent for approval, with one fix the application has to
    carry and the change that fix needs."""
    finding.status = FindingStatus.CONFIRMED
    remediation = Remediation(
        organization_id=team.org,
        finding_id=finding.id,
        version=1,
        status=RemediationStatus.AWAITING_APPROVAL,
        origin=RemediationOrigin.GENERATED,
        root_cause="STUB-ROOT-CAUSE",
        summary="STUB-SUMMARY",
        edited_by_id=edited_by,
        submitted_at=datetime.now(UTC),
    )
    team.db.add(remediation)
    team.db.flush()
    fix = RemediationFix(
        remediation_id=remediation.id,
        position=1,
        kind=FixKind.CODE_CHANGE,
        title="STUB-FIX",
        description="STUB-DESCRIPTION",
        enforcement=Enforcement.APPLICATION,
    )
    team.db.add(fix)
    team.db.flush()
    team.db.add(
        ApplicationChange(
            organization_id=team.org,
            finding_id=finding.id,
            remediation_id=remediation.id,
            fix_id=fix.id,
            position=1,
            title="STUB-CHANGE",
        )
    )
    team.db.commit()
    return remediation


def silent_gateway(team, target) -> ShieldGateway:
    """A gateway that connected and then stopped reporting: its last heartbeat is an hour old."""
    gateway = ShieldGateway(
        organization_id=team.org,
        target_id=target.id,
        position=GatewayPosition.IN_FRONT,
        status=GatewayStatus.ACTIVE,
        credential_prefix="sgw_stub01",
        credential_hash=hashlib.sha256(b"STUB-GATEWAY").hexdigest(),
        connected_at=datetime.now(UTC) - timedelta(days=2),
        last_contact_at=datetime.now(UTC) - timedelta(hours=1),
    )
    team.db.add(gateway)
    team.db.commit()
    return gateway


def test_the_analyst_sees_their_work_in_order_and_at_most_five_things(team, run_with):
    """A Security Analyst: paused runs, new findings, findings that require confirmation,
    remediations awaiting their approval, threat model drafts and findings assigned to them, in
    that order. Six things are real here, so five are shown and one more is counted."""
    first, second, third = three_findings(team, run_with)
    second.status = FindingStatus.REQUIRES_CONFIRMATION
    first.owner_id = user_id(team.db, "arif@example.com")
    team.db.commit()
    awaiting_approval(team, third, edited_by=user_id(team.db, "maya@example.com"))
    run = team.db.scalar(select(CampaignRun).order_by(CampaignRun.number.desc()))
    run.status = RunStatus.PAUSED
    team.db.add(
        ThreatModel(
            organization_id=team.org,
            target_id=team.agent.id,
            version=1,
            status=ThreatModelStatus.DRAFT,
            origin=Origin.GENERATED,
            components=[],
        )
    )
    team.db.commit()

    shown = attention(team.client)

    assert shown["role"] == Role.SECURITY_ANALYST
    keys = [item["key"] for item in shown["items"]]
    assert keys == [
        "paused_runs",
        "new_findings",
        "requires_confirmation",
        "awaiting_my_approval",
        "threat_model_drafts",
    ]
    assert shown["more"] == 1  # the findings assigned to Arif didn't fit
    found = counts(shown)
    # Each count is the number of the page the item opens
    assert found["new_findings"] == findings_total(team.client, view="open", status="new")
    assert found["requires_confirmation"] == findings_total(
        team.client, view="requires_confirmation"
    )
    runs = team.client.get("/api/v1/campaigns/runs").json()
    assert found["paused_runs"] == sum(row["status"] == "paused" for row in runs)
    assert shown["items"][0]["one"] == {"campaign": "C-001", "number": run.number}
    models = team.client.get("/api/v1/threat-models").json()
    assert found["threat_model_drafts"] == models["drafts_to_review"] == 1
    assert shown["items"][4]["one"] == {"target_id": str(team.agent.id)}
    remediations = team.client.get("/api/v1/remediations").json()
    assert found["awaiting_my_approval"] == remediations["awaiting_me"] == 1


def test_findings_assigned_to_the_analyst_count_like_the_quick_view(team, run_with):
    first, _ = two_findings(team, run_with)
    first.owner_id = user_id(team.db, "arif@example.com")
    team.db.commit()

    found = counts(attention(team.client))

    assert found["assigned_to_me"] == findings_total(team.client, view="assigned") == 1


def test_the_developer_sees_their_findings_changes_targets_and_gateways(team, run_with):
    """An AI Application Developer: findings assigned to them, open application changes, targets
    to verify and gateways that stopped reporting."""
    first, second = two_findings(team, run_with)
    maya = user_id(team.db, "maya@example.com")
    first.owner_id = maya
    team.db.commit()
    awaiting_approval(team, second)
    unverified = add_target(team.db, team.org, name="Marketing Copy Assistant", status="unverified")
    team.db.commit()
    silent_gateway(team, team.agent)
    log_in(team.client, "maya@example.com")

    shown = attention(team.client)

    assert shown["role"] == Role.TARGET_OWNER
    assert [item["key"] for item in shown["items"]] == [
        "assigned_to_me",
        "open_changes",
        "unverified_targets",
        "gateways_not_reporting",
    ]
    found = counts(shown)
    assert found["assigned_to_me"] == findings_total(team.client, view="assigned") == 1
    assert found["open_changes"] == team.client.get("/api/v1/remediations").json()["open_changes"]
    assert found["unverified_targets"] == 1
    assert shown["items"][2]["one"] == {"target_id": str(unverified.id)}
    gateways = team.client.get("/api/v1/shield").json()["rows"]
    assert found["gateways_not_reporting"] == sum(
        row["status"] == GatewayStatus.NOT_REPORTING for row in gateways
    )
    assert shown["items"][3]["one"] == {"target_id": str(team.agent.id)}


def test_the_manager_sees_approvals_critical_findings_and_the_usage_limit(team, run_with):
    """A Security Manager: campaign scopes to approve, remediations awaiting their approval, open
    critical findings and a monthly limit past its warning threshold."""
    first, second = two_findings(team, run_with)
    first.severity = "critical"
    team.db.commit()
    awaiting_approval(team, second, edited_by=user_id(team.db, "arif@example.com"))
    campaign = team.db.scalar(select(Campaign))
    campaign.approval_status = ApprovalStatus.AWAITING_APPROVAL
    organization = team.db.get(Organization, team.org)
    organization.limit_attempts = 2  # the runs above sent two attempts: the limit is reached
    organization.limit_warn_percent = 80
    team.db.commit()
    log_in(team.client, "sofia@example.com")

    shown = attention(team.client)

    assert shown["role"] == Role.SECURITY_MANAGER
    assert [item["key"] for item in shown["items"]] == [
        "scopes_to_approve",
        "awaiting_my_approval",
        "critical_findings",
        "usage_limit",
    ]
    found = counts(shown)
    campaigns = team.client.get("/api/v1/campaigns").json()
    assert found["scopes_to_approve"] == sum(
        row["approval_status"] == ApprovalStatus.AWAITING_APPROVAL for row in campaigns
    )
    assert shown["items"][0]["one"] == {"code": "C-001"}
    assert (
        found["awaiting_my_approval"]
        == team.client.get("/api/v1/remediations").json()["awaiting_me"]
    )
    assert found["critical_findings"] == findings_total(
        team.client, view="open", severity="critical"
    )
    usage = shown["items"][3]
    assert usage["detail"]["kind"] == "attempts" and usage["detail"]["percent"] >= 100


def test_whoever_last_edited_a_proposal_isnt_asked_to_approve_it(team, run_with):
    """UC-8.3, 4a: the manager who adapted the version may not approve it, so it isn't theirs to
    do, here as on Remediation's tab."""
    _, second = two_findings(team, run_with)
    awaiting_approval(team, second, edited_by=user_id(team.db, "sofia@example.com"))
    log_in(team.client, "sofia@example.com")

    assert "awaiting_my_approval" not in counts(attention(team.client))
    assert team.client.get("/api/v1/remediations").json()["awaiting_me"] == 0


def test_the_administrator_sees_invitations_gateways_and_keys(team, run_with):
    """An Organization Administrator: invitations not accepted yet (the expired ones among them),
    gateways that stopped reporting and API keys that expire soon."""
    now = datetime.now(UTC)
    tom = user_id(team.db, "tom@example.com")
    for number, expires in enumerate((now + timedelta(days=3), now - timedelta(days=1))):
        team.db.add(
            Invitation(
                organization_id=team.org,
                email=f"new{number}@example.com",
                role=Role.SECURITY_ANALYST,
                token_hash=hashlib.sha256(f"STUB-INVITATION-{number}".encode()).hexdigest(),
                expires_at=expires,
                invited_by_id=tom,
            )
        )
    team.db.add(
        ApiKey(
            organization_id=team.org,
            name="Release pipeline",
            purpose="STUB-PURPOSE",
            prefix="snt_stub0001",
            key_hash=hashlib.sha256(b"STUB-KEY").hexdigest(),
            scopes=["read_findings"],
            target_ids=[],
            created_by_id=tom,
            expires_at=now + timedelta(days=5),
        )
    )
    team.db.commit()
    silent_gateway(team, team.agent)
    log_in(team.client, "tom@example.com")

    shown = attention(team.client)

    assert shown["role"] == Role.ORG_ADMIN
    assert [item["key"] for item in shown["items"]] == [
        "pending_invitations",
        "gateways_not_reporting",
        "expiring_api_keys",
    ]
    invitations = team.client.get("/api/v1/organizations/current/invitations").json()
    assert counts(shown)["pending_invitations"] == len(invitations) == 2
    assert shown["items"][0]["detail"] == {"expired": 1}
    keys = team.client.get("/api/v1/api-keys").json()["rows"]
    assert counts(shown)["expiring_api_keys"] == sum(row["state"] == "expiring" for row in keys)


def test_nothing_to_do_gives_an_empty_list(team):
    """Only what is real and above zero: an organization without findings, approvals or
    invitations has nothing to show, and the page says so in a sentence of its own."""
    assert attention(team.client) == {"role": Role.SECURITY_ANALYST, "items": [], "more": 0}


def test_another_organization_sees_none_of_our_work(team, run_with, client, db):
    """NFR-3.3: the counts are the reader's own organization's, whatever they ask."""
    two_findings(team, run_with)
    new_user(db, "eve@example.com")
    log_in(client, "eve@example.com")
    create(client, "Other Bank")

    assert attention(client)["items"] == []


def test_asking_too_often_is_refused(team, monkeypatch):
    """Like the search box, the panel answers a person a limited number of times a minute."""
    monkeypatch.setattr(risk_router, "attention_limiter", Limiter(limit=2, seconds=60))

    assert team.client.get(ATTENTION).status_code == 200
    assert team.client.get(ATTENTION).status_code == 200
    refused = team.client.get(ATTENTION)

    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "too_many_requests"
