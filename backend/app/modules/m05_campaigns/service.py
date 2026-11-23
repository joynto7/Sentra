"""Campaign creation (FR-5.1, UC-5.1): the checks of step 6, the estimate, saving.

Creating a campaign sends nothing to the target (UC-5.1, quality requirement). Launching and
runs are runs.py; the schedule of step 5 is scheduling.py.
"""

import re
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.tenancy import scoped_select
from app.llm.usage import cost_per_judged_attempt
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m04_tests.models import TestDefinition, TestSuite
from app.modules.m04_tests.schema import DetectionMethod
from app.modules.m04_tests.suites import ATTEMPTS_PER_TEST
from app.modules.m05_campaigns import approval, limits, scheduling
from app.modules.m05_campaigns.models import Campaign
from app.modules.m05_campaigns.window import clock_time

MAX_BUDGET = 100_000
MAX_REPETITIONS = 10
TYPE_NAME = {
    "chatbot": "chatbot",
    "rag_application": "RAG application",
    "tool_using_agent": "tool-using agent",
}


@dataclass
class CampaignInput:
    name: str = ""
    target_id: uuid.UUID | None = None
    suites: list[str] = field(default_factory=list)
    adaptive_agent: bool = False
    attempt_budget: int | None = None
    request_rate: int | None = None
    repetitions: int | None = 5
    window_start: str | None = None
    window_end: str | None = None
    time_zone: str = "UTC"
    # UC-5.1 step 5, for a campaign that runs at a time or on a recurring schedule (FR-5.3).
    # A campaign that runs immediately has no schedule: its first run is launched instead.
    schedule: scheduling.ScheduleInput | None = None


# ---------------------------------------------------------------- reading


def _visible(model, organization_id: uuid.UUID):
    return or_(model.organization_id.is_(None), model.organization_id == organization_id)


def _suites(db: Session, organization_id: uuid.UUID, codes: list[str]) -> dict[str, TestSuite]:
    """The current, active suites the organization can use, by code."""
    rows = db.scalars(
        select(TestSuite).where(
            TestSuite.code.in_(codes),
            TestSuite.is_current.is_(True),
            TestSuite.status == "active",
            _visible(TestSuite, organization_id),
        )
    )
    return {suite.code: suite for suite in rows}


def _target(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID | None) -> Target | None:
    if target_id is None:
        return None
    return db.scalar(scoped_select(Target, organization_id).where(Target.id == target_id))


def estimate(
    db: Session,
    organization_id: uuid.UUID,
    target_id: uuid.UUID | None,
    codes: list[str],
    budget: int | None,
) -> dict:
    """UC-5.1 step 6: the tests that will run against this target and the attempts they need.
    Tests that don't apply to the target's type, and retired tests, are skipped."""
    target = _target(db, organization_id, target_id)
    suites = _suites(db, organization_id, codes)
    wanted = list(dict.fromkeys(code for s in codes if s in suites for code in suites[s].tests))
    tests = db.scalars(
        select(TestDefinition).where(
            TestDefinition.code.in_(wanted),
            TestDefinition.is_current.is_(True),
            TestDefinition.retired.is_(False),
            _visible(TestDefinition, organization_id),
        )
    ).all()
    applicable = [t for t in tests if target is None or target.type in t.target_types]
    skipped = len(tests) - len(applicable)
    attempts = ATTEMPTS_PER_TEST * len(applicable)
    warnings = []
    if target is not None and skipped:
        kind = TYPE_NAME.get(target.type, target.type)
        one = skipped == 1
        warnings.append(
            f"{skipped} test{'' if one else 's'} {'doesn' if one else 'don'}'t apply to a {kind} "
            f"and {'is' if one else 'are'} skipped."
        )
    if budget and attempts > budget:
        warnings.append(
            "The budget is smaller than the estimate, so the run may stop before every test "
            "has run."
        )
    return {
        "tests": len(applicable),
        "skipped": skipped,
        # FR-5.2: the builder says so before the campaign is submitted (Screen 34)
        "requires_scope_approval": approval.required(db, organization_id),
        "estimated_attempts": attempts,
        "target_safe_rate": target.max_request_rate if target else None,
        # UC-5.1 step 2; None without an approved threat model (2a)
        "threat_model": _threat_model(db, organization_id, target, codes),
        # FR-10.4 on Screen 34: what this run may cost, and what the month has left
        "llm_cost": _llm_cost(db, organization_id, applicable),
        "monthly": _monthly(db, organization_id),
        "warnings": warnings,
    }


def _llm_cost(db: Session, organization_id: uuid.UUID, tests: list[TestDefinition]) -> dict:
    """UC-5.1 step 6 with FR-10.4: what the LLM judge of this run may cost, measured from the
    organization's own judged attempts of the last 30 days, as a range of ±20 %. With nothing to
    measure it says so; a price list per model would stop being true the moment a Platform
    Administrator switches the provider (FR-10.3)."""
    judged = [
        test
        for test in tests
        if any(m.get("method") == DetectionMethod.LLM_JUDGE for m in test.detection_methods)
    ]
    attempts = ATTEMPTS_PER_TEST * len(judged)
    each = cost_per_judged_attempt(db, organization_id)
    if each is None or not attempts:
        return {"judged_attempts": attempts, "low_usd": None, "high_usd": None}
    total = each * attempts
    cent = Decimal("0.01")
    return {
        "judged_attempts": attempts,
        "low_usd": (total * Decimal("0.8")).quantize(cent),
        "high_usd": (total * Decimal("1.2")).quantize(cent),
    }


