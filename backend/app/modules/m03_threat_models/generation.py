"""UC-3.1 Generate Threat Model. A job on a Background Worker turns the reviewed Target Profile
into the next draft version of the target's threat model: components (step 2), baseline threats
(step 3), threats suggested by the LLM (step 4), mapped and rated (steps 5-6), with the
alternatives 1a, 4a and 4b. The analysts are told when the draft is ready."""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError
from app.llm import LLMOutputError, LLMTask, LLMUnavailable, complete
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m02_targets import profile as target_profiles
from app.modules.m02_targets.models import ProfileStatus, Target, TargetProfile, TargetStatus
from app.modules.m03_threat_models import baseline, components, frameworks, versions
from app.modules.m03_threat_models.baseline import Draft
from app.modules.m03_threat_models.components import Component
from app.modules.m03_threat_models.models import (
    ComponentKind,
    JobStatus,
    JobTrigger,
    Origin,
    ThreatModel,
    ThreatModelJob,
    ThreatSource,
)
from app.workers import jobs

log = logging.getLogger("uvicorn.error")

MAX_SUGGESTIONS = 12
STALE_AFTER = timedelta(minutes=15)  # a running job older than this has been lost
TYPE_LABELS = {
    "chatbot": "Chatbot",
    "rag_application": "RAG application",
    "tool_using_agent": "Tool-using agent",
}
FAILED = (
    "Generating the threat model failed. Try again; if it fails again, tell your administrator."
)

# Step 4. Fixed instructions, written here; everything about the target goes in the data.
INSTRUCTIONS = """You help a security analyst write the threat model of an AI application. The \
data describes the application: its type, its environment, its components, what its Target \
Profile says about it, and the baseline threats that are already listed.

List the threats that are specific to this application and that the baseline threats don't cover \
yet. A threat says what could go wrong for this application and what the consequence would be. \
Never describe how to carry out an attack, and give no example inputs.

For every threat give:
- title: one sentence of at most 160 characters
- component: the name of exactly one component, as written in the data
- owasp: one or more of these OWASP Top 10 for LLM Applications (2025) categories, by code:
{categories}
- atlas: the code of one of these MITRE ATLAS techniques if one fits, otherwise null:
{techniques}
- likelihood and impact: whole numbers from 1 (very low) to 5 (very high)
- rationale: one sentence on why the threat applies to this application

Give at most {limit} threats, and none that repeats a baseline threat. If no specific threat \
applies, give an empty list."""


class SuggestedThreat(BaseModel):
    title: str = Field(min_length=5, max_length=200)
    component: str = Field(min_length=1, max_length=200)
    owasp: list[str] = Field(min_length=1, max_length=4)
    atlas: str | None = None
    likelihood: int = Field(ge=1, le=5)
    impact: int = Field(ge=1, le=5)
    rationale: str = Field(default="", max_length=400)


class Suggestions(BaseModel):
    """The form the LLM's answer must have (step 4: validated against a schema)."""

    threats: list[SuggestedThreat] = Field(max_length=MAX_SUGGESTIONS)


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- starting a job (step 1)


def blocker(target: Target, profile: TargetProfile | None) -> tuple[str, str] | None:
    """Why no threat model can be generated now (UC-3.1 preconditions): a code and a message."""
    if target.status == TargetStatus.ARCHIVED:
        return "target_archived", "This target is archived. Restore it first."
    if target.status != TargetStatus.VERIFIED:
        return "not_verified", "Verify the target's ownership first."
    if profile is None or profile.status != ProfileStatus.REVIEWED:
        return (
            "profile_not_reviewed",
            "Review the target's profile first. The threat model is generated from it.",
        )
    return None


def _job(db: Session, target_id: uuid.UUID, status: JobStatus) -> ThreatModelJob | None:
    return db.scalar(
        select(ThreatModelJob)
        .where(ThreatModelJob.target_id == target_id, ThreatModelJob.status == status)
        .order_by(ThreatModelJob.created_at.desc())
        .limit(1)
    )


