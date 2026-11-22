"""Reading remediations for the pages (Screens 45 and 46)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target
from app.modules.m06_findings.models import Finding, FindingStatus, component_label
from app.modules.m06_findings.service import SEVERITY_RANK, finding_row
from app.modules.m08_remediation import changes as change_rules
from app.modules.m08_remediation import comparison, review
from app.modules.m08_remediation import fixes as fix_rules
from app.modules.m08_remediation import retest as retests
from app.modules.m08_remediation.generation import blocker
from app.modules.m08_remediation.models import (
    ApplicationChange,
    BenignOutcome,
    BenignReview,
    ChangeStatus,
    FixKind,
    JobStatus,
    Remediation,
    RemediationFix,
    RemediationJob,
    RemediationStatus,
    Retest,
    RetestBenignCheck,
    RetestStatus,
    RetestVerdict,
)
from app.modules.m08_remediation.schemas import (
    BenignCheckOut,
    ChangeList,
    ChangeOut,
    CommentOut,
    FindingRef,
    FixOut,
    FixSummary,
    JobOut,
    RemediationList,
    RemediationPage,
    RemediationRow,
    RetestOut,
    RetestSummary,
    ReviewOut,
    VersionOut,
    VersionSummary,
)


@dataclass(frozen=True)
class Reader:
    """Who is reading Screen 46: what the page may offer them (UC-8.3)."""

    user_id: uuid.UUID
    can_request: bool  # adapt a proposal and send it for approval
    can_approve: bool


def names_of(db: Session, ids) -> dict[uuid.UUID, str]:
    """The names behind a list of user ids, for the "by whom" of every row."""
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


_names = names_of


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
        edited_by=names.get(remediation.edited_by_id),
        decided_by=names.get(remediation.decided_by_id),
        decided_at=remediation.decided_at,
        decision_reason=remediation.decision_reason,
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
    db: Session,
    organization_id: uuid.UUID,
    code: str,
    version: int | None = None,
    reader: "Reader | None" = None,
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
    thread = review.comments(db, finding.id)
    names = _names(
        db,
        [r.requested_by_id for r in versions]
        + [r.edited_by_id for r in versions]
        + [r.decided_by_id for r in versions]
        + [c.author_id for c in thread]
        + [job.requested_by_id if job else None],
    )
    problem = blocker(finding)
    shown = current or (versions[0] if versions else None)
    change_rows = change_rules.of_version(db, shown.id) if shown else []
    change_names = _names(
        db,
        [one.implemented_by_id for one in change_rows] + [shown.decided_by_id if shown else None],
    )
    waiting = None
    if shown is not None and shown.status in (
        RemediationStatus.APPROVED,
        RemediationStatus.APPLYING,
    ):
        waiting = retests.all_in_effect(db, finding, shown)[1]
    elif shown is not None and shown.status in (
        RemediationStatus.EFFECTIVE,
        RemediationStatus.INEFFECTIVE,
    ):
        waiting = retests.IN_EFFECT  # a retest has judged them, so they were all in effect
    found = retests.of_finding(db, finding.id)
    by_version = {r.id: r.version for r in versions}
    return RemediationPage(
        finding=finding_ref(finding, target_name),
        blocker=problem[1] if problem else None,
        blocker_code=problem[0] if problem else None,
        job=job_out(job, names) if job else None,
        versions=[summary(r, names) for r in versions],
        current=version_out(current, names) if current else None,
        review=review_out(db, organization_id, versions, reader),
        comments=[
            CommentOut(
                id=one.id,
                version=one.version,
                author=names.get(one.author_id),
                text=one.text,
                created_at=one.created_at,
            )
            for one in thread
        ],
        changes=[change_out(db, one, change_names) for one in change_rows],
        retests=[retest_summary(one, by_version.get(one.remediation_id, 0)) for one in found],
        in_effect=waiting,
    )


def review_out(
    db: Session,
    organization_id: uuid.UUID,
    versions: list[Remediation],
    reader: Reader | None,
) -> ReviewOut:
    """UC-8.3 for the person reading the page: what they may do with the newest version, who may
    approve it, and what an approval starts (step 6)."""
    newest = versions[0] if versions else None
    people = review.approvers(db, organization_id)
    if newest is None or reader is None:
        return ReviewOut(
            can_edit=False,
            can_submit=False,
            can_approve=False,
            cannot_approve=None,
            approvers=sorted(people.values()),
            on_approval=[],
        )
    open_version = newest.status in review.OPEN
    may_approve = (
        reader.can_approve
        and newest.status == RemediationStatus.AWAITING_APPROVAL
        and newest.edited_by_id != reader.user_id
    )
    return ReviewOut(
        can_edit=reader.can_request and open_version,
        can_submit=reader.can_request and newest.status == RemediationStatus.DRAFT,
        can_approve=may_approve,
        cannot_approve=review.cannot_approve(newest, reader.user_id, reader.can_approve),
        approvers=sorted(people.values()),
        on_approval=review.on_approval(newest),
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
        return RemediationList(rows=[], drafts=0, without_proposal=0, open_changes=0, retesting=0)
    ids = [f.id for f in findings]
    newest: dict[uuid.UUID, Remediation] = {}
    version_of: dict[uuid.UUID, int] = {}
    for remediation in db.scalars(
        select(Remediation)
        .where(Remediation.finding_id.in_(ids))
        .order_by(Remediation.finding_id, Remediation.version.desc())
        .options(selectinload(Remediation.fixes))
    ).all():
        newest.setdefault(remediation.finding_id, remediation)
        version_of[remediation.id] = remediation.version
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
    newest_retest: dict[uuid.UUID, Retest] = {}
    for one in db.scalars(
        select(Retest)
        .where(Retest.finding_id.in_(ids))
        .order_by(Retest.finding_id, Retest.number.desc())
    ).all():
        newest_retest.setdefault(one.finding_id, one)
    open_changes = dict(
        db.execute(
            select(ApplicationChange.remediation_id, func.count())
            .where(
                ApplicationChange.remediation_id.in_({r.id for r in newest.values()}),
                ApplicationChange.status == ChangeStatus.OPEN,
            )
            .group_by(ApplicationChange.remediation_id)
        ).all()
    )
    rows = []
    for finding in findings:
        problem = blocker(finding)
        latest = newest.get(finding.id)
        retest = newest_retest.get(finding.id)
        rows.append(
            RemediationRow(
                finding=finding_ref(finding, targets.get(finding.target_id, "")),
                latest=summary(latest, names) if latest else None,
                job=job_out(jobs[finding.id], names) if finding.id in jobs else None,
                blocker=problem[1] if problem else None,
                blocker_code=problem[0] if problem else None,
                open_changes=open_changes.get(latest.id, 0) if latest else 0,
                retest=(
                    retest_summary(retest, version_of.get(retest.remediation_id, 0))
                    if retest
                    else None
                ),
            )
        )
    return RemediationList(
        rows=rows,
        drafts=sum(
            row.latest is not None and row.latest.status == RemediationStatus.DRAFT for row in rows
        ),
        without_proposal=sum(row.latest is None and row.blocker is None for row in rows),
        open_changes=sum(row.open_changes for row in rows),
        retesting=sum(row.retest is not None and row.retest.running for row in rows),
    )


# ------------------------------------------------- the application changes and the retests (M8)


def _fix_of(db: Session, change: ApplicationChange) -> RemediationFix | None:
    return db.get(RemediationFix, change.fix_id)


def progress_of(db: Session, remediation: Remediation, finding: Finding) -> str:
    """Screen 50's progress note: how much of the proposal is in effect, and what is still
    waiting (UC-8.5 step 1, 2b1)."""
    ready, missing = retests.all_in_effect(db, finding, remediation)
    version = retests.verified_policy_version(db, finding, remediation)
    in_effect = retests.carried_positions(db, finding, remediation) | {
        one.position
        for one in change_rules.of_version(db, remediation.id)
        if one.status == ChangeStatus.IMPLEMENTED
    }
    said = f"{len(in_effect)} of {len(remediation.fixes)} fixes in effect"
    if version is not None:
        said += f" (Shield Policy v{version} active)"
    return said + (" · the retest can start" if ready else f" · {missing}")


def change_out(db: Session, change: ApplicationChange, names: dict) -> ChangeOut:
    finding = db.get_one(Finding, change.finding_id)
    remediation = db.get_one(Remediation, change.remediation_id)
    fix = _fix_of(db, change)
    target_name = db.scalar(select(Target.name).where(Target.id == finding.target_id)) or ""
    return ChangeOut(
        id=change.id,
        finding=finding_ref(finding, target_name),
        version=remediation.version,
        position=change.position,
        title=change.title,
        description=fix.description if fix else "",
        status=change.status,
        note=change.note,
        link=change.link,
        implemented_by=names.get(change.implemented_by_id),
        implemented_at=change.implemented_at,
        approved_by=names.get(remediation.decided_by_id),
        approved_at=remediation.decided_at,
        progress=progress_of(db, remediation, finding),
    )


def changes_page(db: Session, organization_id: uuid.UUID) -> ChangeList:
    """Screen 50: every change of the organization that a developer still has to make."""
    rows = change_rules.task_list(db, organization_id)
    names = _names(db, [one.implemented_by_id for one in rows] + _deciders(db, rows))
    return ChangeList(rows=[change_out(db, one, names) for one in rows], open_changes=len(rows))


def _deciders(db: Session, rows: list[ApplicationChange]) -> list:
    if not rows:
        return []
    return list(
        db.scalars(
            select(Remediation.decided_by_id).where(
                Remediation.id.in_({one.remediation_id for one in rows})
            )
        )
    )


def retest_summary(retest: Retest, version: int) -> RetestSummary:
    verdict = RetestVerdict(retest.verdict) if retest.verdict else None
    return RetestSummary(
        id=retest.id,
        number=retest.number,
        version=version,
        status=retest.status,
        status_label=comparison.STATUS_LABELS[RetestStatus(retest.status)],
        verdict=retest.verdict,
        verdict_label=comparison.VERDICT_LABELS[verdict] if verdict else None,
        running=retest.status in retests.RUNNING,
        out_of_date=retest.out_of_date,
        started_at=retest.started_at,
        finished_at=retest.finished_at,
    )


def benign_out(check: RetestBenignCheck, names: dict) -> BenignCheckOut:
    return BenignCheckOut(
        id=check.id,
        position=check.position,
        text=check.text,
        outcome=check.outcome,
        outcome_label=comparison.OUTCOME_LABELS[BenignOutcome(check.outcome)],
        what_happened=check.what_happened,
        reply=check.reply,
        status_code=check.status_code,
        review=check.review,
        review_label=comparison.REVIEW_LABELS[BenignReview(check.review)],
        reviewed_by=names.get(check.reviewed_by_id),
        reviewed_at=check.reviewed_at,
    )


def retest_page(
    db: Session, organization_id: uuid.UUID, code: str, number: int | None = None
) -> RetestOut:
    """Screen 51: the before-and-after comparison of one retest of a finding, the newest by
    default (UC-8.7)."""
    from app.modules.m05_campaigns import lifecycle
    from app.modules.m05_campaigns.models import CampaignRun

    finding = finding_row(db, organization_id, code)
    found = retests.of_finding(db, finding.id)
    retest = (
        next((one for one in found if one.number == number), None)
        if number is not None
        else (found[0] if found else None)
    )
    if retest is None:
        raise NotFoundError("This finding has no retest.")
    remediation = db.get_one(Remediation, retest.remediation_id)
    run = db.get(CampaignRun, retest.campaign_run_id) if retest.campaign_run_id else None
    checks = retests.benign_checks(db, retest.id)
    names = _names(db, [one.reviewed_by_id for one in checks])
    target_name = db.scalar(select(Target.name).where(Target.id == finding.target_id)) or ""
    return RetestOut(
        **retest_summary(retest, remediation.version).model_dump(),
        finding=finding_ref(finding, target_name),
        conclusion=retest.conclusion,
        message=retest.message,
        run_code=lifecycle.code(run, None) if run else None,
        run_status=run.status if run else None,
        test_code=retest.test_code,
        repetitions=retest.repetitions,
        attempts_repeated=len(retest.replayed or []),
        policy_version=retest.policy_version,
        changes_marked=retest.changes_marked,
        figures=comparison.figures(retest),
        benign_checks=[benign_out(one, names) for one in checks],
        benign_generic=retest.benign_generic,
    )


def review_benign(
    db: Session, finding: Finding, user: User, check_id: uuid.UUID, judgement: str
) -> int:
    """UC-8.7 step 3: a person says whether an answer the fix changed still does its job. The
    judgement is kept with the example, so the next reader sees that somebody looked at it.
    Returns the number of the retest it belongs to."""
    if judgement not in (BenignReview.FINE, BenignReview.NEEDS_REVISION):
        raise AppError(
            'A judgement is either "fine" or "needs_revision".',
            code="validation_error",
            status_code=422,
        )
    check = db.scalar(
        scoped_select(RetestBenignCheck, finding.organization_id).where(
            RetestBenignCheck.id == check_id
        )
    )
    if check is None:
        raise NotFoundError("That request of normal use doesn't exist.")
    retest = db.get_one(Retest, check.retest_id)
    if retest.finding_id != finding.id:
        raise NotFoundError("That request of normal use belongs to another finding.")
    check.review = judgement
    check.reviewed_by_id, check.reviewed_at = user.id, datetime.now(UTC)
    db.commit()
    return retest.number
