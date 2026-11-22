"""The Shield Policy versions of a target and their deployment (FR-8.3, UC-8.4).

Every rule of a policy comes from one fix of a remediation **a person approved** (NFR-9.3): Sentra
never invents a rule, and the only thing it adds by itself is the shape the gateway can read. A
deployment always writes a new version and changes no earlier one, so any version can be rolled
back to later (quality requirement 1, FR-8.6).

What a gateway can carry depends on where it sits (UC-8.1 step 1), because it can only act on
traffic it sees:

* `in_front` — between the users and the application: the text of a request and of an answer.
* `before_model` — between the application and its LLM provider: the prompt, the retrieved
  context, the answer and the tool calls in it.

A fix whose rule this gateway cannot carry stays a change inside the application (UC-8.2, 6a) and
is listed with the reason, so the developer sees what is left for them.

The terms a text guardrail matches are written by a person, never by Sentra or by a model: the
approved fix says what should be filtered in plain language, and the developer gives the exact
terms when the version is deployed (UC-8.4 step 1). A fix without them is listed as waiting for
them, and the rest of the version is deployed without it.
"""

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target
from app.modules.m06_findings.models import Finding, FindingStatus
from app.modules.m08_remediation import changes, gateways, retest
from app.modules.m08_remediation.models import (
    FixKind,
    PolicySource,
    PolicyState,
    Remediation,
    RemediationFix,
    RemediationStatus,
    RuleKind,
    ShieldGateway,
    ShieldPolicy,
)

# What a gateway in each position can enforce, so a fix is only ever promised where it works.
CARRIES = {
    "in_front": (RuleKind.TEXT_GUARDRAIL,),
    "before_model": (
        RuleKind.TEXT_GUARDRAIL,
        RuleKind.TOOL_APPROVAL,
        RuleKind.RETRIEVAL_REPORT,
        RuleKind.SYSTEM_PROMPT,
    ),
}
# One fix kind becomes one rule kind.
RULE_OF_FIX = {
    FixKind.GUARDRAIL: RuleKind.TEXT_GUARDRAIL,
    FixKind.TOOL_POLICY: RuleKind.TOOL_APPROVAL,
    FixKind.RETRIEVAL_ISOLATION: RuleKind.RETRIEVAL_REPORT,
    FixKind.SYSTEM_PROMPT: RuleKind.SYSTEM_PROMPT,
}
IN_FRONT_ONLY_SEES_TEXT = (
    "This gateway stands in front of the endpoint, so it doesn't see the model traffic this fix "
    "is about. Put the gateway between the application and its model, or make the change in the "
    "application."
)
NEEDS_TERMS = (
    "Give the terms this guardrail matches when you deploy the policy: Sentra never writes them "
    "for you."
)
# The three things a person or a retest can see of a policy at work, exactly as the gateway writes
# them (shield/app/enforce.py: BLOCKED_MESSAGE, MASK, HELD_BACK). A retest reads the last two out
# of an answer to tell a request the policy changed from one it left alone (FR-8.5); the gateway
# never says more than this about what it did, and these three strings have to stay in step with
# it, which a test of both sides checks.
GUARDRAIL_MESSAGE = "This request can't be handled."
MASK = "[removed]"
HELD_BACK = "A Sentra Shield policy holds this tool call back until a person approves it."
APPLIES_TO = ("input", "output")
ACTIONS = ("block", "mask")
MAX_RULES = 50  # a rule policy adds at most 50 ms of median latency (NFR-1.5)
MAX_TERMS_PER_RULE = 20
MAX_TERMS = 200
MAX_TERM = 200
MAX_PROMPT = 4000
MAX_DOCUMENT = 64 * 1024
MAX_OFFERS = 3  # three windows without a confirmation is a failed deployment (4a1)


def _now() -> datetime:
    return datetime.now(UTC)


def _reason(exc) -> str:
    """What to tell a person about a refusal: a field error keeps its sentence in its details."""
    details = getattr(exc, "details", None)
    if details:
        return str(details[0].get("message", exc.message))
    return exc.message


# ---------------------------------------------------------------- reading the versions


def current(db: Session, target_id: uuid.UUID) -> ShieldPolicy | None:
    """The version the gateway is enforcing."""
    return db.scalar(
        select(ShieldPolicy).where(
            ShieldPolicy.target_id == target_id, ShieldPolicy.state == PolicyState.ACTIVE
        )
    )


def waiting(db: Session, target_id: uuid.UUID) -> ShieldPolicy | None:
    """The version the gateway has been offered and has not confirmed yet (step 3)."""
    return db.scalar(
        select(ShieldPolicy).where(
            ShieldPolicy.target_id == target_id, ShieldPolicy.state == PolicyState.PENDING
        )
    )


