"""Reading the detection results of a campaign run's attempts (FR-6.1; UC-5.6, UC-6.1), and the
findings with their evidence (FR-6.2, FR-6.3; UC-6.4, UC-6.5). Every member of the organization may
read them, like the runs themselves; another organization gets "not found" (NFR-3.3)."""

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import CATEGORY_NAMES, DETECTION_LABELS, DetectionMethod, Severity
from app.modules.m05_campaigns import lifecycle, runs
from app.modules.m05_campaigns.models import Attempt, Campaign, CampaignRun
from app.modules.m06_findings import evidence
from app.modules.m06_findings.models import (
    CLOSED,
    OPEN,
    DetectionResult,
    DetectionVerdict,
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    Outcome,
    component_label,
)

# The order of the methods everywhere: canary token, rule matching, tool calls, LLM judge
ORDER = {method.value: number for number, method in enumerate(DetectionMethod)}


def attempt_detection(
    db: Session, organization_id: uuid.UUID, code: str, number: int, attempt_no: int
) -> dict:
    """Each detection method's result for one attempt, and the combined verdict (UC-6.1 step 4)."""
    _, run = runs.run_row(db, organization_id, code, number)
    attempt = db.scalar(
        scoped_select(Attempt, organization_id).where(
            Attempt.campaign_run_id == run.id, Attempt.attempt_no == attempt_no
        )
    )
    if attempt is None:
        raise NotFoundError("Attempt not found.")
    verdict = db.scalar(
        scoped_select(DetectionVerdict, organization_id).where(
            DetectionVerdict.attempt_id == attempt.id
        )
    )
    results = db.scalars(
        scoped_select(DetectionResult, organization_id).where(
            DetectionResult.attempt_id == attempt.id
        )
    ).all()
    return {
        "attempt_no": attempt.attempt_no,
        "test_code": attempt.test_code,
        "verdict": verdict,
        "results": [
            {
                **{c.key: getattr(r, c.key) for c in DetectionResult.__table__.columns},
                "method_label": DETECTION_LABELS[DetectionMethod(r.method)],
            }
            for r in sorted(results, key=lambda r: ORDER.get(r.method, len(ORDER)))
        ],
    }


