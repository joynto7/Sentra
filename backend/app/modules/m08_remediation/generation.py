"""UC-8.2 Generate Remediation. A job on a Background Worker turns a confirmed finding into a
draft remediation proposal: the root cause in plain language and one or more fixes (FR-8.1), with
the alternatives 1a (the finding still needs confirmation), 1b (a revision), 4a (no model), 4b (an
answer in the wrong form) and 6a (no gateway can carry a fix). The person who asked is told when
the draft is ready, and nothing is applied: a proposal is a draft until someone approves it
(NFR-9.3, FR-8.2).
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core import audit
from app.core.errors import ConflictError
from app.llm import LLMOutputError, LLMTask, LLMUnavailable, complete
from app.modules.m01_users.models import User
from app.modules.m02_targets import profile as target_profiles
from app.modules.m02_targets.models import Target, TargetCanary, TargetProfile
from app.modules.m04_tests.models import TestDefinition
from app.modules.m06_findings import evidence as evidence_store
from app.modules.m06_findings.models import (
    CLOSED,
    Evidence,
    Finding,
    FindingStatus,
    component_label,
)
from app.modules.m08_remediation import fixes as fix_rules
from app.modules.m08_remediation.models import (
    Enforcement,
    FixKind,
    JobStatus,
    JobTrigger,
    Origin,
    Remediation,
    RemediationFix,
    RemediationJob,
    RemediationStatus,
)
from app.workers import jobs

log = logging.getLogger("uvicorn.error")

MAX_FIXES = 4
MAX_REPLY_CHARS = 2000  # of the reply in the evidence; the fix needs the behaviour, not the whole
STALE_AFTER = timedelta(minutes=15)  # a running job older than this has been lost
FAILED = "Generating the remediation failed. Try again; if it fails again, tell your administrator."

# Step 4. Fixed instructions, written here; everything about the finding goes in the data.
INSTRUCTIONS = """You help the developers of an AI application fix a weakness that a security \
test confirmed. The data describes the finding: the test and the category of the weakness, the \
component it affects, what the application answered, how Sentra decided that the attempt \
succeeded, what the application's Target Profile says, and the mitigation the test's author \
recommends.

First explain the root cause in one or two sentences of plain language: why the application \
behaves this way. Then recommend between one and {limit} fixes that close it. Write only about \
defending the application: never give an attack payload, an example of an input that triggers the \
weakness, or a way to reach it.

Each fix has:
- kind: exactly one of
{kinds}
- title: one sentence of at most 160 characters
- description: two or three sentences on what to change and why it helps
- the fix itself, in the field that belongs to its kind:
    system_prompt -> prompt: the sentences to add to the system prompt
    guardrail -> rules: the rules an input or output filter applies
    tool_policy -> tools: for each tool, what stays allowed and what needs approval
    retrieval_isolation -> sources: for each knowledge source, who may retrieve from it
    code_change -> steps: the steps the developers take in the application

Give the smallest set of fixes that closes the weakness, the most effective one first, and no two \
fixes of the same kind. Also give a summary: one sentence on what the fixes do together."""


class ToolRule(BaseModel):
    tool: str = Field(max_length=120)
    rule: str = Field(max_length=300)


class SourceRule(BaseModel):
    source: str = Field(max_length=120)
    rule: str = Field(max_length=300)


class ProposedFix(BaseModel):
    kind: str = Field(max_length=30)
    title: str = Field(min_length=5, max_length=200)
    description: str = Field(default="", max_length=1500)
    prompt: str | None = Field(default=None, max_length=2000)
    rules: list[str] | None = Field(default=None, max_length=10)
    tools: list[ToolRule] | None = Field(default=None, max_length=10)
    sources: list[SourceRule] | None = Field(default=None, max_length=10)
    steps: list[str] | None = Field(default=None, max_length=10)


class Proposal(BaseModel):
    """The form the LLM's answer must have (step 4: validated against a schema)."""

    root_cause: str = Field(min_length=5, max_length=1000)
    summary: str = Field(default="", max_length=600)
    fixes: list[ProposedFix] = Field(min_length=1, max_length=MAX_FIXES)


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- starting a job (steps 1-2)