def versions(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> list[ShieldPolicy]:
    return list(
        db.scalars(
            scoped_select(ShieldPolicy, organization_id)
            .where(ShieldPolicy.target_id == target_id)
            .order_by(ShieldPolicy.version.desc())
        )
    )


def version_row(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID, version: int):
    row = db.scalar(
        scoped_select(ShieldPolicy, organization_id).where(
            ShieldPolicy.target_id == target_id, ShieldPolicy.version == version
        )
    )
    if row is None:
        raise NotFoundError(f"This target has no policy version {version}.")
    return row


def _next_version(db: Session, target_id: uuid.UUID) -> int:
    highest = db.scalar(
        select(ShieldPolicy.version)
        .where(ShieldPolicy.target_id == target_id)
        .order_by(ShieldPolicy.version.desc())
        .limit(1)
    )
    return (highest or 0) + 1


# ---------------------------------------------------------------- step 1: the new version


def rules_of_fix(
    fix: RemediationFix,
    position: str,
    *,
    finding_code: str,
    remediation_version: int,
    guardrail: dict | None,
) -> tuple[list[dict], str | None]:
    """The rules one approved fix becomes, or the reason it stays the application's work.

    Everything in a rule comes from the fix a person approved — its title, the tool or source it
    names, the sentences of a hardened prompt — except the terms of a text guardrail, which the
    person gives with `guardrail` when they deploy.
    """
    kind = FixKind(fix.kind)
    rule_kind = RULE_OF_FIX.get(kind)
    if rule_kind is None:
        return [], "A code change is made in the application."
    if rule_kind not in CARRIES[position]:
        return [], IN_FRONT_ONLY_SEES_TEXT
    source = {"finding": finding_code, "version": remediation_version, "fix": fix.position}
    head = {"kind": rule_kind.value, "title": fix.title, "from": source}

    if rule_kind == RuleKind.TEXT_GUARDRAIL:
        terms = [str(one).strip() for one in (guardrail or {}).get("terms") or []]
        terms = [one for one in terms if one]
        if not terms:
            return [], NEEDS_TERMS
        applies_to = str((guardrail or {}).get("applies_to") or "output")
        action = str((guardrail or {}).get("action") or "block")
        message = str((guardrail or {}).get("message") or "").strip() or GUARDRAIL_MESSAGE
        return [
            {
                **head,
                "applies_to": applies_to,
                "action": action,
                "terms": terms[:MAX_TERMS_PER_RULE],
                "message": message[:300],
                # The sentences the proposal gave, so a person reading the version knows why
                "note": " ".join(fix.details.get("rules") or [])[:300],
            }
        ], None

    if rule_kind == RuleKind.TOOL_APPROVAL:
        made = [
            {
                **head,
                "tool": str(one.get("tool", "")).strip()[:120],
                "note": str(one.get("rule", ""))[:300],
            }
            for one in fix.details.get("tools") or []
            if isinstance(one, dict) and str(one.get("tool", "")).strip()
        ]
        return (made, None) if made else ([], "This fix names no tool the gateway could hold back.")

    if rule_kind == RuleKind.RETRIEVAL_REPORT:
        made = [
            {
                **head,
                "source": str(one.get("source", "")).strip()[:120],
                "note": str(one.get("rule", ""))[:300],
            }
            for one in fix.details.get("sources") or []
            if isinstance(one, dict) and str(one.get("source", "")).strip()
        ]
        return (
            (made, None)
            if made
            else ([], "This fix names no knowledge source the gateway could watch for.")
        )

    text = str(fix.details.get("prompt") or "").strip()
    if not text:
        return [], "This fix has no prompt to add."
    return [{**head, "text": text[:MAX_PROMPT], "mode": "append"}], None


def build(
    db: Session,
    target: Target,
    gateway: ShieldGateway,
    remediation: Remediation,
    finding: Finding,
    *,
    guardrails: dict[int, dict] | None = None,
) -> tuple[dict, list[dict], list[dict], int]:
    """Step 1: the approved fixes and the current policy become the next version's document.

    The rules of an earlier version stay as they are, except the ones that came from **this**
    finding: a revised remediation for a finding replaces what the finding put in the policy
    before, so an old rule of a weakness never outlives the fix that replaced it.
    """
    before = current(db, target.id)
    kept = [
        rule
        for rule in ((before.document or {}).get("rules") if before else []) or []
        if (rule.get("from") or {}).get("finding") != finding.code
    ]
    made: list[dict] = []
    left: list[dict] = []
    for fix in remediation.fixes:
        rules, reason = rules_of_fix(
            fix,
            gateway.position,
            finding_code=finding.code,
            remediation_version=remediation.version,
            guardrail=(guardrails or {}).get(fix.position),
        )
        made.extend(rules)
        if reason:
            left.append({"fix": fix.position, "title": fix.title, "reason": reason})
    rules = _without_duplicates(kept + made)
    for number, rule in enumerate(rules, start=1):
        rule["id"] = f"r{number}"
    sources = _sources_of(rules)
    return {"rules": rules}, sources, left, len(kept)


def _without_duplicates(rules: list[dict]) -> list[dict]:
    """The same rule twice is kept once: two findings can ask for the same tool or term."""
    seen: set[str] = set()
    unique = []
    for rule in rules:
        key = json.dumps({k: v for k, v in rule.items() if k not in ("id", "from")}, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        unique.append(rule)
    return unique


def _sources_of(rules: list[dict]) -> list[dict]:
    """Which remediation each rule of the version came from, for Screen 49 and the audit entry."""
    by_finding: dict[tuple[str, int], list[int]] = {}
    for rule in rules:
        where = rule.get("from") or {}
        key = (str(where.get("finding")), int(where.get("version") or 0))
        by_finding.setdefault(key, [])
        if where.get("fix") not in by_finding[key]:
            by_finding[key].append(where.get("fix"))
    return [
        {"finding": finding, "version": version, "fixes": sorted(fixes)}
        for (finding, version), fixes in by_finding.items()
    ]


# ---------------------------------------------------------------- step 2: is it deployable?


def errors_of(document: dict) -> list[str]:
    """Step 2: a version is only deployed when every rule is well formed, no two rules contradict
    each other, and the whole policy stays small enough to be matched on every request (NFR-1.5)."""
    rules = (document or {}).get("rules")
    if not isinstance(rules, list):
        return ["The policy has no rules."]
    found: list[str] = []
    if len(rules) > MAX_RULES:
        found.append(f"A policy may hold at most {MAX_RULES} rules; this one has {len(rules)}.")
    if len(json.dumps(document)) > MAX_DOCUMENT:
        found.append("The policy is too large to send to a gateway.")
    terms_total = 0
    actions: dict[tuple[str, str], str] = {}
    for rule in rules:
        title = rule.get("title") or rule.get("id") or "a rule"
        kind = rule.get("kind")
        if kind not in tuple(RuleKind):
            found.append(f"{title}: {kind} is not a kind of rule a gateway knows.")
            continue
        if kind == RuleKind.TEXT_GUARDRAIL:
            terms = rule.get("terms") or []
            terms_total += len(terms)
            if not terms:
                found.append(f"{title}: a guardrail rule needs at least one term.")
            if any(len(str(one)) > MAX_TERM or len(str(one).strip()) < 2 for one in terms):
                found.append(f"{title}: every term must be 2 to {MAX_TERM} characters long.")
            if rule.get("applies_to") not in APPLIES_TO:
                found.append(f"{title}: a guardrail applies to the input or to the output.")
            if rule.get("action") not in ACTIONS:
                found.append(f"{title}: a guardrail rule blocks or masks.")
            for term in terms:
                key = (str(rule.get("applies_to")), str(term).lower())
                before = actions.get(key)
                if before and before != rule.get("action"):
                    found.append(
                        f"{title}: the same term is {before} by one rule and "
                        f"{rule.get('action')} by another. Decide on one."
                    )
                actions[key] = str(rule.get("action"))
        elif kind == RuleKind.TOOL_APPROVAL and not str(rule.get("tool") or "").strip():
            found.append(f"{title}: a tool rule needs the name of the tool.")
        elif kind == RuleKind.RETRIEVAL_REPORT and not str(rule.get("source") or "").strip():
            found.append(f"{title}: a retrieval rule needs the name of the knowledge source.")
        elif kind == RuleKind.SYSTEM_PROMPT and not str(rule.get("text") or "").strip():
            found.append(f"{title}: a system prompt rule needs its text.")
    if terms_total > MAX_TERMS:
        found.append(
            f"A policy may match at most {MAX_TERMS} terms in all; this one would match "
            f"{terms_total}, which would slow every request down (NFR-1.5)."
        )
    return found


# ---------------------------------------------------------------- steps 3 to 5: deploying it


def deploy(
    db: Session,
    organization_id: uuid.UUID,
    user: User | None,
    *,
    finding: Finding,
    remediation: Remediation,
    guardrails: dict[int, dict] | None = None,
    at: datetime | None = None,
    approver_id: uuid.UUID | None = None,
) -> tuple[ShieldPolicy, list[dict]]:
    """UC-8.4 steps 1-3: the new version is built, validated and offered to the gateway — or kept
    until the time that was chosen (1a). Returns the version and the fixes that stay the
    application's work."""
    target = db.scalar(scoped_select(Target, organization_id).where(Target.id == finding.target_id))
    if target is None:
        raise NotFoundError("That target doesn't exist.")
    if remediation.status not in (RemediationStatus.APPROVED, RemediationStatus.APPLYING):
        raise ConflictError(
            "Only an approved remediation is deployed to a gateway (UC-8.3).",
            code="not_approved",
        )
    gateway = gateways.active(db, target.id)
    if gateway is None:
        raise ConflictError(
            "This target has no Sentra Shield gateway in its traffic path, so there is nothing to "
            "deploy a policy to (UC-8.1).",
            code="no_active_gateway",
        )
    if waiting(db, target.id) is not None:
        raise ConflictError(
            "The gateway has not confirmed the version before this one yet.",
            code="deployment_in_progress",
        )
    before = current(db, target.id)
    document, sources, left, carried = build(
        db, target, gateway, remediation, finding, guardrails=guardrails
    )
    if not document["rules"]:
        raise ConflictError(
            "None of the approved fixes can be enforced by this gateway, so there is no policy to "
            "deploy. They stay a change inside the application (UC-8.5).",
            code="nothing_to_enforce",
        )
    found = errors_of(document)
    if found:
        # 2a1: nothing is deployed and the developer is told what is wrong with it.
        raise FieldValidationError("rules", " ".join(found))
    # The fixes this version carries are the gateway's work now, and the ones it could not take
    # are the developer's (UC-8.5 step 1, FR-8.4).
    changes.reconcile(
        db,
        finding,
        remediation,
        carried={
            int((rule.get("from") or {}).get("fix") or 0)
            for rule in document["rules"]
            if str((rule.get("from") or {}).get("finding")) == finding.code
            and int((rule.get("from") or {}).get("version") or 0) == remediation.version
        },
        left=left,
    )

    later = at is not None and at > _now()
    policy = ShieldPolicy(
        organization_id=organization_id,
        target_id=target.id,
        version=_next_version(db, target.id),
        state=PolicyState.SCHEDULED if later else PolicyState.PENDING,
        source=PolicySource.REMEDIATION,
        document=document,
        rule_count=len(document["rules"]),
        carried_over=carried,
        sources=sources,
        based_on_version=before.version if before else None,
        trigger_finding=finding.code,
        trigger_version=remediation.version,
        approved_by_id=approver_id or remediation.decided_by_id,
        deployed_by_id=user.id if user else None,
        deploy_at=at if later else None,
        offered_at=None if later else _now(),
    )
    db.add(policy)
    remediation.status = RemediationStatus.APPLYING
    db.flush()
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="shield_policy.scheduled" if later else "shield_policy.deploying",
        summary=(
            f"Version {policy.version} of the Sentra Shield policy of {target.name} "
            f"({policy.rule_count} rules, from {finding.code}) "
            + (
                f"is deployed at {at:%Y-%m-%d %H:%M} UTC"
                if later
                else "is on its way to the gateway"
            )
        ),
        item=audit.Item("shield_policy", policy.id, f"{target.name}, version {policy.version}"),
        details={
            "version": policy.version,
            "rules": policy.rule_count,
            "carried_over": carried,
            "finding": finding.code,
            "remediation_version": remediation.version,
            "deploy_at": at.isoformat() if later else None,
        },
    )
    # NFR-2.4: the version, the state of the remediation and the audit entry are one transaction.
    db.commit()
    db.refresh(policy)
    return policy, left


def after_approval(
    db: Session, finding: Finding, remediation: Remediation, approver: User
) -> ShieldPolicy | None:
    """UC-8.3 step 6: an approved proposal whose fixes a gateway can carry becomes the target's
    next policy version at once. Everything that stops that — no gateway, no terms for a
    guardrail, a rule that does not validate — leaves the proposal approved and tells the people
    who worked on it what is still needed; it never breaks the approval itself.
    """
    try:
        policy, left = deploy(
            db,
            finding.organization_id,
            approver,
            finding=finding,
            remediation=remediation,
            approver_id=approver.id,
        )
    except (ConflictError, FieldValidationError) as exc:
        _tell(db, finding, remediation, text=f"Nothing was deployed: {_reason(exc)}")
        return None
    waiting_for = [one["title"] for one in left]
    _tell(
        db,
        finding,
        remediation,
        text=(
            f"Version {policy.version} of the Sentra Shield policy "
            f"({policy.rule_count} rules) is on its way to the gateway."
            + (
                f" {len(waiting_for)} fix(es) stay a change in the application: "
                + "; ".join(waiting_for)
                if waiting_for
                else ""
            )
        ),
    )
    return policy


def offer(db: Session, gateway: ShieldGateway) -> int:
    """Step 3: the version number the gateway is told about when it reports itself. A version it
    was offered three times without confirming has failed (4a1), and the version before it stays
    active, so the traffic keeps the policy that works."""
    pending = waiting(db, gateway.target_id)
    if pending is None:
        active = current(db, gateway.target_id)
        return active.version if active else 0
    pending.offers += 1
    pending.offered_at = pending.offered_at or _now()
    if pending.offers > MAX_OFFERS:
        _failed(db, gateway, pending)
        active = current(db, gateway.target_id)
        return active.version if active else 0
    db.commit()
    return pending.version


def document_for(db: Session, gateway: ShieldGateway) -> tuple[int, dict]:
    """What `GET /shield/policy` serves: the version the gateway should take, or the active one."""
    policy = waiting(db, gateway.target_id) or current(db, gateway.target_id)
    if policy is None:
        return 0, {"rules": []}
    return policy.version, policy.document or {"rules": []}


def confirm(
    db: Session, gateway: ShieldGateway, version: int, *, rules: int | None = None
) -> ShieldPolicy | None:
    """Steps 4-5: the gateway says it has activated the version. The version before it becomes
    history — kept, so FR-8.6 can roll back to it — and the deployment is recorded with its
    approver in the same transaction as the audit entry (NFR-2.4)."""
    pending = waiting(db, gateway.target_id)
    if pending is None or pending.version != version:
        return None
    if rules is not None and rules != pending.rule_count:
        # The gateway activated something else than what Sentra sent: it is not confirmed.
        return None
    before = current(db, gateway.target_id)
    if before is not None:
        # 4a: a rollback that waited for the gateway still takes its version out of the traffic.
        before.state = (
            PolicyState.ROLLED_BACK
            if pending.source in (PolicySource.ROLLBACK, PolicySource.DISABLED)
            else PolicyState.SUPERSEDED
        )
    pending.state = PolicyState.ACTIVE
    pending.confirmed_at = _now()
    gateway.reported_policy_version = version
    target = db.get(Target, gateway.target_id)
    approver = db.get(User, pending.approved_by_id) if pending.approved_by_id else None
    audit.record(
        db,
        organization_id=pending.organization_id,
        actor=None,
        actor_type="gateway",
        actor_name=f"Sentra Shield gateway of {target.name if target else 'a target'}",
        action="shield_policy.deployed",
        summary=(
            f"Version {pending.version} of the Sentra Shield policy of "
            f"{target.name if target else 'a target'} is active "
            f"({pending.rule_count} rules"
            + (f", approved by {approver.name}" if approver else "")
            + ")"
        ),
        item=audit.Item("shield_policy", pending.id, f"version {pending.version}"),
        details={
            "version": pending.version,
            "rules": pending.rule_count,
            "approved_by": approver.name if approver else None,
            "replaced": before.version if before else None,
            "sources": pending.sources,
        },
        source_address=None,
    )
    db.commit()
    db.refresh(pending)
    finding, remediation = _behind(db, pending)
    if finding is not None and remediation is not None:
        # The event says "deployed or failed", and this is the moment a fix is really in effect.
        _tell(
            db,
            finding,
            remediation,
            text=(
                f"Version {pending.version} of the Sentra Shield policy is active "
                f"({pending.rule_count} rules). The fixes it carries are in effect."
            ),
        )
    _after_deployment(db, pending)
    return pending


def _failed(db: Session, gateway: ShieldGateway, policy: ShieldPolicy) -> None:
    """4a1: the gateway never confirmed the version. The deployment is marked as failed with its
    reason, the version before it stays active, and the developer hears about it."""
    policy.state = PolicyState.FAILED
    policy.failure_reason = (
        f"The gateway was told about version {policy.version} {MAX_OFFERS} times and never "
        "confirmed that it activated it."
    )
    target = db.get(Target, gateway.target_id)
    audit.record(
        db,
        organization_id=policy.organization_id,
        actor=None,
        action="shield_policy.failed",
        summary=(
            f"Version {policy.version} of the Sentra Shield policy of "
            f"{target.name if target else 'a target'} was not activated by the gateway"
        ),
        item=audit.Item("shield_policy", policy.id, f"version {policy.version}"),
        details={"version": policy.version, "offers": MAX_OFFERS},
        source_address=None,
    )
    db.commit()
    finding, remediation = _behind(db, policy)
    if finding is not None and remediation is not None:
        remediation.status = RemediationStatus.APPROVED  # it can be deployed again
        db.commit()
        _tell(db, finding, remediation, text=policy.failure_reason)


def due(db: Session, at: datetime | None = None) -> list[ShieldPolicy]:
    """1a: the versions whose maintenance window has come. Sentra's clock (FR-5.3) calls this
    every minute through this module's schedules.py."""
    now = at or _now()
    started = []
    for policy in db.scalars(
        select(ShieldPolicy).where(
            ShieldPolicy.state == PolicyState.SCHEDULED,
            ShieldPolicy.deploy_at.is_not(None),
            ShieldPolicy.deploy_at <= now,
        )
    ).all():
        if waiting(db, policy.target_id) is not None:
            continue  # the gateway is still taking another version; this one waits its turn
        policy.state = PolicyState.PENDING
        policy.offered_at = now
        target = db.get(Target, policy.target_id)
        audit.record(
            db,
            organization_id=policy.organization_id,
            actor=None,
            action="shield_policy.deploying",
            summary=(
                f"The maintenance window of version {policy.version} of the Sentra Shield policy "
                f"of {target.name if target else 'a target'} has come"
            ),
            item=audit.Item("shield_policy", policy.id, f"version {policy.version}"),
            details={"version": policy.version, "deploy_at": policy.deploy_at.isoformat()},
            source_address=None,
        )
        started.append(policy)
    db.commit()
    return started


# ---------------------------------------------------------------- UC-8.8: rolling it back


MIN_REASON = 10
SHORT_REASON = (
    "Say in a sentence why you are rolling the policy back: it stays with the version in the "
    "audit log, and the next person reads it before they deploy again."
)
CANCELLED_BY_ROLLBACK = "A rollback replaced it before the gateway activated it."
RULE_GROUPS = (
    ("Input guardrails", RuleKind.TEXT_GUARDRAIL, "input"),
    ("Output guardrails", RuleKind.TEXT_GUARDRAIL, "output"),
    ("Tool permissions", RuleKind.TOOL_APPROVAL, None),
    ("Retrieval isolation", RuleKind.RETRIEVAL_REPORT, None),
    ("System prompt hardening", RuleKind.SYSTEM_PROMPT, None),
)


def rule_counts(document: dict | None) -> list[dict]:
    """The five numbers of Screen 49's policy card, in the words of the fixes they came from."""
    rules = (document or {}).get("rules") or []
    return [
        {
            "label": label,
            "count": sum(
                1
                for rule in rules
                if rule.get("kind") == kind
                and (applies_to is None or rule.get("applies_to") == applies_to)
            ),
        }
        for label, kind, applies_to in RULE_GROUPS
    ]


def included(db: Session, policy: ShieldPolicy) -> list[dict]:
    """The remediations a version carries, as the pages name them: the finding and the version of
    its proposal (Screen 49, "included remediations")."""
    from app.modules.m06_findings.service import finding_row

    rows = []
    for one in policy.sources or []:
        code = str(one.get("finding") or "")
        try:
            finding = finding_row(db, policy.organization_id, code)
        except NotFoundError:
            finding = None
        rows.append(
            {
                "finding": code,
                "finding_title": finding.title if finding else None,
                "version": one.get("version"),
                "fixes": one.get("fixes") or [],
            }
        )
    return rows


def _key(rule: dict) -> str:
    return json.dumps({k: v for k, v in rule.items() if k != "id"}, sort_keys=True)


def consequences(db: Session, organization_id: uuid.UUID, target: Target, to_version: int) -> dict:
    """What the rollback dialog says before anybody rolls anything back (UC-8.8 step 2).

    `to_version` 0 disables the policy (2a). Everything here is worked out when it is read, so the
    dialog shows what would happen now, not what would have happened yesterday.
    """
    active = current(db, target.id)
    if active is None:
        raise ConflictError(
            "This target has no active Shield Policy to roll back.", code="no_active_policy"
        )
    if to_version:
        earlier = version_row(db, organization_id, target.id, to_version)
        if earlier.version == active.version:
            raise ConflictError("That version is the active one.", code="already_active")
        after = earlier.document or {"rules": []}
    else:
        earlier, after = None, {"rules": []}
    keep = {_key(rule) for rule in after.get("rules") or []}
    removed = [
        rule for rule in (active.document or {}).get("rules") or [] if _key(rule) not in keep
    ]
    stopping: dict[tuple[str, int], list[int]] = {}
    for rule in removed:
        where = rule.get("from") or {}
        key = (str(where.get("finding")), int(where.get("version") or 0))
        stopping.setdefault(key, [])
        if where.get("fix") not in stopping[key]:
            stopping[key].append(where.get("fix"))
    reopening = [code for code, _ in _verified_by(db, organization_id, list(stopping))]
    gateway = gateways.of_target(db, organization_id, target.id)
    return {
        "from_version": active.version,
        "to_version": to_version or None,
        "disables": not to_version,
        "rules_now": active.rule_count,
        "rules_after": len(after.get("rules") or []),
        "rules_removed": len(removed),
        "remediations_stopping": [
            {"finding": finding, "version": version, "fixes": sorted(fixes)}
            for (finding, version), fixes in stopping.items()
        ],
        "findings_reopening": reopening,
        # 4a: a gateway that is not reporting gets the rollback when it comes back
        "gateway_reachable": gateway is not None
        and gateways.state_now(gateway)
        in (gateways.GatewayStatus.ACTIVE, gateways.GatewayStatus.NOT_IN_PATH),
        "window_seconds": gateways.HEARTBEAT_SECONDS,
    }


def _verified_by(
    db: Session, organization_id: uuid.UUID, pairs: list[tuple[str, int]]
) -> list[tuple[str, Finding]]:
    """The findings of these remediations that only a retest of the removed version proved fixed
    (UC-8.8 step 5). FR-8.5 is what sets `fixed_and_verified`, so today this is usually empty."""
    from app.modules.m06_findings.service import finding_row

    found = []
    for code, _ in pairs:
        try:
            finding = finding_row(db, organization_id, code)
        except NotFoundError:
            continue
        if finding.status == FindingStatus.FIXED_AND_VERIFIED:
            found.append((code, finding))
    return found


def rollback(
    db: Session,
    organization_id: uuid.UUID,
    user: User,
    *,
    target: Target,
    to_version: int,
    reason: str,
) -> tuple[ShieldPolicy, dict]:
    """UC-8.8 steps 4-6, and 2a when `to_version` is 0: the earlier document is deployed again as
    a new version, the findings that depended on the removed one are reopened, the rollback is in
    the audit log with its reason, and the people who work with the target hear about it.

    The person has authenticated again before this (step 3, NFR-3.5): the route asks for it.
    """
    said = (reason or "").strip()
    if len(said) < MIN_REASON:
        raise FieldValidationError("reason", SHORT_REASON)
    told = consequences(db, organization_id, target, to_version)
    active = current(db, target.id)
    earlier = version_row(db, organization_id, target.id, to_version) if to_version else None
    document = (earlier.document if earlier else {"rules": []}) or {"rules": []}
    pending = waiting(db, target.id)
    if pending is not None:
        # A version still on its way is not what anybody wants back: it never reached the traffic.
        pending.state = PolicyState.FAILED
        pending.failure_reason = CANCELLED_BY_ROLLBACK
    rules = [dict(rule) for rule in document.get("rules") or []]
    for number, rule in enumerate(rules, start=1):
        rule["id"] = f"r{number}"
    policy = ShieldPolicy(
        organization_id=organization_id,
        target_id=target.id,
        version=_next_version(db, target.id),
        # 4a: a gateway nobody can reach gets it as soon as it reports again; until then the
        # version that is really in the traffic stays the active one.
        state=PolicyState.ACTIVE if told["gateway_reachable"] else PolicyState.PENDING,
        source=PolicySource.ROLLBACK if to_version else PolicySource.DISABLED,
        document={"rules": rules},
        rule_count=len(rules),
        carried_over=len(rules),
        sources=_sources_of(rules),
        based_on_version=to_version or None,
        rolled_back_from=active.version,
        reason=said,
        deployed_by_id=user.id,
        approved_by_id=earlier.approved_by_id if earlier else None,
        offered_at=_now(),
        confirmed_at=_now() if told["gateway_reachable"] else None,
    )
    if told["gateway_reachable"]:
        active.state = PolicyState.ROLLED_BACK
    db.add(policy)
    db.flush()
    _stop_enforcing(db, organization_id, told, reason=said)
    what = "disabled" if not to_version else "rolled_back"
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action=f"shield_policy.{what}",
        summary=(
            f"The Sentra Shield policy of {target.name} was switched off "
            if not to_version
            else f"The Sentra Shield policy of {target.name} was rolled back to version "
            f"{to_version} "
        )
        + f"(version {policy.version}, from version {active.version}): {said}",
        item=audit.Item("shield_policy", policy.id, f"{target.name}, version {policy.version}"),
        details={
            "version": policy.version,
            "from_version": active.version,
            "to_version": to_version or None,
            "reason": said,
            "rules": policy.rule_count,
            "rules_removed": told["rules_removed"],
            "remediations_stopping": told["remediations_stopping"],
            "findings_reopened": told["findings_reopening"],
            "password_confirmed": True,  # NFR-3.5, the route's own dependency
            "waiting_for_the_gateway": not told["gateway_reachable"],
        },
    )
    # NFR-2.4: the version, the findings, the remediations and the audit entry are one transaction.
    db.commit()
    db.refresh(policy)
    _tell_everybody(db, organization_id, target, policy, told, reason=said)
    return policy, told


