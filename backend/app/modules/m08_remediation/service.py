"""Reading remediations for the pages (Screens 45 and 46)."""

import uuid

from sqlalchemy import case, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target
from app.modules.m06_findings.models import Finding, FindingStatus, component_label
from app.modules.m06_findings.service import SEVERITY_RANK, finding_row
from app.modules.m08_remediation import fixes as fix_rules
from app.modules.m08_remediation.generation import blocker
from app.modules.m08_remediation.models import (
    FixKind,
    JobStatus,
    Remediation,
    RemediationJob,
    RemediationStatus,
)
from app.modules.m08_remediation.schemas import (
    FindingRef,
    FixOut,
    FixSummary,
    JobOut,
    RemediationList,
    RemediationPage,
    RemediationRow,
    VersionOut,
    VersionSummary,
)


def _names(db: Session, ids) -> dict[uuid.UUID, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def finding_ref(finding: Finding, target_name: str) -> FindingRef:
    return FindingRef(
        id=finding.id,
        code=finding.code,
        title=finding.title,
        severity=finding.severity,
        status=finding.status,
        category=finding.category,
        component=component_label(finding.component_kind, finding.component_name),
        test_code=finding.test_code,
        target_id=finding.target_id,
        target_name=target_name,
    )


def summary(remediation: Remediation, names: dict) -> VersionSummary:
    return VersionSummary(
        version=remediation.version,
        status=remediation.status,
        origin=remediation.origin,
        based_on_version=remediation.based_on_version,
        ai_generated=remediation.ai_generated,
        created_at=remediation.created_at,
        requested_by=names.get(remediation.requested_by_id),
        fix_count=len(remediation.fixes),
        fixes_in_short=[
            FixSummary(
                kind=fix.kind,
                kind_label=fix_rules.KIND_LABELS[FixKind(fix.kind)],
                enforcement=fix.enforcement,
            )
            for fix in remediation.fixes
        ],
    )


def version_out(remediation: Remediation, names: dict) -> VersionOut:
    info = remediation.generation or {}
    return VersionOut(
        **summary(remediation, names).model_dump(),
        root_cause=remediation.root_cause,
        summary=remediation.summary,
        model=info.get("model"),
        dropped=info.get("dropped", 0),
        mitigation_only=info.get("mitigation_only"),
        fixes=[
            FixOut(
                position=fix.position,
                kind=fix.kind,
                kind_label=fix_rules.KIND_LABELS[FixKind(fix.kind)],
                title=fix.title,
                description=fix.description,
                details=fix.details,
                enforcement=fix.enforcement,
                enforcement_note=fix.enforcement_note,
            )
            for fix in remediation.fixes
        ],
    )


def job_out(job: RemediationJob, names: dict) -> JobOut:
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


def get_job(db: Session, finding_id: uuid.UUID, job_id: uuid.UUID) -> JobOut:
    """One generation of this finding, which the page follows until the draft is there."""
    job = db.scalar(
        select(RemediationJob).where(
            RemediationJob.id == job_id, RemediationJob.finding_id == finding_id
        )
    )
    if job is None:
        raise NotFoundError("Generation not found.")
    return job_out(job, _names(db, [job.requested_by_id]))


def _shown_job(db: Session, finding_ids: list[uuid.UUID]) -> dict[uuid.UUID, RemediationJob]:
    """The job each finding's page follows: one that still runs, or the last one that failed."""
    if not finding_ids:
        return {}
    rows = db.scalars(
        select(RemediationJob)
        .where(RemediationJob.finding_id.in_(finding_ids))
        .order_by(RemediationJob.created_at)
    ).all()
    found: dict[uuid.UUID, RemediationJob] = {}
    for job in rows:
        if job.status in (JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.FAILED):
            found[job.finding_id] = job
        else:
            found.pop(job.finding_id, None)
    return found


def _versions(db: Session, finding_id: uuid.UUID) -> list[Remediation]:
    return list(
        db.scalars(
            select(Remediation)
            .where(Remediation.finding_id == finding_id)
            .order_by(Remediation.version.desc())
            .options(selectinload(Remediation.fixes))
        ).all()
    )


def page(
    db: Session, organization_id: uuid.UUID, code: str, version: int | None = None
) -> RemediationPage:
    """Screen 46: one version of a finding's proposal, the newest by default."""
    finding = finding_row(db, organization_id, code)
    target_name = db.scalar(select(Target.name).where(Target.id == finding.target_id)) or ""
    versions = _versions(db, finding.id)
    current = versions[0] if versions else None
    if version is not None:
        current = next((r for r in versions if r.version == version), None)
        if current is None:
            raise NotFoundError(f"Version {version} of this remediation doesn't exist.")
    job = _shown_job(db, [finding.id]).get(finding.id)
    names = _names(
        db, [r.requested_by_id for r in versions] + [job.requested_by_id if job else None]
    )
    problem = blocker(finding)
    return RemediationPage(
        finding=finding_ref(finding, target_name),
        blocker=problem[1] if problem else None,
        blocker_code=problem[0] if problem else None,
        job=job_out(job, names) if job else None,
        versions=[summary(r, names) for r in versions],
        current=version_out(current, names) if current else None,
    )


def overview(db: Session, organization_id: uuid.UUID) -> RemediationList:
    """Screen 45: the findings that wait for a fix — every one an analyst has confirmed, and every
    finding that already has a proposal. The highest severity comes first."""
    rank = case(SEVERITY_RANK, value=Finding.severity, else_=len(SEVERITY_RANK))
    with_proposal = select(Remediation.finding_id).where(
        Remediation.organization_id == organization_id
    )
    findings = list(
        db.scalars(
            scoped_select(Finding, organization_id)
            .where(
                Finding.status.in_((FindingStatus.CONFIRMED, FindingStatus.REOPENED))
                | Finding.id.in_(with_proposal)
            )
            .order_by(rank, Finding.number)
        ).all()
    )
    if not findings:
        return RemediationList(rows=[], drafts=0, without_proposal=0)
    ids = [f.id for f in findings]
    newest: dict[uuid.UUID, Remediation] = {}
    for remediation in db.scalars(
        select(Remediation)
        .where(Remediation.finding_id.in_(ids))
        .order_by(Remediation.finding_id, Remediation.version.desc())
        .options(selectinload(Remediation.fixes))
    ).all():
        newest.setdefault(remediation.finding_id, remediation)
    jobs = _shown_job(db, ids)
    targets = dict(
        db.execute(
            select(Target.id, Target.name).where(Target.id.in_({f.target_id for f in findings}))
        ).all()
    )
    names = _names(
        db,
        [r.requested_by_id for r in newest.values()] + [j.requested_by_id for j in jobs.values()],
    )
    rows = []
    for finding in findings:
        problem = blocker(finding)
        latest = newest.get(finding.id)
        rows.append(
            RemediationRow(
                finding=finding_ref(finding, targets.get(finding.target_id, "")),
                latest=summary(latest, names) if latest else None,
                job=job_out(jobs[finding.id], names) if finding.id in jobs else None,
                blocker=problem[1] if problem else None,
                blocker_code=problem[0] if problem else None,
            )
        )
    return RemediationList(
        rows=rows,
        drafts=sum(
            row.latest is not None and row.latest.status == RemediationStatus.DRAFT for row in rows
        ),
        without_proposal=sum(row.latest is None and row.blocker is None for row in rows),
    )