def blocker(finding: Finding) -> tuple[str, str] | None:
    """Why no proposal can be asked for now (UC-8.2 precondition and 1a): a code and a message."""
    if finding.status in (FindingStatus.NEW, FindingStatus.REQUIRES_CONFIRMATION):
        return (
            "not_confirmed",
            "A security analyst has to confirm this finding first. Sentra proposes a fix once the "
            "weakness is confirmed.",
        )
    if finding.status in CLOSED:
        labels = {
            FindingStatus.FALSE_POSITIVE: "was marked as a false positive",
            FindingStatus.MERGED: "was merged into another finding",
            FindingStatus.FIXED_AND_VERIFIED: "is fixed and verified",
        }
        return "finding_closed", f"This finding {labels[FindingStatus(finding.status)]}."
    return None


def _job(db: Session, finding_id: uuid.UUID, status: JobStatus) -> RemediationJob | None:
    return db.scalar(
        select(RemediationJob)
        .where(RemediationJob.finding_id == finding_id, RemediationJob.status == status)
        .order_by(RemediationJob.created_at.desc())
        .limit(1)
    )


def latest(db: Session, finding_id: uuid.UUID) -> Remediation | None:
    return db.scalar(
        select(Remediation)
        .where(Remediation.finding_id == finding_id)
        .order_by(Remediation.version.desc())
        .options(selectinload(Remediation.fixes))
        .limit(1)
    )