def _stop_enforcing(db: Session, organization_id: uuid.UUID, told: dict, *, reason: str) -> None:
    """Step 5: the fixes of the removed rules are not in effect any more. Their findings go back
    to open if only a retest of the removed version had closed them, and their proposals go back
    to approved, so they can be deployed again once somebody has looked at them."""
    from app.modules.m06_findings.service import finding_row

    pairs = [
        (one["finding"], one["version"]) for one in told["remediations_stopping"] if one["finding"]
    ]
    for code, finding in _verified_by(db, organization_id, pairs):
        finding.status = FindingStatus.REOPENED
        audit.record(
            db,
            organization_id=organization_id,
            actor=None,
            action="finding.reopened",
            summary=(
                f"{code} is open again: the Shield Policy version that proved it fixed was "
                f"rolled back ({reason})"
            ),
            item=audit.Item("finding", finding.id, code),
            details={"finding": code, "reason": reason},
            source_address=None,
        )
    for code, version in pairs:
        try:
            finding = finding_row(db, organization_id, code)
        except NotFoundError:
            continue
        remediation = db.scalar(
            select(Remediation).where(
                Remediation.finding_id == finding.id, Remediation.version == version
            )
        )
        if remediation is None or remediation.status not in (
            RemediationStatus.APPLYING,
            RemediationStatus.EFFECTIVE,
            RemediationStatus.INEFFECTIVE,
        ):
            continue
        remediation.status = RemediationStatus.APPROVED
        retest.after_rollback(db, finding=finding, remediation=remediation)


