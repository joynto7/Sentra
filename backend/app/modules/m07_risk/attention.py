"""What needs the attention of the person reading the Risk Dashboard: "What should I do next?"
(Screen 42, UC-7.3): the "Needs attention" panel at the top of the page.

The panel lists at most five things, and only things that are real and above zero. Which things
depends on the role, because each role acts on different work (FR-1.6, M1):

- Security Analyst: paused campaign runs, new findings to triage, findings that require
  confirmation, remediations awaiting their approval, threat model drafts to review, findings
  assigned to them.
- AI Application Developer: findings assigned to them, open application changes, targets whose
  ownership isn't verified yet, Sentra Shield gateways that stopped reporting.
- Security Manager: campaign scopes to approve, remediations awaiting their approval, open critical
  findings, a monthly usage limit close to being reached.
- Organization Administrator: invitations not accepted yet, Sentra Shield gateways that stopped
  reporting, a monthly usage limit close to being reached, API keys that expire soon.

Every count is the number the linked page shows, worked out the way that page works it out — the
Findings list, the Campaigns chips, Threat Models, Remediation's tabs, Sentra Shield, Members and
API Keys — so the panel and the page never disagree (tests/m07_risk/test_attention.py checks each
one against the page's own API). The panel covers the whole organization, whatever target the
dashboard is narrowed to, because it is the person's work, not a view of the risk.

The organization comes from the session, every query is scoped to it, and the answer holds counts
and codes only, the same as the lists show every member.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.tenancy import scoped_select
from app.modules.m01_users import invitations
from app.modules.m01_users.models import Membership, Role
from app.modules.m01_users.permissions import Action, allowed
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m03_threat_models.models import ThreatModel, ThreatModelStatus
from app.modules.m04_tests.schema import Severity
from app.modules.m05_campaigns import limits
from app.modules.m05_campaigns.models import ApprovalStatus, Campaign, CampaignRun, RunStatus
from app.modules.m06_findings.models import OPEN, Finding, FindingStatus
from app.modules.m08_remediation import gateways
from app.modules.m08_remediation.models import GatewayStatus, ShieldGateway
from app.modules.m09_reporting import api_keys

SHOWN = 5  # the panel's limit: more than five things to do is a list, not a pointer

# The order of each role's list: what stops work for somebody else comes first.
ORDER = {
    Role.SECURITY_ANALYST: (
        "paused_runs",
        "new_findings",
        "requires_confirmation",
        "awaiting_my_approval",
        "threat_model_drafts",
        "assigned_to_me",
    ),
    Role.TARGET_OWNER: (
        "assigned_to_me",
        "open_changes",
        "unverified_targets",
        "gateways_not_reporting",
    ),
    Role.SECURITY_MANAGER: (
        "scopes_to_approve",
        "awaiting_my_approval",
        "critical_findings",
        "usage_limit",
    ),
    Role.ORG_ADMIN: (
        "pending_invitations",
        "gateways_not_reporting",
        "usage_limit",
        "expiring_api_keys",
    ),
}


@dataclass
class Item:
    key: str
    count: int
    # What the one thing is when there is exactly one, so the panel can open it directly: a
    # campaign code, a run number or a target. Empty when there are several.
    one: dict = field(default_factory=dict)
    # Anything else the sentence needs, such as the share of a usage limit
    detail: dict = field(default_factory=dict)


def _count(db: Session, query) -> int:
    return db.scalar(select(func.count()).select_from(query.subquery())) or 0


# ---------------------------------------------------------------- findings (the Findings list)


def _findings(db: Session, organization_id: uuid.UUID, *conditions) -> int:
    """As the Findings list counts them: every finding of the organization that matches, on any
    target (Screen 38, UC-6.4)."""
    return _count(db, scoped_select(Finding, organization_id).where(*conditions))


def new_findings(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    return Item("new_findings", _findings(db, organization_id, Finding.status == FindingStatus.NEW))


def requires_confirmation(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    status = FindingStatus.REQUIRES_CONFIRMATION
    return Item("requires_confirmation", _findings(db, organization_id, Finding.status == status))


def assigned_to_me(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """The quick view "Assigned to me": open findings this person owns (FR-6.5, M6)."""
    mine = (Finding.status.in_(OPEN), Finding.owner_id == user_id)
    return Item("assigned_to_me", _findings(db, organization_id, *mine))


def critical_findings(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    critical = (Finding.status.in_(OPEN), Finding.severity == Severity.CRITICAL)
    return Item("critical_findings", _findings(db, organization_id, *critical))


# ---------------------------------------------------------------- campaigns (Screen 33)


def paused_runs(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """Campaign runs that are paused (UC-5.7): nothing is tested until somebody resumes or stops
    them. A retest's run has no campaign and no monitor of its own, so it isn't one of them."""
    rows = db.execute(
        select(Campaign.number, CampaignRun.number)
        .join(Campaign, Campaign.id == CampaignRun.campaign_id)
        .where(
            CampaignRun.organization_id == organization_id,
            CampaignRun.status == RunStatus.PAUSED,
        )
    ).all()
    one = {"campaign": f"C-{rows[0][0]:03d}", "number": rows[0][1]} if len(rows) == 1 else {}
    return Item("paused_runs", len(rows), one)


def scopes_to_approve(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """Campaigns waiting for a Security Manager's decision on their scope (FR-5.2, M5; UC-5.2).
    Nobody may decide on a campaign they created, so this person's own ones are left out."""
    codes = list(
        db.scalars(
            scoped_select(Campaign, organization_id)
            .where(
                Campaign.approval_status == ApprovalStatus.AWAITING_APPROVAL,
                Campaign.created_by_id.is_distinct_from(user_id),
            )
            .with_only_columns(Campaign.number)
        )
    )
    one = {"code": f"C-{codes[0]:03d}"} if len(codes) == 1 else {}
    return Item("scopes_to_approve", len(codes), one)