def request(
    db: Session, target: Target, *, trigger: JobTrigger, requested_by: uuid.UUID | None
) -> ThreatModelJob:
    """Step 1. A target has one running job at most: a request that comes while one runs waits
    for it, and requests that come meanwhile share that waiting job."""
    if problem := blocker(target, target_profiles.find(db, target.id)):
        raise ConflictError(problem[1], code=problem[0])
    # Requests for one target, e.g. a profile review and a click, are handled one at a time.
    db.execute(select(Target.id).where(Target.id == target.id).with_for_update())
    running = _job(db, target.id, JobStatus.RUNNING)
    if running is not None and (running.started_at or running.created_at) < _now() - STALE_AFTER:
        running.status, running.finished_at = JobStatus.FAILED, _now()
        running.message = "This generation didn't finish, so it was started again."
        running = None
    if running is not None and (waiting := _job(db, target.id, JobStatus.QUEUED)) is not None:
        return waiting
    job = ThreatModelJob(
        organization_id=target.organization_id,
        target_id=target.id,
        trigger=trigger,
        requested_by_id=requested_by,
        status=JobStatus.QUEUED if running is not None else JobStatus.RUNNING,
        started_at=None if running is not None else _now(),
    )
    db.add(job)
    db.commit()
    if job.status == JobStatus.RUNNING:
        _start(db, job)
    return job


def _start(db: Session, job: ThreatModelJob) -> None:
    if not jobs.start(db, "threat_models.generate", job.id):
        job.status, job.finished_at, job.message = JobStatus.FAILED, _now(), jobs.QUEUE_DOWN
        db.commit()
    db.refresh(job)


def _start_next(db: Session, target_id: uuid.UUID) -> None:
    waiting = _job(db, target_id, JobStatus.QUEUED)
    if waiting is None or _job(db, target_id, JobStatus.RUNNING) is not None:
        return
    waiting.status, waiting.started_at = JobStatus.RUNNING, _now()
    db.commit()
    _start(db, waiting)


def after_profile_review(db: Session, target_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """The trigger "a profile review has been completed (UC-2.4)". Module 2 starts this job by
    name, so it doesn't depend on Module 3."""
    target = db.get(Target, target_id)
    if target is None or blocker(target, target_profiles.find(db, target_id)):
        return
    request(db, target, trigger=JobTrigger.PROFILE_REVIEW, requested_by=user_id)


# ---------------------------------------------------------------- the job (steps 2-6)


def run(db: Session, job_id: uuid.UUID) -> None:
    """In the worker. The job ends as done or failed, whatever happens, and then the target's
    waiting job starts."""
    job = db.get(ThreatModelJob, job_id)
    if job is None or job.status != JobStatus.RUNNING:
        return
    target_id = job.target_id
    try:
        _generate(db, job)
    except Exception:
        log.exception("Generating the threat model of target %s failed", target_id)
        db.rollback()
        job = db.get_one(ThreatModelJob, job_id)
        job.status, job.finished_at, job.message = JobStatus.FAILED, _now(), FAILED
        db.commit()
    _start_next(db, target_id)


def _generate(db: Session, job: ThreatModelJob) -> None:
    target = db.get_one(Target, job.target_id)
    profile = target_profiles.find(db, target.id)
    if problem := blocker(target, profile):
        job.status, job.finished_at, job.message = JobStatus.FAILED, _now(), problem[1]
        db.commit()
        return
    assert profile is not None
    found = components.identify(target, profile)
    drafts = baseline.derive(target, found)
    suggested, info = _suggest(db, target, profile, found, drafts)
    previous = versions.latest(db, target.id)
    drafts = _keep_decisions(previous, drafts + suggested, found)
    requester = job.requested_by_id if job.trigger == JobTrigger.REQUESTED else None
    model = versions.store(
        db,
        target,
        origin=Origin.GENERATED,
        based_on=previous,
        components=[c.as_json() for c in found],
        drafts=drafts,
        created_by_id=requester,
        generation={"trigger": job.trigger, **info},
        profile_version=profile.version,
    )
    job.status, job.finished_at, job.version = JobStatus.DONE, _now(), model.version
    job.message = info.get("baseline_only")
    actor = db.get(User, requester) if requester else None
    count = sum(not t.removed for t in model.threats)
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=actor,
        action="threat_model.generated",
        summary=f"Generated version {model.version} of the threat model of {target.name} "
        f"({count} threats, {info.get('suggested', 0)} of them suggested by the LLM)",
        item=audit.Item("threat_model", target.id, f"{target.name}, version {model.version}"),
        details={"version": model.version, "trigger": job.trigger, "threats": count},
    )
    db.commit()
    _notify(db, target, model)