def _tell_everybody(
    db: Session,
    organization_id: uuid.UUID,
    target: Target,
    policy: ShieldPolicy,
    told: dict,
    *,
    reason: str,
) -> None:
    """Step 6: the developers and the Security Analysts of the organization are told what changed
    and why — a policy leaving the traffic is not something anybody should find out later."""
    from app.modules.m01_users.models import Membership, MembershipStatus, Role
    from app.modules.m09_reporting.notifications import notify

    people = list(
        db.scalars(
            select(Membership.user_id).where(
                Membership.organization_id == organization_id,
                Membership.status == MembershipStatus.ACTIVE,
                Membership.role.in_((Role.TARGET_OWNER, Role.SECURITY_ANALYST)),
            )
        )
    )
    if not people:
        return
    what = (
        "was switched off"
        if policy.source == PolicySource.DISABLED
        else f"was rolled back to version {policy.based_on_version}"
    )
    waiting_line = (
        ""
        if told["gateway_reachable"]
        else " The gateway isn't reporting, so it applies the change as soon as it reconnects."
    )
    notify(
        db,
        event="shield_policy",
        user_ids=people,
        organization_id=organization_id,
        text=(
            f"The Sentra Shield policy of {target.name} {what} (now version {policy.version}, "
            f"{policy.rule_count} rules): {reason}{waiting_line}"
        ),
        subject=f"Sentra Shield policy of {target.name}",
        link=f"/targets/{target.id}/shield",
    )


