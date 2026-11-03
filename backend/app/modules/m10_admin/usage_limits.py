"""Each organization's monthly usage against its limits (FR-10.4, UC-10.6, Screen 61), for
Platform Administrators. Module 10's operations part (Joynto).

The limits themselves live on the organization and are enforced in `m05_campaigns/limits.py`,
which checks them when a campaign run is launched and before every attempt. This file is what the
page does: show every organization's month, and set the limits of one.

Nothing here reads an organization's content — only how much it used and what it may use
(NFR-3.3), which is what the notice on the page says.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.models import Organization
from app.modules.m01_users.models import Membership, MembershipStatus, User
from app.modules.m05_campaigns import limits as campaign_limits
from app.modules.m05_campaigns.models import UsageLimitWarning

ACTION = "platform.usage_limits_changed"
ONLY_USAGE = "Platform Administrators see usage and limits only, never an organization's content."
WARN_AT = (
    "Organization Administrators and Security Managers are warned at the threshold; no new runs "
    "start once a limit is reached."
)
MIN_WARN, MAX_WARN = 50, 99
TOO_LOW = "A limit cannot be negative."
WARN_RANGE = f"Warn at {MIN_WARN} to {MAX_WARN} per cent of a limit."


@dataclass
class LimitRow:
    kind: str
    label: str
    used: Decimal  # a count, or the cost in USD
    limit: Decimal
    percent: int
    reached: bool
    warning: bool  # at or above the warning threshold, but not reached
    custom: bool  # a Platform Administrator set this limit; otherwise it is the default
    warned_at: datetime | None  # when the organization was warned this month, if it was


@dataclass
class OrganizationRow:
    id: uuid.UUID
    name: str
    slug: str
    members: int
    warn_percent: int
    warn_percent_custom: bool
    limits: list[LimitRow]
    status: str  # "active" or "limited"
    next_month: str  # "1 December", when the month's usage starts again


@dataclass
class Overview:
    organizations: list[OrganizationRow]
    defaults: dict[str, Decimal]
    warn_percent_default: int
    notice: str = ONLY_USAGE
    warn_at: str = WARN_AT


@dataclass
class NewLimits:
    campaign_runs: int
    attempts: int
    llm_cost_usd: Decimal
    warn_percent: int


def _members(db: Session) -> dict[uuid.UUID, int]:
    rows = db.execute(
        select(Membership.organization_id, func.count())
        .where(Membership.status == MembershipStatus.ACTIVE)
        .group_by(Membership.organization_id)
    )
    return dict(rows.all())


def _warned(db: Session) -> dict[tuple[uuid.UUID, str], datetime]:
    """When each organization was warned about each limit this month (UC-10.6 step 5)."""
    rows = db.scalars(
        select(UsageLimitWarning).where(UsageLimitWarning.month == campaign_limits.month_start())
    )
    return {(row.organization_id, row.kind): row.sent_at for row in rows}


def _row(
    organization: Organization,
    members: int,
    used: campaign_limits.Usage,
    warned: dict[tuple[uuid.UUID, str], datetime],
) -> OrganizationRow:
    in_force = campaign_limits.of(
        organization.limit_campaign_runs,
        organization.limit_attempts,
        organization.limit_llm_cost_usd,
        organization.limit_warn_percent,
    )
    amounts = {
        "campaign_runs": (Decimal(used.campaign_runs), Decimal(in_force.campaign_runs)),
        "attempts": (Decimal(used.attempts), Decimal(in_force.attempts)),
        "llm_cost": (used.llm_cost_usd, in_force.llm_cost_usd),
    }
    custom = {
        "campaign_runs": organization.limit_campaign_runs is not None,
        "attempts": organization.limit_attempts is not None,
        "llm_cost": organization.limit_llm_cost_usd is not None,
    }
    rows = []
    for kind, (amount, limit) in amounts.items():
        percent = campaign_limits.share(amount, limit)
        rows.append(
            LimitRow(
                kind=kind,
                label=campaign_limits.KIND_LABELS[kind],
                used=amount,
                limit=limit,
                percent=percent,
                reached=percent >= 100,
                warning=in_force.warn_percent <= percent < 100,
                custom=custom[kind],
                warned_at=warned.get((organization.id, kind)),
            )
        )
    return OrganizationRow(
        id=organization.id,
        name=organization.name,
        slug=organization.slug,
        members=members,
        warn_percent=in_force.warn_percent,
        warn_percent_custom=organization.limit_warn_percent is not None,
        limits=rows,
        status="limited" if any(row.reached for row in rows) else "active",
        next_month=campaign_limits.next_month_label(),
    )


def overview(db: Session) -> Overview:
    """Screen 61: every organization's usage this month against its limits."""
    members, warned = _members(db), _warned(db)
    organizations = db.scalars(select(Organization).order_by(Organization.name)).all()
    default = campaign_limits.defaults()
    return Overview(
        organizations=[
            _row(
                organization,
                members.get(organization.id, 0),
                campaign_limits.usage(db, organization.id),
                warned,
            )
            for organization in organizations
        ],
        defaults={
            "campaign_runs": Decimal(default.campaign_runs),
            "attempts": Decimal(default.attempts),
            "llm_cost": default.llm_cost_usd,
        },
        warn_percent_default=default.warn_percent,
    )