def _monthly(db: Session, organization_id: uuid.UUID) -> dict:
    """UC-10.6 step 1 as the builder shows it (FR-10.4): this month's usage against the limits, so
    a campaign is planned knowing what is left."""
    in_force = limits.limits_for(db, organization_id)
    used = limits.usage(db, organization_id)
    shares = limits.shares(in_force, used)
    return {
        "warn_percent": in_force.warn_percent,
        "limits": [
            {
                "kind": kind,
                "label": limits.KIND_LABELS[kind],
                "used": amount,
                "limit": limit,
                "percent": shares[kind],
                "reached": shares[kind] >= 100,
                "warning": in_force.warn_percent <= shares[kind] < 100,
            }
            for kind, amount, limit in (
                ("campaign_runs", Decimal(used.campaign_runs), Decimal(in_force.campaign_runs)),
                ("attempts", Decimal(used.attempts), Decimal(in_force.attempts)),
                ("llm_cost", used.llm_cost_usd, in_force.llm_cost_usd),
            )
        ],
    }


def _threat_model(
    db: Session, organization_id: uuid.UUID, target: Target | None, codes: list[str]
) -> dict | None:
    if target is None:
        return None
    from app.modules.m03_threat_models.recommendations import campaign_brief

    return campaign_brief(db, organization_id, target, codes)


def list_campaigns(
    db: Session, organization_id: uuid.UUID, suite: str = "", target_id: uuid.UUID | None = None
) -> list[dict]:
    """The campaigns page (Screen 33). `suite` gives the campaigns that use a suite (UC-4.5)."""
    query = scoped_select(Campaign, organization_id).order_by(Campaign.number.desc())
    if suite:
        query = query.where(Campaign.suites.contains([suite]))
    if target_id:
        query = query.where(Campaign.target_id == target_id)
    campaigns = db.scalars(query).all()
    targets = {t.id: t for t in db.scalars(scoped_select(Target, organization_id))}
    creators = dict(
        db.execute(
            select(User.id, User.name).where(User.id.in_({c.created_by_id for c in campaigns}))
        ).all()
    )
    schedules = scheduling.views(db, list(campaigns))
    return [
        _row(c, targets.get(c.target_id), creators.get(c.created_by_id), schedules.get(c.id))
        for c in campaigns
    ]


def get_campaign(db: Session, organization_id: uuid.UUID, code: str) -> dict:
    match = re.fullmatch(r"C-(\d{1,9})", code)
    campaign = (
        db.scalar(
            scoped_select(Campaign, organization_id).where(Campaign.number == int(match.group(1)))
        )
        if match
        else None
    )
    if campaign is None:  # also another organization's campaign (NFR-3.3)
        raise NotFoundError("Campaign not found.")
    target = db.get(Target, campaign.target_id)
    creator = db.get(User, campaign.created_by_id) if campaign.created_by_id else None
    suites = _suites(db, organization_id, campaign.suites)
    return {
        **_row(campaign, target, creator.name if creator else None, scheduling.view(db, campaign)),
        "adaptive_agent": campaign.adaptive_agent,
        "repetitions": campaign.repetitions,
        "window_start": campaign.window_start,
        "window_end": campaign.window_end,
        "time_zone": campaign.time_zone,
        "suites": [
            {
                "code": code,
                "found": code in suites,
                "name": suites[code].name if code in suites else code,
                "version": suites[code].version if code in suites else 0,
                "test_count": len(suites[code].tests) if code in suites else 0,
            }
            for code in campaign.suites
        ],
        "estimate": estimate(
            db, organization_id, campaign.target_id, campaign.suites, campaign.attempt_budget
        ),
        "based_on_threat_model": _version(db, campaign.threat_model_id),
        # FR-5.2: the decision in force, for the campaign's page and Screen 35
        "approval_decision": approval.decided_by(db, campaign),
    }


def _version(db: Session, threat_model_id: uuid.UUID | None) -> int | None:
    if threat_model_id is None:
        return None
    from app.modules.m03_threat_models.models import ThreatModel

    model = db.get(ThreatModel, threat_model_id)
    return model.version if model else None


def _row(
    campaign: Campaign,
    target: Target | None,
    creator: str | None,
    schedule: dict | None = None,
) -> dict:
    return {
        "code": campaign.code,
        "name": campaign.name,
        "target": {
            "id": target.id,
            "name": target.name,
            "type": target.type,
            "environment": target.environment,
            "status": target.status,
            "max_request_rate": target.max_request_rate,
        }
        if target
        else None,
        "suite_count": len(campaign.suites),
        "attempt_budget": campaign.attempt_budget,
        "request_rate": campaign.request_rate,
        "approval_status": campaign.approval_status,
        "schedule": schedule,  # FR-5.3: when it runs by itself, and what came of the last moment
        "created_by": creator,
        "created_at": campaign.created_at,
    }