# ---------------------------------------------------------------- what comes after it


def _after_deployment(db: Session, policy: ShieldPolicy) -> None:
    """Step 6: the retest of the finding starts once every fix of its proposal is in effect. The
    retest itself is FR-8.4 (UC-8.6), and `retest.after_deployment()` is the one function that
    task replaces; today the remediation stays `applying` until it runs."""
    finding, remediation = _behind(db, policy)
    if finding is not None and remediation is not None:
        retest.after_deployment(db, finding=finding, remediation=remediation, policy=policy)


def _behind(db: Session, policy: ShieldPolicy) -> tuple[Finding | None, Remediation | None]:
    """The finding and the remediation version this policy version was deployed for. A finding's
    `code` is worked out from its number, so the lookup goes through M6's own one."""
    from app.modules.m06_findings.service import finding_row

    if not policy.trigger_finding:
        return None, None
    try:
        finding = finding_row(db, policy.organization_id, policy.trigger_finding)
    except NotFoundError:
        return None, None
    remediation = db.scalar(
        select(Remediation).where(
            Remediation.finding_id == finding.id,
            Remediation.version == (policy.trigger_version or 0),
        )
    )
    return finding, remediation


def _tell(db: Session, finding: Finding, remediation: Remediation, *, text: str) -> None:
    """The people who worked on the proposal hear what happened to its policy."""
    from app.modules.m09_reporting.notifications import notify

    recipients = [one for one in {remediation.edited_by_id, remediation.requested_by_id} if one]
    if not recipients:
        return
    notify(
        db,
        event="shield_policy",
        user_ids=recipients,
        organization_id=finding.organization_id,
        text=f"{finding.code}: {text}",
        subject=f"{finding.code} {finding.title}",
        link="/shield",
    )


