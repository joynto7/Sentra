"""Reading threat models for the pages (Screens 25 and 26)."""

import uuid
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets import profile as target_profiles
from app.modules.m02_targets.models import ProfileStatus, Target, TargetProfile, TargetStatus
from app.modules.m03_threat_models import frameworks, generation
from app.modules.m03_threat_models.models import (
    JobStatus,
    Threat,
    ThreatModel,
    ThreatModelJob,
    ThreatModelStatus,
)
from app.modules.m03_threat_models.schemas import (
    ComponentOut,
    FrameworkRef,
    JobOut,
    TargetRef,
    ThreatModelList,
    ThreatModelPage,
    ThreatModelRow,
    ThreatOut,
    VersionOut,
    VersionSummary,
)


def _names(db: Session, ids) -> dict[uuid.UUID, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def target_ref(target: Target) -> TargetRef:
    return TargetRef(
        id=target.id,
        name=target.name,
        type=target.type,
        environment=target.environment,
        host=urlsplit(target.endpoint_url).hostname or target.endpoint_url,
        status=target.status,
    )


def _counts(db: Session, model_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not model_ids:
        return {}
    rows = db.execute(
        select(Threat.threat_model_id, func.count())
        .where(Threat.threat_model_id.in_(model_ids), Threat.removed.is_(False))
        .group_by(Threat.threat_model_id)
    ).all()
    return dict(rows)


def summary(model: ThreatModel, names: dict, count: int) -> VersionSummary:
    return VersionSummary(
        version=model.version,
        status=model.status,
        origin=model.origin,
        ai_generated=model.ai_generated,
        created_at=model.created_at,
        created_by=names.get(model.created_by_id),
        approved_at=model.approved_at,
        approved_by=names.get(model.approved_by_id),
        threat_count=count,
    )


def owasp_ref(code: str) -> FrameworkRef:
    return FrameworkRef(
        code=code,
        name=frameworks.OWASP_NAMES.get(code),
        in_scope=code not in frameworks.OWASP_OUT_OF_SCOPE,
    )


def atlas_ref(technique: str | None) -> FrameworkRef | None:
    if not technique:
        return None
    return FrameworkRef(code=technique, name=frameworks.ATLAS_NAMES.get(technique))


def threat_out(threat: Threat, names: dict) -> ThreatOut:
    return ThreatOut(
        number=threat.threat_no,
        title=threat.title,
        component_kind=threat.component_kind,
        component_name=threat.component_name,
        owasp=[owasp_ref(code) for code in threat.owasp],
        atlas=atlas_ref(threat.atlas),
        likelihood=threat.likelihood,
        impact=threat.impact,
        risk=threat.risk,
        source=threat.source,
        rationale=threat.rationale,
        rated_by=names.get(threat.rated_by_id),
        edited_by=names.get(threat.edited_by_id),
        change_reason=threat.change_reason,
        removed=threat.removed,
        removal_reason=threat.removal_reason,
    )


def version_out(db: Session, model: ThreatModel) -> VersionOut:
    threats = list(model.threats)
    names = _names(
        db,
        [model.created_by_id, model.approved_by_id]
        + [t.rated_by_id for t in threats]
        + [t.edited_by_id for t in threats],
    )
    active = [t for t in threats if not t.removed]
    listed = {(c["kind"], c["name"]) for c in model.components}
    # Outputs that people named on the threats they added are components too (UC-3.2 step 3).
    extra = [
        {"kind": t.component_kind, "name": t.component_name, "note": ""}
        for t in threats
        if (t.component_kind, t.component_name) not in listed
    ]
    parts = list(model.components) + list({(e["kind"], e["name"]): e for e in extra}.values())
    info = model.generation or {}
    return VersionOut(
        **summary(model, names, len(active)).model_dump(),
        based_on_version=model.based_on_version,
        profile_version=model.profile_version,
        trigger=info.get("trigger"),
        model=info.get("model"),
        suggested=info.get("suggested", 0),
        dropped=info.get("dropped", 0),
        baseline_only=info.get("baseline_only"),
        components=[
            ComponentOut(
                kind=c["kind"],
                name=c["name"],
                note=c.get("note", ""),
                threats=sum(
                    t.component_kind == c["kind"] and t.component_name == c["name"] for t in active
                ),
            )
            for c in parts
        ],
        threats=[
            threat_out(t, names)
            for t in sorted(threats, key=lambda t: (t.removed, -t.risk, t.threat_no))
        ],
    )


def job_out(job: ThreatModelJob, names: dict) -> JobOut:
    return JobOut(
        id=job.id,
        status=job.status,
        trigger=job.trigger,
        requested_by=names.get(job.requested_by_id),
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        version=job.version,
        message=job.message,
    )


def _shown_jobs(
    db: Session, targets: list[Target], newest: dict
) -> dict[uuid.UUID, ThreatModelJob]:
    """Per target: the job that waits or runs, else the last job if it failed after the newest
    version was made, so its reason is shown."""
    if not targets:
        return {}
    jobs = db.scalars(
        select(ThreatModelJob)
        .where(ThreatModelJob.target_id.in_([t.id for t in targets]))
        .order_by(ThreatModelJob.created_at.desc())
    ).all()
    by_target: dict[uuid.UUID, list[ThreatModelJob]] = {}
    for job in jobs:
        by_target.setdefault(job.target_id, []).append(job)
    shown: dict[uuid.UUID, ThreatModelJob] = {}
    for target_id, items in by_target.items():
        active = next((j for j in items if j.status == JobStatus.RUNNING), None) or next(
            (j for j in items if j.status == JobStatus.QUEUED), None
        )
        model = newest.get(target_id)
        if active is not None:
            shown[target_id] = active
        elif items[0].status == JobStatus.FAILED and (
            model is None or items[0].created_at > model.created_at
        ):
            shown[target_id] = items[0]
    return shown


def page(db: Session, target: Target, version: int | None = None) -> ThreatModelPage:
    models = db.scalars(
        select(ThreatModel)
        .where(ThreatModel.target_id == target.id)
        .order_by(ThreatModel.version.desc())
        .options(selectinload(ThreatModel.threats))
    ).all()
    current = models[0] if models else None
    if version is not None:
        current = next((m for m in models if m.version == version), None)
        if current is None:
            raise NotFoundError(f"Version {version} of this threat model doesn't exist.")
    job = _shown_jobs(db, [target], {target.id: models[0]} if models else {}).get(target.id)
    names = _names(
        db,
        [m.created_by_id for m in models]
        + [m.approved_by_id for m in models]
        + [job.requested_by_id if job else None],
    )
    counts = {m.id: sum(not t.removed for t in m.threats) for m in models}
    problem = generation.blocker(target, target_profiles.find(db, target.id))
    return ThreatModelPage(
        target=target_ref(target),
        blocker=problem[1] if problem else None,
        blocker_code=problem[0] if problem else None,
        job=job_out(job, names) if job else None,
        versions=[summary(m, names, counts[m.id]) for m in models],
        current=version_out(db, current) if current else None,
    )


def overview(db: Session, organization_id: uuid.UUID) -> ThreatModelList:
    """Screen 25: every target that isn't archived, with its newest and its approved version."""
    targets = db.scalars(
        scoped_select(Target, organization_id)
        .where(Target.status != TargetStatus.ARCHIVED)
        .order_by(Target.name)
    ).all()
    ids = [t.id for t in targets]
    models = (
        db.scalars(
            select(ThreatModel)
            .where(ThreatModel.target_id.in_(ids))
            .order_by(ThreatModel.target_id, ThreatModel.version.desc())
        ).all()
        if ids
        else []
    )
    newest: dict[uuid.UUID, ThreatModel] = {}
    approved: dict[uuid.UUID, ThreatModel] = {}
    for model in models:
        newest.setdefault(model.target_id, model)
        if model.status == ThreatModelStatus.APPROVED:
            approved.setdefault(model.target_id, model)
    shown = list(newest.values()) + list(approved.values())
    counts = _counts(db, [m.id for m in shown])
    jobs = _shown_jobs(db, list(targets), newest)
    names = _names(
        db,
        [m.created_by_id for m in shown]
        + [m.approved_by_id for m in shown]
        + [j.requested_by_id for j in jobs.values()],
    )
    profiles = (
        {
            p.target_id: p
            for p in db.scalars(select(TargetProfile).where(TargetProfile.target_id.in_(ids)))
        }
        if ids
        else {}
    )
    rows = []
    for target in targets:
        problem = generation.blocker(target, profiles.get(target.id))
        latest, good = newest.get(target.id), approved.get(target.id)
        profile = profiles.get(target.id)
        rows.append(
            ThreatModelRow(
                target=target_ref(target),
                profile_reviewed=profile is not None and profile.status == ProfileStatus.REVIEWED,
                latest=summary(latest, names, counts.get(latest.id, 0)) if latest else None,
                approved=summary(good, names, counts.get(good.id, 0)) if good else None,
                job=job_out(jobs[target.id], names) if target.id in jobs else None,
                blocker=problem[1] if problem else None,
                blocker_code=problem[0] if problem else None,
            )
        )
    return ThreatModelList(
        rows=rows,
        drafts_to_review=sum(m.status == ThreatModelStatus.DRAFT for m in newest.values()),
        approved=sum(m.status == ThreatModelStatus.APPROVED for m in newest.values()),
        without_threat_model=sum(
            t.status == TargetStatus.VERIFIED and t.id not in newest for t in targets
        ),
    )


def get_job(db: Session, target_id: uuid.UUID, job_id: uuid.UUID) -> JobOut:
    job = db.scalar(
        select(ThreatModelJob).where(
            ThreatModelJob.id == job_id, ThreatModelJob.target_id == target_id
        )
    )
    if job is None:
        raise NotFoundError("Generation not found.")
    return job_out(job, _names(db, [job.requested_by_id]))