def request(db: Session, finding: Finding, *, requested_by: uuid.UUID | None) -> RemediationJob:
    """Steps 1-2. A finding has one running job at most: a request that comes while one runs waits
    for it, and requests that come meanwhile share that waiting job. A second request after a
    proposal exists is a revision (1b)."""
    if problem := blocker(finding):
        raise ConflictError(problem[1], code=problem[0])
    # Requests for one finding, e.g. two developers at once, are handled one at a time.
    db.execute(select(Finding.id).where(Finding.id == finding.id).with_for_update())
    running = _job(db, finding.id, JobStatus.RUNNING)
    if running is not None and (running.started_at or running.created_at) < _now() - STALE_AFTER:
        running.status, running.finished_at = JobStatus.FAILED, _now()
        running.message = "This proposal didn't finish, so it was asked for again."
        running = None
    if running is not None and (waiting := _job(db, finding.id, JobStatus.QUEUED)) is not None:
        return waiting
    trigger = JobTrigger.REVISION if latest(db, finding.id) else JobTrigger.REQUESTED
    job = RemediationJob(
        organization_id=finding.organization_id,
        finding_id=finding.id,
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


def _start(db: Session, job: RemediationJob) -> None:
    if not jobs.start(db, "remediation.generate", job.id):
        job.status, job.finished_at, job.message = JobStatus.FAILED, _now(), jobs.QUEUE_DOWN
        db.commit()
    db.refresh(job)


def _start_next(db: Session, finding_id: uuid.UUID) -> None:
    waiting = _job(db, finding_id, JobStatus.QUEUED)
    if waiting is None or _job(db, finding_id, JobStatus.RUNNING) is not None:
        return
    waiting.status, waiting.started_at = JobStatus.RUNNING, _now()
    db.commit()
    _start(db, waiting)


# ---------------------------------------------------------------- the job (steps 3-6)


def run(db: Session, job_id: uuid.UUID) -> None:
    """In the worker. The job ends as done or failed, whatever happens, and then the finding's
    waiting job starts."""
    job = db.get(RemediationJob, job_id)
    if job is None or job.status != JobStatus.RUNNING:
        return
    finding_id = job.finding_id
    try:
        _generate(db, job)
    except Exception:
        log.exception("Generating the remediation of finding %s failed", finding_id)
        db.rollback()
        job = db.get_one(RemediationJob, job_id)
        job.status, job.finished_at, job.message = JobStatus.FAILED, _now(), FAILED
        db.commit()
    _start_next(db, finding_id)


def _generate(db: Session, job: RemediationJob) -> None:
    finding = db.get_one(Finding, job.finding_id)
    if problem := blocker(finding):
        job.status, job.finished_at, job.message = JobStatus.FAILED, _now(), problem[1]
        db.commit()
        return
    target = db.get_one(Target, finding.target_id)
    definition = db.get_one(TestDefinition, finding.test_definition_id)
    previous = latest(db, finding.id)
    proposed, info = _propose(db, finding, target, definition, previous)
    accepted, dropped = _accept(db, target, proposed)
    if not accepted:  # 4a, or every fix was dropped: the test's mitigation stands on its own
        fix = fix_rules.from_mitigation(definition)
        fix["enforcement"], fix["enforcement_note"] = fix_rules.enforcement(
            db, target.id, FixKind(fix["kind"])
        )
        accepted = [fix]
        info.setdefault(  # 4a already says why; this is the model answering without a usable fix
            "mitigation_only",
            "The model proposed no fix Sentra could use, so the proposal holds the mitigation "
            "the test recommends.",
        )
    remediation = _store(
        db,
        finding,
        job,
        root_cause=info.pop("root_cause"),
        summary=info.pop("summary"),
        fixes=accepted,
        based_on=previous,
        info={"trigger": job.trigger, "dropped": dropped, **info},
    )
    job.status, job.finished_at, job.version = JobStatus.DONE, _now(), remediation.version
    job.message = remediation.generation.get("mitigation_only")
    actor = db.get(User, job.requested_by_id) if job.requested_by_id else None
    audit.record(
        db,
        organization_id=finding.organization_id,
        actor=actor,
        action="remediation.generated",
        summary=f"Generated version {remediation.version} of the remediation of {finding.code} "
        f"({len(accepted)} fixes)",
        item=audit.Item(
            "remediation", finding.id, f"{finding.code}, version {remediation.version}"
        ),
        details={
            "version": remediation.version,
            "trigger": job.trigger,
            "fixes": [fix["kind"] for fix in accepted],
            "ai_generated": remediation.ai_generated,
        },
    )
    db.commit()
    _notify(db, finding, target, remediation)


def _store(
    db: Session,
    finding: Finding,
    job: RemediationJob,
    *,
    root_cause: str,
    summary: str,
    fixes: list[dict],
    based_on: Remediation | None,
    info: dict,
) -> Remediation:
    """Steps 5-6: the draft, its fixes and where each one takes effect. A version is never
    changed afterwards; a revision is the next version (FR-8.2)."""
    version = (
        db.scalar(select(func.max(Remediation.version)).where(Remediation.finding_id == finding.id))
        or 0
    ) + 1
    remediation = Remediation(
        organization_id=finding.organization_id,
        finding_id=finding.id,
        version=version,
        status=RemediationStatus.DRAFT,
        origin=Origin.REVISED if based_on is not None else Origin.GENERATED,
        based_on_version=based_on.version if based_on is not None else None,
        root_cause=root_cause,
        summary=summary,
        # NFR-9.4: it is labelled AI-generated unless it only repeats the test's mitigation.
        ai_generated=not info.get("mitigation_only"),
        generation=info,
        requested_by_id=job.requested_by_id,
    )
    db.add(remediation)
    db.flush()
    for position, fix in enumerate(fixes, start=1):
        db.add(
            RemediationFix(
                remediation_id=remediation.id,
                position=position,
                kind=fix["kind"],
                title=fix["title"],
                description=fix["description"],
                details=fix["details"],
                enforcement=fix["enforcement"],
                enforcement_note=fix["enforcement_note"],
            )
        )
    db.flush()
    db.refresh(remediation)
    return remediation


def _propose(
    db: Session,
    finding: Finding,
    target: Target,
    definition: TestDefinition,
    previous: Remediation | None,
) -> tuple[list[ProposedFix], dict]:
    """Step 4 with 4a (no model, or it can't be used) and 4b (an answer in the wrong form is asked
    for once more). Without a model the test's recommended mitigation is the proposal."""
    profile = target_profiles.find(db, target.id)
    data = _data(db, finding, target, profile, definition, previous)
    for attempt in (1, 2):
        try:
            reply = complete(
                db,
                LLMTask.REMEDIATION,
                instructions=_instructions(),
                data=data,
                organization_id=finding.organization_id,
                schema=Proposal,
                max_tokens=2500,
            )
        except LLMUnavailable as exc:
            return [], _without_model(definition, f"{exc}")
        except LLMOutputError:
            if attempt == 1:
                continue  # 4b: asked for once more
            return [], _without_model(
                definition,
                "The model's answer didn't have the required form, also when asked again.",
            )
        assert isinstance(reply.parsed, Proposal)
        return list(reply.parsed.fixes), {
            "model": reply.model,
            "root_cause": reply.parsed.root_cause,
            "summary": reply.parsed.summary,
        }
    raise AssertionError("unreachable")


def _without_model(definition: TestDefinition, reason: str) -> dict:
    """4a: the root cause and the summary Sentra writes itself. The fix is added by the caller,
    from the recommended mitigation of the test definition (FR-4.2)."""
    return {
        "root_cause": f"The application does what the test {definition.code} "
        f"({definition.name}) checks for. Sentra couldn't ask a model for the root cause, so "
        f"this is the weakness as the test describes it: {definition.objective}",
        "summary": "The mitigation the test's author recommends.",
        "mitigation_only": f"{reason} The proposal holds the mitigation the test recommends. "
        "Ask for a revision later for fixes written for this application.",
    }


def _accept(db: Session, target: Target, proposed: list[ProposedFix]) -> tuple[list[dict], int]:
    """Step 5: only fixes Sentra can store and show. A fix of an unknown kind, a second fix of a
    kind, or one without the detail its kind needs is left out and counted. Step 6 marks each
    remaining fix as enforceable at the gateway or as a change in the application."""
    accepted: list[dict] = []
    seen: set[str] = set()
    dropped = 0
    for fix in proposed:
        kind = fix.kind.strip().lower()
        if kind not in set(FixKind) or kind in seen:
            dropped += 1
            continue
        details = _details(FixKind(kind), fix)
        if details is None:
            dropped += 1
            continue
        seen.add(kind)
        enforcement, note = fix_rules.enforcement(db, target.id, FixKind(kind))
        accepted.append(
            {
                "kind": kind,
                "title": fix.title.strip(),
                "description": fix.description.strip(),
                "details": details,
                "enforcement": enforcement,
                "enforcement_note": note,
            }
        )
    return accepted, dropped


def _details(kind: FixKind, fix: ProposedFix) -> dict | None:
    """The fix itself, under the one key its kind uses (fixes.DETAIL_KEYS). None when the model
    didn't give it, which drops the fix: a fix nobody can apply is not a fix."""
    key = fix_rules.DETAIL_KEYS[kind]
    value = getattr(fix, key)
    if not value:
        return None
    if key in ("tools", "sources"):
        return {key: [item.model_dump() for item in value]}
    if key == "prompt":
        return {key: value.strip()}
    return {key: [str(line).strip() for line in value if str(line).strip()]}


def _instructions() -> str:
    return INSTRUCTIONS.format(
        kinds="\n".join(
            f"  {kind.value} ({fix_rules.KIND_LABELS[kind].lower()})" for kind in FixKind
        ),
        limit=MAX_FIXES,
    )


def _data(
    db: Session,
    finding: Finding,
    target: Target,
    profile: TargetProfile | None,
    definition: TestDefinition,
    previous: Remediation | None,
) -> str:
    """Step 3, with quality requirement 4: only what a fix needs (NFR-9.6). The endpoint, the
    credentials and the canary tokens are never sent, and neither is the attempt's own message:
    the fix follows from what the application answered, not from the payload. The LLM layer masks
    secrets and personal data in all of it and marks it as data (NFR-3.6)."""
    lines = [
        f"Application type: {target.type}",
        f"Environment: {target.environment}",
        "",
        "Finding:",
        f"- Weakness: {finding.title}",
        f"- OWASP category: {finding.category}",
        f"- Affected component: {component_label(finding.component_kind, finding.component_name)}",
        f"- Severity: {finding.severity}",
        f"- Observed behaviour: {finding.description}",
        "",
        f"Test: {definition.code} {definition.name}",
        f"- What it checks: {definition.objective}",
        f"- When it counts as successful: {definition.success_condition}",
        f"- Recommended mitigation of its author: {definition.recommended_mitigation}",
    ]
    if evidence := _evidence(db, finding):
        lines += ["", "Evidence of the last attempt:", *evidence]
    if profile is not None:
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
                f"- {k.get('name', '')}: {k.get('description', '')} "
                f"(access: {k.get('access') or '?'})"
                for k in profile.knowledge_sources
            ]
        if profile.tools:
            lines += ["", "Tools:"]
            lines += [
                f"- {t.get('name', '')} (parameters: {t.get('parameters') or '?'}; side effect: "
                f"{t.get('side_effect') or '?'})"
                for t in profile.tools
            ]
    if previous is not None:  # 1b: a revision knows what was proposed before
        lines += [
            "",
            f"Proposal {previous.version} of this finding, which did not settle it:",
            f"- Root cause: {previous.root_cause}",
        ]
        lines += [f"- {fix.kind}: {fix.title}" for fix in previous.fixes]
    return "\n".join(lines)