# ---------------------------------------------------------------- what the pages read

STATE_LABELS = {
    PolicyState.SCHEDULED: "Waiting for its window",
    PolicyState.PENDING: "On its way to the gateway",
    PolicyState.ACTIVE: "Active",
    PolicyState.SUPERSEDED: "Replaced",
    PolicyState.ROLLED_BACK: "Rolled back",
    PolicyState.FAILED: "Not activated",
}
RULE_LABELS = {
    RuleKind.TEXT_GUARDRAIL: "Guardrail",
    RuleKind.TOOL_APPROVAL: "Tool approval",
    RuleKind.RETRIEVAL_REPORT: "Retrieval watch",
    RuleKind.SYSTEM_PROMPT: "System prompt",
}


def says(rule: dict) -> str:
    """One line a person can read instead of the rule itself (Screen 49)."""
    kind = rule.get("kind")
    if kind == RuleKind.TEXT_GUARDRAIL:
        terms = len(rule.get("terms") or [])
        doing = "Blocks" if rule.get("action") == "block" else "Masks"
        return (
            f"{doing} the {rule.get('applies_to')} when it contains "
            f"{'one of ' if terms > 1 else ''}{terms} term{'s' if terms > 1 else ''}"
        )
    if kind == RuleKind.TOOL_APPROVAL:
        return f"Holds back the tool {rule.get('tool')} until a person approves the call"
    if kind == RuleKind.RETRIEVAL_REPORT:
        return f"Reports every request that touches {rule.get('source')}"
    return "Adds the approved sentences to the system prompt the application sends"


