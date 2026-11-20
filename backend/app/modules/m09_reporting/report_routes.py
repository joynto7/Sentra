"""The reports of an organization (FR-9.1) and their schedules (FR-9.2): Screens 52 and 53."""

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit, storage
from app.core.database import get_db
from app.core.errors import ConflictError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets.models import Target
from app.modules.m05_campaigns.models import CampaignRun
from app.modules.m09_reporting import reports, schedules
from app.modules.m09_reporting.models import Report, ReportSchedule, ReportStatus
from app.modules.m09_reporting.schemas import (
    ReportList,
    ReportOut,
    ReportRequestIn,
    ScheduleIn,
    ScheduleOut,
    ScheduleUpdateIn,
)

router = APIRouter(prefix="/reports", tags=["M9 Reports"])

# UC-9.1 and UC-9.2's actors: a Security Analyst or a Security Manager asks for a report or
# schedules one. Every member of the organization reads the list and downloads what it holds.
can_generate = require(Action.GENERATE_REPORTS)
MIME = {"pdf": "application/pdf", "json": "application/json"}


def _names(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    wanted = {one for one in ids if one}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def _report_out(db: Session, report: Report, people: dict, schedule_names: dict) -> ReportOut:
    target = db.get(Target, report.target_id) if report.target_id else None
    run = db.get(CampaignRun, report.campaign_run_id) if report.campaign_run_id else None
    return ReportOut(
        id=report.id,
        code=report.code,
        title=report.title,
        type=report.type,
        scope=report.scope,
        target=target.name if target else None,
        campaign_run=reports.run_code(db, run) if run else None,
        category=report.category,
        period_from=report.period_from,
        period_to=report.period_to,
        format=report.format,
        status=report.status,
        message=report.message,
        summary=report.summary or {},
        checksum=report.checksum,
        size_bytes=report.size_bytes,
        requested_by=people.get(report.requested_by_id),
        schedule=schedule_names.get(report.schedule_id),
        created_at=report.created_at,
        finished_at=report.finished_at,
    )


def _schedule_out(db: Session, schedule: ReportSchedule, people: dict) -> ScheduleOut:
    target = db.get(Target, schedule.target_id) if schedule.target_id else None
    allowed = schedules.members(db, schedule.organization_id)
    return ScheduleOut(
        id=schedule.id,
        name=schedule.name,
        type=schedule.type,
        scope=schedule.scope,
        target=target.name if target else None,
        category=schedule.category,
        period_days=schedule.period_days,
        format=schedule.format,
        frequency=schedule.frequency,
        status=schedule.status,
        recipients=[
            {"id": one, "name": allowed[uuid.UUID(one)]}
            for one in schedule.recipient_ids
            if uuid.UUID(one) in allowed
        ],
        created_by=people.get(schedule.created_by_id),
        created_at=schedule.created_at,
        next_run_at=schedule.next_run_at,
        last_run_at=schedule.last_run_at,
    )


@router.get("")
def list_reports(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> ReportList:
    """Screen 52: the organization's reports, the newest first, with its schedules."""
    rows = list(
        db.scalars(
            scoped_select(Report, membership.organization_id).order_by(Report.created_at.desc())
        )
    )
    plans = schedules.schedules_of(db, membership.organization_id)
    people = _names(
        db,
        {one.requested_by_id for one in rows} | {one.created_by_id for one in plans},
    )
    names = {plan.id: plan.name for plan in plans}
    return ReportList(
        rows=[_report_out(db, one, people, names) for one in rows],
        schedules=[_schedule_out(db, plan, people) for plan in plans],
        members=schedules.member_options(db, membership.organization_id),
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def generate(
    data: ReportRequestIn,
    membership: Membership = Depends(can_generate),
    db: Session = Depends(get_db),
) -> ReportOut:
    """UC-9.1 steps 1-4: a worker writes it; the page follows the report's own status."""
    user = db.get_one(User, membership.user_id)
    report = reports.request(
        db,
        organization_id=membership.organization_id,
        user=user,
        spec=reports.Spec(
            type=data.type,
            scope=data.scope,
            format=data.format,
            target_id=data.target_id,
            campaign_run_id=data.campaign_run_id,
            period_days=data.period_days,
            category=data.category,
        ),
    )
    return _report_out(db, report, {user.id: user.name}, {})


@router.get("/{code}")
def get_report(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> ReportOut:
    """One report, which the page polls while a worker writes it."""
    report = _row(db, membership.organization_id, code)
    people = _names(db, {report.requested_by_id})
    schedule = db.get(ReportSchedule, report.schedule_id) if report.schedule_id else None
    return _report_out(db, report, people, {schedule.id: schedule.name} if schedule else {})


@router.get("/{code}/download")
def download(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> Response:
    """Step 6: the file itself. It opens only after login, and the export is recorded in the audit
    log (step 7, FR-10.2)."""
    report = _row(db, membership.organization_id, code)
    if report.status != ReportStatus.READY or not report.object_key:
        raise ConflictError(report.message or "This report has no file.", code="report_not_ready")
    content = storage.get(report.object_key)
    user = db.get_one(User, membership.user_id)
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="report.downloaded",
        summary=f"Downloaded {report.title} ({report.code}, {report.format.upper()})",
        item=audit.Item("report", report.id, report.code),
        details={"checksum": report.checksum},
    )
    db.commit()
    return Response(
        content=content,
        media_type=MIME[report.format],
        headers={
            "Content-Disposition": f'attachment; filename="{report.code}.{report.format}"',
            "X-Checksum-Sha256": report.checksum or "",
        },
    )


def _row(db: Session, organization_id: uuid.UUID, code: str) -> Report:
    number = int(code.split("-")[1]) if "-" in code and code.split("-")[1].isdigit() else 0
    report = db.scalar(scoped_select(Report, organization_id).where(Report.number == number))
    if report is None:
        raise NotFoundError("Report not found.")
    return report


# ---------------------------------------------------------------- schedules (FR-9.2)


@router.post("/schedules", status_code=status.HTTP_201_CREATED)
def create_schedule(
    data: ScheduleIn,
    membership: Membership = Depends(can_generate),
    db: Session = Depends(get_db),
) -> ScheduleOut:
    """UC-9.2 steps 1-4."""
    user = db.get_one(User, membership.user_id)
    schedule = schedules.create(
        db,
        organization_id=membership.organization_id,
        user=user,
        name=data.name,
        spec=reports.Spec(
            type=data.type,
            scope=data.scope,
            format=data.format,
            target_id=data.target_id,
            period_days=data.period_days,
            category=data.category,
        ),
        frequency=data.frequency,
        recipient_ids=data.recipient_ids,
    )
    return _schedule_out(db, schedule, {user.id: user.name})


@router.patch("/schedules/{schedule_id}")
def change_schedule(
    schedule_id: uuid.UUID,
    data: ScheduleUpdateIn,
    membership: Membership = Depends(can_generate),
    db: Session = Depends(get_db),
) -> ScheduleOut:
    """UC-9.2, 4a1: the change applies from the next report."""
    user = db.get_one(User, membership.user_id)
    schedule = schedules.update(
        db,
        membership.organization_id,
        user,
        schedule_id,
        name=data.name,
        recipient_ids=data.recipient_ids,
        frequency=data.frequency,
        status=data.status,
    )
    return _schedule_out(db, schedule, {user.id: user.name})


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: uuid.UUID,
    membership: Membership = Depends(can_generate),
    db: Session = Depends(get_db),
) -> None:
    """UC-9.2, 4a: the schedule goes; the reports it produced stay."""
    user = db.get_one(User, membership.user_id)
    schedules.delete(db, membership.organization_id, user, schedule_id)


@router.post("/schedules/{schedule_id}/run", status_code=status.HTTP_202_ACCEPTED)
def run_now(
    schedule_id: uuid.UUID,
    membership: Membership = Depends(can_generate),
    db: Session = Depends(get_db),
) -> ReportOut:
    """Producing the next report of a schedule by hand, which is what the scheduler will do."""
    user = db.get_one(User, membership.user_id)
    schedule = schedules.row(db, membership.organization_id, schedule_id)
    report = schedules.run_schedule(db, schedule)
    return _report_out(db, report, {user.id: user.name}, {schedule.id: schedule.name})


@router.get("/_filters/options")
def options(
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    """What Screen 53 offers as a scope: the targets and the newest campaign runs."""
    targets = [
        {"id": str(one.id), "name": one.name}
        for one in db.scalars(
            scoped_select(Target, membership.organization_id).order_by(Target.name)
        )
    ]
    runs = [
        {"id": str(one.id), "code": reports.run_code(db, one), "target_id": str(one.target_id)}
        for one in db.scalars(
            scoped_select(CampaignRun, membership.organization_id)
            .order_by(CampaignRun.created_at.desc())
            .limit(limit)
        )
    ]
    return {"targets": targets, "campaign_runs": runs}
