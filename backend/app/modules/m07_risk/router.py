import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, FieldValidationError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m03_threat_models.frameworks import OWASP_NAMES
from app.modules.m07_risk import attention, coverage, paths, service
from app.modules.m07_risk.schemas import (
    AttackPathsOut,
    AttentionOut,
    CoverageCellOut,
    CoverageOut,
    DashboardOut,
    DismissIn,
    FindingSeverityOut,
    MethodOut,
    TargetRiskOut,
)
from app.modules.search.service import Limiter

router = APIRouter(tags=["M7 Risk Analysis & Visualization"])

# Dismissing an attack path is an analyst's judgement about findings, like adjusting a severity
# (UC-7.5, 6a1; the actor of UC-7.1). Everyone of the organization reads the dashboards.
can_triage = require(Action.TRIAGE_FINDINGS)
# The attention panel is asked once per visit of the dashboard; a script asking hundreds of times
# a minute is refused, as the search box refuses it.
attention_limiter = Limiter(limit=60, seconds=60)


def _category(code: str | None) -> str | None:
    """The category filter of UC-7.3 step 4, as one of LLM01 to LLM10."""
    if not code:
        return None
    wanted = code.strip().upper()
    if wanted not in OWASP_NAMES:
        raise FieldValidationError("category", "Choose one of the categories LLM01 to LLM10.")
    return wanted


def _framework(name: str) -> str:
    if name not in (coverage.OWASP, coverage.ATLAS):
        raise FieldValidationError("framework", "Choose owasp or atlas.")
    return name


@router.get("/risk/dashboard")
def dashboard(
    target_id: uuid.UUID | None = None,
    days: int = Query(default=service.DEFAULT_PERIOD_DAYS, ge=1, le=3650),
    category: str | None = None,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> DashboardOut:
    """UC-7.3: the risk score of each target, its open findings by severity, all findings by
    status, the trends of the period and the OWASP coverage, for the selected target, period and
    category (Screen 42). Every member may read it."""
    data = service.dashboard(
        db,
        membership.organization_id,
        target_id=target_id,
        days=days,
        category=_category(category),
    )
    return DashboardOut.model_validate(data)


@router.get("/risk/attention")
def needs_attention(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> AttentionOut:
    """Screen 42's "Needs attention" (UC-7.3, "what should I do next"): at most five things this
    person can act on now, each with the count its own page shows. Every member may read it; what
    it lists depends on the role (attention.py)."""
    if not attention_limiter.allow(membership.user_id):
        raise AppError(
            "Too many requests in a short time. Wait a minute and try again.",
            code="too_many_requests",
            status_code=429,
        )
    return AttentionOut.model_validate(attention.of(db, membership))


@router.get("/risk/coverage")
def framework_coverage(
    target_id: uuid.UUID | None = None,
    framework: str = coverage.OWASP,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> CoverageOut:
    """UC-7.4 (Screen 43): which OWASP categories and MITRE ATLAS techniques have been tested for
    each target, and where the gaps are. Based on the campaign runs that really ran."""
    return CoverageOut.model_validate(
        coverage.matrix(
            db,
            membership.organization_id,
            target_id=target_id,
            framework=_framework(framework),
        )
    )


@router.get("/risk/coverage/{code}")
def coverage_cell(
    code: str,
    target_id: uuid.UUID,
    framework: str = coverage.OWASP,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> CoverageCellOut:
    """UC-7.4 steps 4-5: one cell of the matrix with the threats behind it, the suites that cover
    it and an accepted gap (the right panel of Screen 43)."""
    return CoverageCellOut.model_validate(
        coverage.cell(
            db,
            membership.organization_id,
            code=code,
            target_id=target_id,
            framework=_framework(framework),
        )
    )


@router.get("/targets/{target_id}/attack-paths")
def attack_paths(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> AttackPathsOut:
    """UC-7.5 (Screen 44): the target's components with its open findings on them, and the paths
    that lead from something an attacker can reach to an impact."""
    target = service.target_of(db, membership.organization_id, target_id)
    return AttackPathsOut.model_validate(paths.view(db, target))


@router.post("/targets/{target_id}/attack-paths/{path_key}/dismiss")
def dismiss_attack_path(
    target_id: uuid.UUID,
    path_key: str,
    data: DismissIn,
    membership: Membership = Depends(can_triage),
    db: Session = Depends(get_db),
) -> AttackPathsOut:
    """UC-7.5, 6a1: an analyst considers a path implausible. It is hidden from the view and from
    the reports, and the reason is kept."""
    target = service.target_of(db, membership.organization_id, target_id)
    user = db.get_one(User, membership.user_id)
    return AttackPathsOut.model_validate(paths.dismiss(db, target, user, path_key, data.reason))


@router.delete("/targets/{target_id}/attack-paths/{path_key}/dismiss")
def restore_attack_path(
    target_id: uuid.UUID,
    path_key: str,
    membership: Membership = Depends(can_triage),
    db: Session = Depends(get_db),
) -> AttackPathsOut:
    """Taking a dismissal back, so a path that was hidden by mistake is shown again."""
    target = service.target_of(db, membership.organization_id, target_id)
    user = db.get_one(User, membership.user_id)
    return AttackPathsOut.model_validate(paths.restore(db, target, user, path_key))


@router.get("/risk/method")
def method() -> MethodOut:
    """How a severity and a risk score are calculated ("How is the risk score calculated?",
    Screen 42): the same rules the code uses (FR-7.1, FR-7.2; NFR-4.2)."""
    return MethodOut.model_validate(service.how_it_works())


@router.get("/targets/{target_id}/risk")
def target_risk(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> TargetRiskOut:
    """UC-7.2: the target's current risk score with the findings it counts and its history
    (Screen 20's risk card, UC-2.7)."""
    return TargetRiskOut.model_validate(
        service.target_risk(db, membership.organization_id, target_id)
    )


@router.get("/findings/{code}/severity")
def finding_severity(
    code: str,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> FindingSeverityOut:
    """FR-7.1: the severity of one finding and the factors behind it (Screen 39, NFR-4.2)."""
    return FindingSeverityOut.model_validate(
        service.finding_severity(db, membership.organization_id, code)
    )