# ---------------------------------------------------------------- creating


def check(db: Session, organization_id: uuid.UUID, data: CampaignInput) -> dict:
    """UC-5.1 step 6 and 6a: every problem at once, each naming the limit that is exceeded."""
    errors: list[dict] = []

    def problem(field_name: str, message: str) -> None:
        errors.append({"field": field_name, "message": message})

    name = data.name.strip()
    if not name:
        problem("name", "Enter a name.")
    elif not 3 <= len(name) <= 120:
        problem("name", "Use 3 to 120 characters.")

    target = _target(db, organization_id, data.target_id)
    if data.target_id is None:
        problem("target_id", "Choose a target.")
    elif target is None:
        problem("target_id", "Target not found.")
    elif target.status == TargetStatus.ARCHIVED:
        problem("target_id", "This target is archived, so it can't be tested.")
    elif target.status != TargetStatus.VERIFIED:
        problem("target_id", "Verify the ownership of this target first.")

    codes = list(dict.fromkeys(code.strip() for code in data.suites))
    suites = _suites(db, organization_id, codes)
    if not codes:
        problem("suites", "Choose at least one test suite.")
    elif missing := [c for c in codes if c not in suites]:
        problem("suites", f"Not found or archived: {', '.join(missing)}.")
    elif target is not None and not estimate(db, organization_id, target.id, codes, None)["tests"]:
        kind = TYPE_NAME.get(target.type, target.type)
        problem("suites", f"None of these suites' tests apply to a {kind}. Choose other suites.")

    budget, rate, repetitions = data.attempt_budget, data.request_rate, data.repetitions
    if budget is None:
        problem("attempt_budget", "Enter the attempt budget.")
    elif not 1 <= budget <= MAX_BUDGET:
        problem("attempt_budget", f"Enter 1 to {MAX_BUDGET:,} attempts.")
    if rate is None:
        problem("request_rate", "Enter the maximum request rate.")
    elif rate < 1:
        problem("request_rate", "Enter at least 1 request per minute.")
    elif target is not None and rate > target.max_request_rate:
        # FR-5.7: never faster than the rate its owner registered as safe.
        problem(
            "request_rate",
            "The rate can't exceed the target's safe rate of "
            f"{target.max_request_rate} per minute.",
        )
    if repetitions is None or not 1 <= repetitions <= MAX_REPETITIONS:
        problem("repetitions", f"Enter 1 to {MAX_REPETITIONS} repetitions.")

    start = end = None
    try:
        start, end = clock_time(data.window_start), clock_time(data.window_end)
    except ValueError:
        problem("window", "Enter the times as hours and minutes, such as 02:00.")
    else:
        if (start is None) != (end is None):
            problem("window", "Enter both the start and the end, or neither.")
        elif start is not None and start == end:
            problem("window", "The window must be longer than zero minutes.")
    try:
        ZoneInfo(data.time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        problem("time_zone", "Unknown time zone.")

    if errors:
        raise AppError(
            "Some fields are invalid.", code="validation_error", status_code=422, details=errors
        )
    return {
        "name": name,
        "target_id": target.id,
        "suites": codes,
        "adaptive_agent": data.adaptive_agent,
        "attempt_budget": budget,
        "request_rate": rate,
        "repetitions": repetitions,
        "window_start": start,
        "window_end": end,
        "time_zone": data.time_zone,
    }


def create(db: Session, membership: Membership, data: CampaignInput) -> Campaign:
    """UC-5.1 step 7: saved with its schedule, ready to run. The schedule is checked before
    anything is saved, so an impossible one saves no campaign either."""
    checked = check(db, membership.organization_id, data)
    planned = (
        scheduling.check(ZoneInfo(checked["time_zone"]), data.schedule)
        if data.schedule is not None
        else None
    )
    number = (
        db.scalar(
            select(func.max(Campaign.number)).where(
                Campaign.organization_id == membership.organization_id
            )
        )
        or 0
    ) + 1
    from app.modules.m03_threat_models.recommendations import newest_approved

    approved = newest_approved(db, checked["target_id"])
    campaign = Campaign(
        organization_id=membership.organization_id,
        number=number,
        created_by_id=membership.user_id,
        # FR-3.3: the threat model version the campaign is based on
        threat_model_id=approved.id if approved else None,
        # FR-5.2: where the organization requires it, creating a campaign submits its scope
        approval_status=approval.initial_status(db, membership.organization_id),
        **checked,
    )
    db.add(campaign)
    try:
        db.flush()
        if planned is not None:
            scheduling.write(db, membership, campaign, planned)
        db.commit()
    except IntegrityError as exc:  # someone saved a campaign at the same moment
        db.rollback()
        raise ConflictError("Another campaign was saved at the same moment. Save again.") from exc
    approval.after_created(db, membership, campaign)  # UC-5.2 step 1, if approval is required
    return campaign
