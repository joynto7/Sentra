"""Report generation (FR-9.1, UC-9.1 Generate Report).

A report is its own job: the row is created while a worker collects the data, fills the document
and stores the file with its checksum, and it ends as ready, empty (5a1) or failed. Executive
reports are written in plain language, technical reports keep the detail (quality requirement 1),
and findings that still require confirmation are listed apart and counted nowhere (2a1), exactly
as the risk score of FR-7.2 treats them.
"""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit, storage
from app.core.errors import FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns.models import Campaign, CampaignRun
from app.modules.m06_findings.models import OPEN, Finding, FindingStatus
from app.modules.m06_findings.service import FindingFilters, list_findings
from app.modules.m07_risk import service as risk_service
from app.modules.m08_remediation.models import Remediation, Retest, RetestStatus, RetestVerdict
from app.modules.m09_reporting import notifications, renderers
from app.modules.m09_reporting.models import (
    Report,
    ReportFormat,
    ReportScope,
    ReportStatus,
    ReportType,
)
from app.workers import jobs

PAGE = 200  # findings read per page while a report is built
DEFAULT_PERIOD_DAYS = 90


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Spec:
    """What UC-9.1 steps 1-3 ask for."""

    type: str
    scope: str
    format: str
    target_id: uuid.UUID | None = None
    campaign_run_id: uuid.UUID | None = None
    period_days: int | None = None
    category: str | None = None


# ---------------------------------------------------------------- what a report is about