def _suggest(
    db: Session,
    target: Target,
    profile: TargetProfile,
    found: list[Component],
    drafts: list[Draft],
) -> tuple[list[Draft], dict]:
    """Step 4 with 4a (no model, or it can't be used) and 4b (an answer in the wrong form is
    asked for once more)."""
    for attempt in (1, 2):
        try:
            reply = complete(
                db,
                LLMTask.THREAT_MODELING,
                instructions=_instructions(),
                data=_data(target, profile, found, drafts),
                organization_id=target.organization_id,
                schema=Suggestions,
                max_tokens=3000,
            )
        except LLMUnavailable as exc:
            return [], {
                "suggested": 0,
                "dropped": 0,
                "baseline_only": f"{exc} Only the baseline threats were added. Generate the "
                "threat model again later for threats specific to this target.",
            }
        except LLMOutputError:
            if attempt == 1:
                continue
            return [], {
                "suggested": 0,
                "dropped": 0,
                "baseline_only": "The model's answer didn't have the required form, also when "
                "asked again. Only the baseline threats were added.",
            }
        assert isinstance(reply.parsed, Suggestions)
        accepted, dropped = _accept(reply.parsed, found, drafts)
        return accepted, {"model": reply.model, "suggested": len(accepted), "dropped": dropped}
    raise AssertionError("unreachable")


def _instructions() -> str:
    return INSTRUCTIONS.format(
        categories="\n".join(f"  {code} {name}" for code, name in frameworks.OWASP_NAMES.items()),
        techniques="\n".join(f"  {code} {name}" for code, name in frameworks.ATLAS_NAMES.items()),
        limit=MAX_SUGGESTIONS,
    )


def _data(
    target: Target, profile: TargetProfile, found: list[Component], drafts: list[Draft]
) -> str:
    """Only what the task needs (NFR-9.6): no endpoint, no credentials and no canary tokens. The
    LLM layer masks secrets and personal data and marks it all as data (NFR-3.6)."""
    lines = [
        f"Application type: {TYPE_LABELS.get(target.type, target.type)}",
        f"Environment: {target.environment}",
        "",
        "Components:",
    ]
    lines += [f"- {components.label(c.kind, c.name)}" for c in found]
    entries = [
        f"- {target_profiles.LABELS[key]}: {entry.get('value', '')}"
        for key, entry in (profile.entries or {}).items()
        if key in target_profiles.LABELS and entry.get("value")
    ]
    if entries:
        lines += ["", "Target Profile:", *entries]
    if profile.knowledge_sources:
        lines += ["", "Knowledge sources:"]
        lines += [
            f"- {k.get('name', '')}: {k.get('description', '')} (access: {k.get('access') or '?'})"
            for k in profile.knowledge_sources
        ]
    if profile.tools:
        lines += ["", "Tools:"]
        lines += [
            f"- {t.get('name', '')} (parameters: {t.get('parameters') or '?'}; side effect: "
            f"{t.get('side_effect') or '?'})"
            for t in profile.tools
        ]
    lines += ["", "Baseline threats already listed:"]
    lines += [
        f"- [{components.label(d.component_kind, d.component_name)}] {d.title} "
        f"({', '.join(d.owasp)})"
        for d in drafts
    ]
    return "\n".join(lines)