def organization_row(db: Session, organization_id: uuid.UUID) -> OrganizationRow:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise NotFoundError("This organization does not exist.")
    return _row(
        organization,
        _members(db).get(organization_id, 0),
        campaign_limits.usage(db, organization_id),
        _warned(db),
    )


def below_usage(row: OrganizationRow, new: NewLimits) -> list[str]:
    """UC-10.6, 2a: the limits the organization has already used up with the new numbers. Each
    sentence says what it means, so the confirmation is an informed one."""
    wanted = {
        "campaign_runs": Decimal(new.campaign_runs),
        "attempts": Decimal(new.attempts),
        "llm_cost": new.llm_cost_usd,
    }
    said = []
    for limit in row.limits:
        if limit.used < wanted[limit.kind]:
            continue
        money = limit.kind == "llm_cost"
        amount = f"${wanted[limit.kind]:,.2f}" if money else f"{wanted[limit.kind]:,.0f}"
        used = f"${limit.used:,.2f}" if money else f"{limit.used:,.0f}"
        said.append(
            f"The new {limit.label} limit ({amount}) is at or below this month's usage ({used}). "
            f"No new work can start until {row.next_month}."
        )
    return said


def save(
    db: Session,
    admin: User,
    organization_id: uuid.UUID,
    new: NewLimits,
    *,
    confirmed: bool = False,
) -> OrganizationRow:
    """UC-10.6 steps 2-4 and 2a1: the limits apply at once, because every launch and every attempt
    reads them, and the change goes to the platform audit log. A limit below this month's usage is
    allowed — a Platform Administrator may have to stop an organization that is costing too much —
    but only after the consequence has been stated and confirmed."""
    if min(new.campaign_runs, new.attempts) < 0 or new.llm_cost_usd < 0:
        raise FieldValidationError("campaign_runs", TOO_LOW)
    if not MIN_WARN <= new.warn_percent <= MAX_WARN:
        raise FieldValidationError("warn_percent", WARN_RANGE)

    organization = db.get(Organization, organization_id)
    if organization is None:
        raise NotFoundError("This organization does not exist.")
    row = organization_row(db, organization_id)
    consequences = below_usage(row, new)
    if consequences and not confirmed:
        raise ConflictError(" ".join(consequences), code="below_this_months_usage")

    before = {
        "campaign_runs": organization.limit_campaign_runs,
        "attempts": organization.limit_attempts,
        "llm_cost_usd": organization.limit_llm_cost_usd,
        "warn_percent": organization.limit_warn_percent,
    }
    organization.limit_campaign_runs = new.campaign_runs
    organization.limit_attempts = new.attempts
    organization.limit_llm_cost_usd = new.llm_cost_usd
    organization.limit_warn_percent = new.warn_percent
    audit.record(
        db,
        organization_id=None,  # a platform action: it is not the organization's own change
        actor=admin,
        action=ACTION,
        summary=f"Set the monthly limits of {organization.name}",
        item=audit.Item("organization", organization.id, organization.name),
        details={
            "before": {
                key: str(value) if value is not None else None for key, value in before.items()
            },
            "after": {
                "campaign_runs": new.campaign_runs,
                "attempts": new.attempts,
                "llm_cost_usd": str(new.llm_cost_usd),
                "warn_percent": new.warn_percent,
            },
            **({"consequences": consequences} if consequences else {}),
        },
    )
    db.commit()
    return organization_row(db, organization_id)