def _evidence(db: Session, finding: Finding) -> list[str]:
    """What the application answered, how it was judged and which tools it called. The reply is
    shortened: the behaviour is what a fix follows from."""
    row = db.scalar(
        select(Evidence)
        .where(Evidence.finding_id == finding.id)
        .order_by(Evidence.evidence_no.desc())
        .limit(1)
    )
    if row is None:
        return []
    document = evidence_store.read(row).document  # None when the document can't be read
    if not document:
        return []
    lines = []
    if reply := (document.get("reply") or {}).get("text"):
        text = _without_canaries(db, finding.target_id, reply[:MAX_REPLY_CHARS])
        lines.append(f"- The application answered: {text}")
        if len(reply) > MAX_REPLY_CHARS:
            lines.append("- (the answer was shortened)")
    for call in document.get("tool_calls") or []:
        lines.append(f"- It called the tool {call.get('name', '?')}")
    detection = document.get("detection") or {}
    methods = [
        result["method"]
        for result in detection.get("results") or []
        if result.get("outcome") == "met"
    ]
    if methods:
        lines.append(f"- Sentra confirmed it with: {', '.join(methods)}")
    if summary := (detection.get("verdict") or {}).get("summary"):
        lines.append(f"- How it was judged: {_without_canaries(db, finding.target_id, summary)}")
    return lines