def _accept(
    raw: Suggestions, found: list[Component], drafts: list[Draft]
) -> tuple[list[Draft], int]:
    """Step 5: a suggestion must name a component and a known OWASP category. A copy of a
    baseline threat or of another suggestion is left out, and so is a malformed ATLAS ID."""
    named: dict[str, Component] = {}
    for component in found:
        named[component.name.lower()] = component
        named[components.label(component.kind, component.name).lower()] = component
    seen = {versions.title_key(d) for d in drafts}
    accepted: list[Draft] = []
    dropped = 0
    for item in raw.threats:
        component = named.get(" ".join(item.component.split()).lower())
        owasp = frameworks.clean_owasp(item.owasp)
        title = " ".join(item.title.split())
        if component is None or not owasp or len(title) < 5:
            dropped += 1
            continue
        atlas = (item.atlas or "").strip()
        draft = Draft(
            title=title,
            component_kind=component.kind.value,
            component_name=component.name,
            owasp=owasp,
            atlas=atlas if frameworks.valid_atlas(atlas) else None,
            likelihood=item.likelihood,
            impact=item.impact,
            source=ThreatSource.AI_SUGGESTED.value,
            rationale=" ".join(item.rationale.split()),
        )
        if versions.title_key(draft) in seen:
            dropped += 1
            continue
        seen.add(versions.title_key(draft))
        accepted.append(draft)
    return accepted, dropped


def _keep_decisions(
    previous: ThreatModel | None, drafts: list[Draft], found: list[Component]
) -> list[Draft]:
    """1a: the new version keeps what people decided in the latest version. A threat keeps its
    number, a rating set by a person and a removal with its reason; threats that people added
    stay while their component exists (outputs are named by people, so they always exist)."""
    if previous is None:
        return drafts
    before = {versions.key(t): t for t in previous.threats}
    matched: set[tuple] = set()
    for draft in drafts:
        old = before.get(versions.key(draft))
        if old is None:
            continue
        matched.add(versions.key(draft))
        draft.extra["threat_no"] = old.threat_no
        if old.rated_by_id is not None:
            draft.likelihood, draft.impact = old.likelihood, old.impact
            draft.extra.update(rated_by_id=old.rated_by_id, change_reason=old.change_reason)
        if old.removed:
            draft.extra.update(removed=True, removal_reason=old.removal_reason)
    present = {(c.kind.value, c.name.lower()) for c in found}
    for old in previous.threats:
        if old.source != ThreatSource.ANALYST or versions.key(old) in matched:
            continue
        place = (old.component_kind, old.component_name.lower())
        if old.component_kind != ComponentKind.OUTPUT and place not in present:
            continue
        drafts.append(
            Draft(
                title=old.title,
                component_kind=old.component_kind,
                component_name=old.component_name,
                owasp=list(old.owasp),
                atlas=old.atlas,
                likelihood=old.likelihood,
                impact=old.impact,
                source=old.source,
                rationale=old.rationale or "",
                extra={
                    "threat_no": old.threat_no,
                    "rated_by_id": old.rated_by_id,
                    "change_reason": old.change_reason,
                    "removed": old.removed,
                    "removal_reason": old.removal_reason,
                },
            )
        )
    return drafts


def _notify(db: Session, target: Target, model: ThreatModel) -> None:
    """Step 6: the organization's Security Analysts are told that a draft awaits them."""
    from app.modules.m09_reporting.notifications import notify

    analysts = db.scalars(
        select(Membership.user_id).where(
            Membership.organization_id == target.organization_id,
            Membership.role == Role.SECURITY_ANALYST,
            Membership.status == MembershipStatus.ACTIVE,
        )
    ).all()
    if not analysts:
        return
    text = f"Version {model.version} of the threat model of {target.name} is ready for your review."
    if model.generation.get("baseline_only"):
        text += " It has the baseline threats only, because the LLM couldn't be used."
    notify(
        db,
        event="threat_model_ready",
        user_ids=list(analysts),
        organization_id=target.organization_id,
        text=text,
        subject=target.name,
        link=f"/threat-models/{target.id}",
    )