def run_detection(
    db: Session,
    organization_id: uuid.UUID,
    code: str,
    number: int,
    outcome: str,
    page: int,
    page_size: int,
) -> dict:
    """The verdicts of a run's attempts in the order they were planned, one page at a time
    (NFR-6.2), and how many of the run's attempts have each verdict."""
    _, run = runs.run_row(db, organization_id, code, number)
    query = (
        select(DetectionVerdict, Attempt.attempt_no, Attempt.test_code)
        .join(Attempt, Attempt.id == DetectionVerdict.attempt_id)
        .where(
            DetectionVerdict.organization_id == organization_id,
            DetectionVerdict.campaign_run_id == run.id,
        )
    )
    if outcome:
        query = query.where(DetectionVerdict.outcome == outcome)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(
        query.order_by(Attempt.attempt_no).offset((page - 1) * page_size).limit(page_size)
    ).all()
    methods: dict[uuid.UUID, dict[str, str]] = {}
    ids = [verdict.attempt_id for verdict, _, _ in rows]
    if ids:
        found = db.scalars(select(DetectionResult).where(DetectionResult.attempt_id.in_(ids)))
        for result in sorted(found, key=lambda r: ORDER.get(r.method, len(ORDER))):
            methods.setdefault(result.attempt_id, {})[result.method] = result.outcome
    counts = dict(
        db.execute(
            select(DetectionVerdict.outcome, func.count())
            .where(
                DetectionVerdict.organization_id == organization_id,
                DetectionVerdict.campaign_run_id == run.id,
            )
            .group_by(DetectionVerdict.outcome)
        ).all()
    )
    return {
        "items": [
            {
                "attempt_no": attempt_no,
                "test_code": test_code,
                "outcome": verdict.outcome,
                "decided_by": verdict.decided_by,
                "requires_confirmation": verdict.requires_confirmation,
                "disagreement": verdict.disagreement,
                "methods": methods.get(verdict.attempt_id, {}),
            }
            for verdict, attempt_no, test_code in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "counts": {o.value: counts.get(o.value, 0) for o in Outcome},
    }


# ---------------------------------------------------------------- findings (FR-6.2, FR-6.3)

# The quick views of the findings list (Screen 38); "Assigned to me" comes with FR-6.5
VIEWS = {
    "open": OPEN,
    "requires_confirmation": (FindingStatus.REQUIRES_CONFIRMATION,),
    "closed": CLOSED,
}
SEVERITY_RANK = {severity.value: rank for rank, severity in enumerate(Severity)}  # critical first
_CODE = re.compile(r"F-(\d{1,9})", re.IGNORECASE)


@dataclass
class FindingFilters:
    """UC-6.4 step 3. Empty values don't filter."""

    view: str = ""
    severity: str = ""
    category: str = ""
    status: str = ""
    target_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None  # the findings that this campaign run found or saw again
    search: str = ""  # in the title, or a finding's code such as F-012


def finding_row(db: Session, organization_id: uuid.UUID, code: str) -> Finding:
    """The finding with this code, e.g. F-012, of the organization only."""
    match = _CODE.fullmatch(code.strip())
    finding = match and db.scalar(
        scoped_select(Finding, organization_id).where(Finding.number == int(match[1]))
    )
    if not finding:
        raise NotFoundError("Finding not found.")
    return finding


def _filtered(
    organization_id: uuid.UUID, filters: FindingFilters, view: bool = True
) -> Select[tuple[Finding]]:
    query = scoped_select(Finding, organization_id)
    if view and filters.view:
        query = query.where(Finding.status.in_(VIEWS[filters.view]))
    if filters.severity:
        query = query.where(Finding.severity == filters.severity)
    if filters.category:
        query = query.where(Finding.category == filters.category)
    if filters.status:
        query = query.where(Finding.status == filters.status)
    if filters.target_id:
        query = query.where(Finding.target_id == filters.target_id)
    if filters.run_id:
        found_in_run = select(Evidence.finding_id).where(
            Evidence.organization_id == organization_id,
            Evidence.campaign_run_id == filters.run_id,
        )
        query = query.where(Finding.id.in_(found_in_run))
    if search := filters.search.strip():
        condition = Finding.title.icontains(search, autoescape=True)
        if match := _CODE.fullmatch(search):
            condition = or_(condition, Finding.number == int(match[1]))
        query = query.where(condition)
    return query


def _run_refs(db: Session, run_ids: set[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """The code of each run, such as R-001-2."""
    rows = db.execute(
        select(CampaignRun, Campaign)
        .outerjoin(Campaign, Campaign.id == CampaignRun.campaign_id)
        .where(CampaignRun.id.in_(run_ids))
    ).all()
    return {run.id: {"id": run.id, "code": lifecycle.code(run, campaign)} for run, campaign in rows}


def _item(finding: Finding, target_names: dict, run_refs: dict) -> dict:
    return {
        "code": finding.code,
        "title": finding.title,
        "severity": finding.severity,
        "status": finding.status,
        "category": finding.category,
        "category_name": CATEGORY_NAMES.get(finding.category, finding.category),
        "target": {"id": finding.target_id, "name": target_names.get(finding.target_id, "")},
        "component": {
            "kind": finding.component_kind,
            "name": finding.component_name,
            "label": component_label(finding.component_kind, finding.component_name),
        },
        "evidence_count": finding.evidence_count,
        "first_run": run_refs[finding.first_run_id],
        "last_run": run_refs[finding.last_run_id],
        "first_seen_at": finding.first_seen_at,
        "last_seen_at": finding.last_seen_at,
    }


def _target_names(db: Session, target_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    return dict(db.execute(select(Target.id, Target.name).where(Target.id.in_(target_ids))).all())


def list_findings(
    db: Session, organization_id: uuid.UUID, filters: FindingFilters, page: int, page_size: int
) -> dict:
    """UC-6.4 steps 2-4: the organization's findings, the most severe first and then the most
    recently seen, one page at a time (NFR-6.2), and how many each quick view has."""
    query = _filtered(organization_id, filters)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rank = case(SEVERITY_RANK, value=Finding.severity, else_=len(SEVERITY_RANK))
    found = db.scalars(
        query.order_by(rank, Finding.last_seen_at.desc(), Finding.number.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    everything = _filtered(organization_id, filters, view=False).subquery()
    statuses = dict(
        db.execute(select(everything.c.status, func.count()).group_by(everything.c.status)).all()
    )
    names = _target_names(db, {f.target_id for f in found})
    refs = _run_refs(db, {run for f in found for run in (f.first_run_id, f.last_run_id)})
    return {
        "items": [_item(finding, names, refs) for finding in found],
        "total": total,
        "page": page,
        "page_size": page_size,
        "counts": {
            view: sum(statuses.get(status, 0) for status in included)
            for view, included in VIEWS.items()
        },
    }


def finding_filter_options(db: Session, organization_id: uuid.UUID) -> dict:
    with_findings = select(Finding.target_id).where(Finding.organization_id == organization_id)
    targets = db.execute(
        select(Target.id, Target.name).where(Target.id.in_(with_findings)).order_by(Target.name)
    ).all()
    seen_in = select(Evidence.campaign_run_id).where(Evidence.organization_id == organization_id)
    run_rows = db.execute(
        select(CampaignRun, Campaign)
        .outerjoin(Campaign, Campaign.id == CampaignRun.campaign_id)
        .where(CampaignRun.id.in_(seen_in))
        .order_by(CampaignRun.created_at.desc(), Campaign.number.desc(), CampaignRun.number.desc())
    ).all()
    categories = db.scalars(
        select(Finding.category)
        .where(Finding.organization_id == organization_id)
        .distinct()
        .order_by(Finding.category)
    ).all()
    return {
        "targets": [{"id": target_id, "name": name} for target_id, name in targets],
        "runs": [
            {"id": run.id, "code": lifecycle.code(run, campaign)} for run, campaign in run_rows
        ],
        "categories": [{"code": c, "name": CATEGORY_NAMES.get(c, c)} for c in categories],
    }


def finding_detail(db: Session, organization_id: uuid.UUID, code: str) -> dict:
    """UC-6.5 steps 1-3 and 6: the finding with its details (FR-6.2), the version of the test
    that found it, the campaign runs it was found in, and how it was detected."""
    finding = finding_row(db, organization_id, code)
    definition = db.get_one(TestDefinition, finding.test_definition_id)
    per_run = db.execute(
        select(Evidence.campaign_run_id, func.count(), func.min(Evidence.recorded_at))
        .where(Evidence.finding_id == finding.id, Evidence.kind == EvidenceKind.ATTEMPT)
        .group_by(Evidence.campaign_run_id)
    ).all()
    first = db.scalar(
        select(Evidence)
        .where(Evidence.finding_id == finding.id, Evidence.kind == EvidenceKind.ATTEMPT)
        .order_by(Evidence.evidence_no)
        .limit(1)
    )
    run_ids = {finding.first_run_id, finding.last_run_id, *(run_id for run_id, _, _ in per_run)}
    refs = _run_refs(db, run_ids)
    return _item(finding, _target_names(db, {finding.target_id}), refs) | {
        "description": finding.description,
        "atlas": finding.atlas,
        "test": {
            "code": definition.code,
            "version": definition.version,
            "name": definition.name,
            "objective": definition.objective,
            "success_condition": definition.success_condition,
            "recommended_mitigation": definition.recommended_mitigation,
        },
        "runs": [
            refs[run_id]
            | {"attempts": count, "first_seen_at": at, "new": run_id == finding.first_run_id}
            for run_id, count, at in sorted(per_run, key=lambda row: row[2])
        ],
        "detection": _detection(db, first, refs) if first is not None else None,
        "created_at": finding.created_at,
        "updated_at": finding.updated_at,
    }


def _detection(db: Session, first: Evidence, refs: dict) -> dict | None:
    """The detection of the attempt that found the finding, as it stands now: a judge that
    answered later is included (NFR-9.4)."""
    attempt = db.get(Attempt, first.attempt_id)
    decided = db.get(DetectionVerdict, first.attempt_id)
    if attempt is None or decided is None:
        return None
    results = db.scalars(
        select(DetectionResult).where(DetectionResult.attempt_id == first.attempt_id)
    ).all()
    return {
        "attempt_no": attempt.attempt_no,
        "run": refs[first.campaign_run_id],
        "outcome": decided.outcome,
        "decided_by": decided.decided_by,
        "requires_confirmation": decided.requires_confirmation,
        "disagreement": decided.disagreement,
        "summary": decided.summary,
        "methods": [
            {
                "method": r.method,
                "method_label": DETECTION_LABELS[DetectionMethod(r.method)],
                "role": r.role,
                "outcome": r.outcome,
                "confidence": r.confidence,
            }
            for r in sorted(results, key=lambda r: ORDER.get(r.method, len(ORDER)))
        ],
    }


def _evidence_rows(organization_id: uuid.UUID, finding: Finding) -> Select:
    return (
        select(Evidence, Attempt.attempt_no)
        .join(Attempt, Attempt.id == Evidence.attempt_id)
        .where(Evidence.organization_id == organization_id, Evidence.finding_id == finding.id)
    )


def _evidence_item(row: Evidence, attempt_no: int, refs: dict) -> dict:
    return {
        "number": row.evidence_no,
        "kind": row.kind,
        "attempt_no": attempt_no,
        "run": refs[row.campaign_run_id],
        "recorded_at": row.recorded_at,
        "checksum": row.checksum,
        "size": row.size,
        "stored_in": "database" if row.content is not None else "object_storage",
    }


def list_evidence(db: Session, organization_id: uuid.UUID, code: str) -> list[dict]:
    """UC-6.5 step 4: the finding's evidence in the order it was recorded (Screen 40)."""
    finding = finding_row(db, organization_id, code)
    rows = db.execute(_evidence_rows(organization_id, finding).order_by(Evidence.evidence_no)).all()
    refs = _run_refs(db, {row.campaign_run_id for row, _ in rows})
    return [_evidence_item(row, attempt_no, refs) for row, attempt_no in rows]


def evidence_detail(db: Session, organization_id: uuid.UUID, code: str, number: int) -> dict:
    """UC-6.5 steps 4-5: one evidence record with its document, and whether the document is
    still exactly what was recorded (NFR-2.4)."""
    finding = finding_row(db, organization_id, code)
    found = db.execute(
        _evidence_rows(organization_id, finding).where(Evidence.evidence_no == number)
    ).first()
    if found is None:
        raise NotFoundError("Evidence not found.")
    row, attempt_no = found
    content = evidence.read(row)
    refs = _run_refs(db, {row.campaign_run_id})
    return _evidence_item(row, attempt_no, refs) | {
        "integrity": {
            "status": content.integrity,
            "checksum": row.checksum,
            "computed": content.computed,
        },
        "content": content.document,
    }