def _without_canaries(db: Session, target_id: uuid.UUID, text: str) -> str:
    """NFR-9.6: a canary token never leaves Sentra. The reply that proves the weakness often
    quotes one, and the fix follows from the behaviour, not from the token itself."""
    tokens = db.scalars(select(TargetCanary.token).where(TargetCanary.target_id == target_id)).all()
    for token in sorted((t for t in tokens if t), key=len, reverse=True):
        text = text.replace(token, "[canary token]")
    return text


def _notify(db: Session, finding: Finding, target: Target, remediation: Remediation) -> None:
    """Step 6: the person who asked for the proposal is told that the draft awaits them."""
    from app.modules.m09_reporting.notifications import notify

    if remediation.requested_by_id is None:
        return
    gateway = sum(fix.enforcement == Enforcement.GATEWAY for fix in remediation.fixes)
    text = (
        f"The remediation proposal for {finding.code} ({target.name}) is ready for your review: "
        f"{len(remediation.fixes)} fixes, {gateway} of them for Sentra Shield."
    )
    if reason := remediation.generation.get("mitigation_only"):
        text = f"{text.split(': ')[0]}. {reason}"
    notify(
        db,
        event="remediation_ready",
        user_ids=[remediation.requested_by_id],
        organization_id=finding.organization_id,
        text=text,
        subject=f"{finding.code} {finding.title}",
        link=f"/remediation/{finding.code}",
    )