# ---------------------------------------------------------------- threat models (Screen 25)


def threat_model_drafts(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """Targets whose newest threat model version is a draft: what Threat Models calls "drafts
    await review" (UC-3.2). An archived target isn't listed there, so it isn't counted here."""
    newest = (
        select(ThreatModel.target_id, func.max(ThreatModel.version).label("version"))
        .group_by(ThreatModel.target_id)
        .subquery()
    )
    targets = list(
        db.scalars(
            select(ThreatModel.target_id)
            .join(
                newest,
                (ThreatModel.target_id == newest.c.target_id)
                & (ThreatModel.version == newest.c.version),
            )
            .join(Target, Target.id == ThreatModel.target_id)
            .where(
                Target.organization_id == organization_id,
                Target.status != TargetStatus.ARCHIVED,
                ThreatModel.status == ThreatModelStatus.DRAFT,
            )
        )
    )
    one = {"target_id": str(targets[0])} if len(targets) == 1 else {}
    return Item("threat_model_drafts", len(targets), one)


# ---------------------------------------------------------------- remediation (Screen 45)


def _remediation(db: Session, organization_id: uuid.UUID, membership: Membership):
    """Screen 45's own counts, asked as this person: "Awaiting my approval" depends on who reads
    it, because whoever last edited a version may not approve it (UC-8.3, 4a)."""
    from app.modules.m08_remediation import service as remediation

    reader = remediation.Reader(
        user_id=membership.user_id,
        can_request=allowed(membership.role, Action.REQUEST_REMEDIATIONS),
        can_approve=allowed(membership.role, Action.APPROVE_REMEDIATIONS),
    )
    return remediation.overview(db, organization_id, reader)


# ---------------------------------------------------------------- targets and Sentra Shield


def unverified_targets(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """Targets that can't be tested because their ownership isn't verified (FR-2.3, M2; UC-2.3)."""
    ids = list(
        db.scalars(
            scoped_select(Target, organization_id)
            .where(Target.status == TargetStatus.UNVERIFIED)
            .with_only_columns(Target.id)
        )
    )
    one = {"target_id": str(ids[0])} if len(ids) == 1 else {}
    return Item("unverified_targets", len(ids), one)


def gateways_not_reporting(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """Gateways that Sentra Shield shows as "Not reporting" (FR-8.3, M8; FR-10.6, M10): connected,
    but no heartbeat for three of its intervals. Screen 47 lists a gateway of an archived target
    only while its credential isn't revoked, and a revoked gateway is never "not reporting", so
    every gateway that is not reporting is on that page."""
    found = [
        gateway.target_id
        for gateway in db.scalars(
            scoped_select(ShieldGateway, organization_id).where(
                ShieldGateway.status.not_in((GatewayStatus.PENDING, GatewayStatus.REVOKED))
            )
        )
        if gateways.state_now(gateway) == GatewayStatus.NOT_REPORTING
    ]
    one = {"target_id": str(found[0])} if len(found) == 1 else {}
    return Item("gateways_not_reporting", len(found), one)


# ---------------------------------------------------------------- the organization


def pending_invitations(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """The tab "Pending invitations" of Members (UC-1.8): sent and not accepted, the expired ones
    among them, which can be sent again."""
    pending = invitations.pending(db, organization_id)
    now = datetime.now(UTC)
    expired = sum(1 for one in pending if one.expires_at <= now)
    return Item("pending_invitations", len(pending), detail={"expired": expired})


def usage_limit(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """A monthly limit at or past its warning threshold (FR-10.4, M10; UC-10.6): the moment the
    Organization Administrators and Security Managers are warned, and the warning stays true until
    the month ends. Counts the limits concerned; the detail names the fullest."""
    allowed_now = limits.limits_for(db, organization_id)
    used = limits.shares(allowed_now, limits.usage(db, organization_id))
    close = {kind: share for kind, share in used.items() if share >= allowed_now.warn_percent}
    if not close:
        return Item("usage_limit", 0)
    kind = max(close, key=lambda one: close[one])
    return Item(
        "usage_limit",
        len(close),
        detail={
            "kind": kind,
            "label": limits.KIND_LABELS[kind],
            "percent": close[kind],
            "resets": limits.next_month_label(),
        },
    )


def expiring_api_keys(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> Item:
    """Keys that API Keys marks "expires soon" (UC-9.6, 3a1): an integration stops working when
    its key expires."""
    keys = api_keys.keys_of(db, organization_id)
    expiring = sum(api_keys.state(key) == "expiring" for key in keys)
    return Item("expiring_api_keys", expiring, detail={"within_days": api_keys.SOON_DAYS})


COUNTS = {
    "new_findings": new_findings,
    "requires_confirmation": requires_confirmation,
    "assigned_to_me": assigned_to_me,
    "critical_findings": critical_findings,
    "paused_runs": paused_runs,
    "scopes_to_approve": scopes_to_approve,
    "threat_model_drafts": threat_model_drafts,
    "unverified_targets": unverified_targets,
    "gateways_not_reporting": gateways_not_reporting,
    "pending_invitations": pending_invitations,
    "usage_limit": usage_limit,
    "expiring_api_keys": expiring_api_keys,
}
FROM_REMEDIATION = {"awaiting_my_approval": "awaiting_me", "open_changes": "open_changes"}


def of(db: Session, membership: Membership) -> dict:
    """This person's list: the role's things in their order, those above zero, at most five,
    and how many more there were."""
    organization_id = membership.organization_id
    wanted = ORDER.get(Role(membership.role), ())
    overview = (
        _remediation(db, organization_id, membership)
        if any(key in FROM_REMEDIATION for key in wanted)
        else None
    )
    found: list[Item] = []
    for key in wanted:
        if key in FROM_REMEDIATION:
            item = Item(key, getattr(overview, FROM_REMEDIATION[key]))
        else:
            item = COUNTS[key](db, organization_id, membership.user_id)
        if item.count > 0:
            found.append(item)
    return {
        "role": membership.role,
        "items": [vars(item) for item in found[:SHOWN]],
        "more": max(0, len(found) - SHOWN),
    }