def _target(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> Target:
    target = db.scalar(scoped_select(Target, organization_id).where(Target.id == target_id))
    if target is None:
        raise FieldValidationError("target_id", "That target doesn't exist.")
    return target


def _run(db: Session, organization_id: uuid.UUID, run_id: uuid.UUID) -> CampaignRun:
    run = db.scalar(scoped_select(CampaignRun, organization_id).where(CampaignRun.id == run_id))
    if run is None:
        raise FieldValidationError("campaign_run_id", "That campaign run doesn't exist.")
    return run


def run_code(db: Session, run: CampaignRun) -> str:
    campaign = db.get(Campaign, run.campaign_id) if run.campaign_id else None
    return f"R-{campaign.number:03d}-{run.number}" if campaign else f"R-{str(run.id)[:8]}"


def title_of(db: Session, organization_id: uuid.UUID, spec: Spec) -> str:
    """What the list of Screen 52 calls it."""
    kind = "Executive report" if spec.type == ReportType.EXECUTIVE else "Technical report"
    if spec.scope == ReportScope.TARGET and spec.target_id:
        return f"{kind} — {_target(db, organization_id, spec.target_id).name}"
    if spec.scope == ReportScope.CAMPAIGN_RUN and spec.campaign_run_id:
        return f"{kind} — {run_code(db, _run(db, organization_id, spec.campaign_run_id))}"
    return f"{kind} — All targets"


def check(db: Session, organization_id: uuid.UUID, spec: Spec) -> None:
    """Step 2: a scope that doesn't exist, or doesn't fit the type, is refused before any work."""
    if spec.type not in tuple(ReportType) or spec.format not in tuple(ReportFormat):
        raise FieldValidationError("type", "Choose a report type and a format.")
    if spec.scope == ReportScope.TARGET:
        if spec.target_id is None:
            raise FieldValidationError("target_id", "Choose a target.")
        _target(db, organization_id, spec.target_id)
    elif spec.scope == ReportScope.CAMPAIGN_RUN:
        if spec.campaign_run_id is None:
            raise FieldValidationError("campaign_run_id", "Choose a campaign run.")
        if spec.type == ReportType.EXECUTIVE:
            raise FieldValidationError(
                "scope", "An executive report covers a target or the organization, not one run."
            )
        _run(db, organization_id, spec.campaign_run_id)


# ---------------------------------------------------------------- collecting (step 5)


def _findings_in(db: Session, report: Report) -> list[dict]:
    """Every finding of the scope, the most severe first, read through M6's own list."""
    filters = FindingFilters(
        view="",
        severity="",
        category=report.category or "",
        status="",
        target_id=report.target_id,
        run_id=report.campaign_run_id,
        search="",
    )
    found: list[dict] = []
    page = 1
    while True:
        data = list_findings(db, report.organization_id, filters, page, PAGE)
        found.extend(data["items"])
        if len(found) >= data["total"] or not data["items"]:
            return found
        page += 1


def _split(findings: list[dict]) -> tuple[list[dict], list[dict]]:
    """2a1: what the summary counts, and what is listed apart because it needs confirmation."""
    counted = [
        one
        for one in findings
        if one["status"] != FindingStatus.REQUIRES_CONFIRMATION and one["status"] in OPEN
    ]
    unconfirmed = [one for one in findings if one["status"] == FindingStatus.REQUIRES_CONFIRMATION]
    return counted, unconfirmed


def _head(db: Session, report: Report) -> dict:
    scope = {"kind": report.scope}
    if report.target_id:
        target = db.get(Target, report.target_id)
        scope["target"] = target.name if target else ""
    if report.campaign_run_id:
        run = db.get(CampaignRun, report.campaign_run_id)
        scope["campaign_run"] = run_code(db, run) if run else ""
    if report.category:
        scope["category"] = report.category
    return {
        "code": report.code,
        "title": report.title,
        "type": report.type,
        "format": report.format,
        "generated_at": _now().isoformat(),
        "period": {
            "from": report.period_from.isoformat() if report.period_from else None,
            "to": report.period_to.isoformat() if report.period_to else None,
        },
        "scope": scope,
    }


def _executive(db: Session, report: Report) -> dict:
    """The risk summary, the trend and the recommendations, in plain language (QR 1)."""
    days = DEFAULT_PERIOD_DAYS
    if report.period_from and report.period_to:
        days = max(1, (report.period_to - report.period_from).days)
    dashboard = risk_service.dashboard(
        db,
        report.organization_id,
        target_id=report.target_id,
        days=days,
        category=report.category,
    )
    findings = _findings_in(db, report)
    counted, unconfirmed = _split(findings)
    return {
        "report": _head(db, report),
        "summary": {
            "open_total": dashboard["open_total"],
            "open_by_severity": dashboard["open_by_severity"],
            "awaiting_triage": dashboard["awaiting_triage"],
            "awaiting_remediation": dashboard["awaiting_remediation"],
            "fixed_and_verified": dashboard["fixed_and_verified"],
            "awaiting_confirmation": len(unconfirmed),
            "last_run_at": dashboard["last_run_at"],
        },
        "targets": [
            {
                "name": row["name"],
                "environment": row["environment"],
                "score": row["score"],
                "band": row["band"],
                "open_by_severity": row["open_by_severity"],
                "awaiting_confirmation": row["awaiting_confirmation"],
                "last_run_at": row["last_run_at"],
                "not_scored_reason": row["not_scored_reason"],
            }
            for row in dashboard["targets"]
        ],
        "trend": {
            "buckets": dashboard["trends"]["buckets"],
            "scores": dashboard["trends"]["scores"],
            "net_change": dashboard["trends"]["net_change"],
        },
        "coverage": [
            {
                "code": row["code"],
                "name": row["name"],
                "status": row["status"],
                "label": row["label"],
                "open_total": row["open_total"],
            }
            for row in dashboard["by_category"]
        ],
        "recommendations": _recommendations(db, report, counted),
        "unconfirmed": [
            {
                "code": one["code"],
                "title": one["title"],
                "severity": one["severity"],
                "target": one["target"]["name"],
            }
            for one in unconfirmed
        ],
        "counts": {"findings": len(counted), "unconfirmed": len(unconfirmed)},
    }


def _mitigation(db: Session, finding: Finding | None) -> str:
    """Without a proposal, what the test's author recommends (FR-4.2)."""
    if finding is None:
        return ""
    definition = db.get(TestDefinition, finding.test_definition_id)
    return definition.recommended_mitigation if definition else ""


def _recommendations(db: Session, report: Report, counted: list[dict]) -> list[dict]:
    """What to do first: the most severe findings with what Sentra recommends for them — the
    remediation proposal when there is one (FR-8.1), else the mitigation of the test (FR-4.2)."""
    top = counted[:5]
    codes = [one["code"] for one in top]
    numbers = {int(code.split("-")[1]) for code in codes if "-" in code}
    findings = {
        finding.code: finding
        for finding in db.scalars(
            scoped_select(Finding, report.organization_id).where(Finding.number.in_(numbers))
        )
    }
    proposals: dict[uuid.UUID, Remediation] = {}
    for proposal in db.scalars(
        select(Remediation)
        .where(Remediation.finding_id.in_([f.id for f in findings.values()]))
        .order_by(Remediation.finding_id, Remediation.version.desc())
    ):
        proposals.setdefault(proposal.finding_id, proposal)
    out = []
    for one in top:
        finding = findings.get(one["code"])
        proposal = proposals.get(finding.id) if finding else None
        out.append(
            {
                "code": one["code"],
                "title": one["title"],
                "severity": one["severity"],
                "target": one["target"]["name"],
                "recommendation": proposal.summary if proposal else _mitigation(db, finding),
                "source": "remediation proposal" if proposal else "test definition",
                "ai_generated": bool(proposal and proposal.ai_generated),
            }
        )
    return out


def _verified(db: Session, finding_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """UC-8.7, 5c1: what the newest completed retest of each finding measured, so that a manager
    has the before-and-after comparison as evidence for management or an audit (FR-9.1).

    It is read from the retest and not measured again: the figures were frozen when the retest ran
    (FR-8.5), and the conclusion is the sentence the people involved were given then.
    """
    from app.modules.m08_remediation import comparison

    if not finding_ids:
        return {}
    found: dict[uuid.UUID, dict] = {}
    for retest in db.scalars(
        select(Retest)
        .where(Retest.finding_id.in_(finding_ids), Retest.status == RetestStatus.COMPLETED)
        .order_by(Retest.finding_id, Retest.number.desc())
    ):
        if retest.finding_id in found:
            continue
        figures = comparison.figures(retest)
        verdict = RetestVerdict(retest.verdict) if retest.verdict else None
        found[retest.finding_id] = {
            "retest": retest.number,
            "verdict": retest.verdict,
            "verdict_label": comparison.VERDICT_LABELS[verdict] if verdict else None,
            "finished_at": retest.finished_at.isoformat() if retest.finished_at else None,
            "policy_version": retest.policy_version,
            "changes_marked": retest.changes_marked,
            "test": retest.test_code,
            "repetitions": retest.repetitions,
            "attack_success_before": figures["attack_success"]["before_words"],
            "attack_success_after": figures["attack_success"]["after_words"],
            "normal_use_affected": figures["normal_use"]["affected_words"],
            "normal_use_generic_set": retest.benign_generic,
            "risk_before": retest.risk_before,
            "risk_after": retest.risk_after,
            "conclusion": retest.conclusion,
            "out_of_date": retest.out_of_date,
        }
    return found


def _technical(db: Session, report: Report) -> dict:
    """Every finding with its detail, its evidence records and its remediation status."""
    findings = _findings_in(db, report)
    counted, unconfirmed = _split(findings)
    rows = {
        finding.code: finding
        for finding in db.scalars(
            scoped_select(Finding, report.organization_id).where(
                Finding.number.in_({int(one["code"].split("-")[1]) for one in findings} or {0})
            )
        )
    }
    verified = _verified(db, [f.id for f in rows.values()])
    proposals: dict[uuid.UUID, Remediation] = {}
    for proposal in db.scalars(
        select(Remediation)
        .where(Remediation.finding_id.in_([f.id for f in rows.values()]))
        .order_by(Remediation.finding_id, Remediation.version.desc())
    ):
        proposals.setdefault(proposal.finding_id, proposal)
    detail = []
    for one in findings:
        finding = rows.get(one["code"])
        proposal = proposals.get(finding.id) if finding else None
        detail.append(
            {
                "code": one["code"],
                "title": one["title"],
                "severity": one["severity"],
                "status": one["status"],
                "category": one["category"],
                "category_name": one.get("category_name"),
                "atlas": finding.atlas if finding else [],
                "component": one["component"]["label"],
                "target": one["target"]["name"],
                "test": finding.test_code if finding else "",
                "reproducibility": one.get("reproducibility"),
                "first_seen_at": finding.first_seen_at.isoformat() if finding else None,
                "last_seen_at": one["last_seen_at"],
                "evidence_count": finding.evidence_count if finding else 0,
                "evidence_note": "The evidence is kept in Sentra, masked and with its checksum; "
                "open the finding to read it.",
                "severity_factors": finding.severity_factors if finding else {},
                "remediation": (
                    {
                        "version": proposal.version,
                        "status": proposal.status,
                        "ai_generated": proposal.ai_generated,
                        "summary": proposal.summary,
                        "fixes": [
                            {
                                "kind": fix.kind,
                                "title": fix.title,
                                "enforcement": fix.enforcement,
                            }
                            for fix in proposal.fixes
                        ],
                    }
                    if proposal
                    else None
                ),
                "verification": verified.get(finding.id) if finding else None,
                "needs_confirmation": one["status"] == FindingStatus.REQUIRES_CONFIRMATION,
            }
        )
    return {
        "report": _head(db, report),
        "summary": {
            "findings": len(counted),
            "unconfirmed": len(unconfirmed),
            "by_severity": _by_severity(counted),
        },
        "findings": detail,
        "counts": {"findings": len(counted), "unconfirmed": len(unconfirmed)},
    }


def _by_severity(findings: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for one in findings:
        counts[one["severity"]] = counts.get(one["severity"], 0) + 1
    return counts


def document(db: Session, report: Report) -> dict:
    """The whole report as data; the renderers turn it into a file."""
    if report.type == ReportType.EXECUTIVE:
        return _executive(db, report)
    return _technical(db, report)


# ---------------------------------------------------------------- the job (steps 4-6)


def request(
    db: Session,
    *,
    organization_id: uuid.UUID,
    user: User | None,
    spec: Spec,
    schedule_id: uuid.UUID | None = None,
) -> Report:
    """Steps 1-4: the report is created and a worker fills it. Returns the row the page follows."""
    check(db, organization_id, spec)
    number = (
        db.scalar(select(func.max(Report.number)).where(Report.organization_id == organization_id))
        or 0
    ) + 1
    now = _now()
    days = spec.period_days or DEFAULT_PERIOD_DAYS
    report = Report(
        organization_id=organization_id,
        number=number,
        type=spec.type,
        scope=spec.scope,
        target_id=spec.target_id,
        campaign_run_id=spec.campaign_run_id,
        period_from=now - timedelta(days=days) if spec.type == ReportType.EXECUTIVE else None,
        period_to=now if spec.type == ReportType.EXECUTIVE else None,
        category=spec.category,
        format=spec.format,
        status=ReportStatus.GENERATING,
        title=title_of(db, organization_id, spec),
        requested_by_id=user.id if user else None,
        schedule_id=schedule_id,
    )
    db.add(report)
    db.flush()
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="report.requested",
        summary=f"Asked for {report.title} ({report.code}, {report.format.upper()})",
        item=audit.Item("report", report.id, report.code),
        details={"type": report.type, "scope": report.scope, "format": report.format},
    )
    db.commit()
    if not jobs.start(db, "report.generate", report.id):
        report.status = ReportStatus.FAILED
        report.message = "Sentra's background workers can't be reached. Try again."
        report.finished_at = _now()
        db.commit()
    return report


def generate(db: Session, report_id: uuid.UUID) -> Report:
    """Step 5: the worker collects the data, writes the file and stores it with its checksum."""
    report = db.get(Report, report_id)
    if report is None:
        raise NotFoundError("Report not found.")
    if report.status != ReportStatus.GENERATING:
        # The queue may deliver a job twice. A report that is already written, empty or failed
        # stays as it is: writing it again would fail on the object that exists and mark a good
        # report as failed.
        return report
    try:
        data = document(db, report)
        if data["counts"]["findings"] == 0 and data["counts"]["unconfirmed"] == 0:
            # 5a1: nothing in the scope, so no file is written and the page says why.
            report.status = ReportStatus.EMPTY
            report.message = "No results for the selected scope and period."
            report.summary = data["counts"]
            report.finished_at = _now()
            db.commit()
            _tell(db, report)
            return report
        content = (
            renderers.to_json(data)
            if report.format == ReportFormat.JSON
            else renderers.to_pdf(data)
        )
        # The object storage takes lower-case keys only (app/core/storage.py).
        key = f"reports/{report.organization_id}/{report.code.lower()}.{report.format}"
        storage.put(key, content)
        report.object_key = key
        report.checksum = hashlib.sha256(content).hexdigest()
        report.size_bytes = len(content)
        report.summary = data["counts"]
        report.status = ReportStatus.READY
    except Exception as problem:  # noqa: BLE001 - the page says that it failed, not how
        report.status = ReportStatus.FAILED
        report.message = f"The report could not be written: {type(problem).__name__}"
    report.finished_at = _now()
    db.commit()
    _tell(db, report)
    return report


def _tell(db: Session, report: Report) -> None:
    """Step 6: the people who asked for it, or the recipients of its schedule, get a link — never
    the file, because e-mail is not a protected channel (UC-9.2, quality requirement 6)."""
    from app.modules.m09_reporting.schedules import recipients_of  # local: schedules read reports

    who = [report.requested_by_id] if report.requested_by_id else []
    if report.schedule_id:
        who += recipients_of(db, report.schedule_id)
    if not who:
        return
    ready = report.status == ReportStatus.READY
    notifications.notify(
        db,
        event="report_ready",
        user_ids=[one for one in who if one],
        organization_id=report.organization_id,
        text=(
            f"{report.title} ({report.code}) is ready to download."
            if ready
            else f"{report.title} ({report.code}): {report.message}"
        ),
        subject=f"{report.code} {report.title}",
        link=f"/reports?report={report.code}",
    )
    db.commit()