def deployable(db: Session, organization_id: uuid.UUID, target: Target) -> list[dict]:
    """The approved remediations of this target that are not in the policy yet, and what each of
    their fixes would become in it — or why it cannot go in (Screen 48 asks for the terms here).
    """
    gateway = gateways.active(db, target.id)
    rows = db.execute(
        select(Remediation, Finding)
        .join(Finding, Finding.id == Remediation.finding_id)
        .where(
            Finding.target_id == target.id,
            Remediation.status == RemediationStatus.APPROVED,
        )
        .order_by(Finding.number, Remediation.version.desc())
    ).all()
    found = []
    seen: set[uuid.UUID] = set()
    for remediation, finding in rows:
        if finding.id in seen:
            continue  # only the newest approved version of a finding's proposal
        seen.add(finding.id)
        fixes_out = []
        for fix in remediation.fixes:
            rules, reason = (
                rules_of_fix(
                    fix,
                    gateway.position,
                    finding_code=finding.code,
                    remediation_version=remediation.version,
                    guardrail=None,
                )
                if gateway is not None
                else ([], "This target has no gateway in its traffic path (UC-8.1).")
            )
            # What it would become is its kind and this gateway's position, not the terms a
            # person has still to write: Screen 48 names the rule and asks for them.
            rule_kind = RULE_OF_FIX.get(FixKind(fix.kind))
            carried = (
                gateway is not None
                and rule_kind is not None
                and rule_kind in CARRIES[gateway.position]
            )
            fixes_out.append(
                {
                    "fix": fix.position,
                    "kind": fix.kind,
                    "title": fix.title,
                    "becomes": RULE_LABELS[rule_kind] if carried else None,
                    "needs_terms": reason == NEEDS_TERMS,
                    "reason": reason,
                }
            )
        found.append(
            {
                "finding": finding.code,
                "finding_title": finding.title,
                "version": remediation.version,
                "fixes": fixes_out,
            }
        )
    return found


def version_of(db: Session, finding: Finding, version: int) -> Remediation | None:
    """One named version of a finding's proposal. Whether it may be deployed is `deploy()`'s
    answer, so a developer who names a draft gets the reason and not a silent refusal."""
    return db.scalar(
        select(Remediation).where(
            Remediation.finding_id == finding.id, Remediation.version == version
        )
    )


def newest(db: Session, finding_id: uuid.UUID) -> Remediation | None:
    """The newest version of a finding's proposal, whatever its status. `deploy()` is the one
    that says whether it may be deployed, so a draft gets its reason and not a bare 404."""
    return db.scalars(
        select(Remediation)
        .where(Remediation.finding_id == finding_id)
        .order_by(Remediation.version.desc())
        .limit(1)
    ).first()


def newest_approved(db: Session, finding_id: uuid.UUID) -> Remediation | None:
    return db.scalars(
        select(Remediation)
        .where(
            Remediation.finding_id == finding_id,
            Remediation.status.in_((RemediationStatus.APPROVED, RemediationStatus.APPLYING)),
        )
        .order_by(Remediation.version.desc())
        .limit(1)
    ).first()
