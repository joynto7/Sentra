"""Framework coverage (FR-7.4, UC-7.4 Review Framework Coverage): which OWASP Top 10 for LLM
Applications (2025) categories and which MITRE ATLAS techniques have been tested for each target,
where gaps remain, and what lies outside Sentra's scope.

Coverage comes from the campaign runs that really ran, never from what a campaign planned (UC-7.4,
quality requirement 3): a category counts as tested when the target answered an attempt of a test
of that category in a run that ended. The matrix is Screen 43; the same rows, without the cells,
are the per-category table of the dashboard (Screen 42).

Only the facts are returned, never a finished sentence with a date in it: each cell carries its
status, its reason, the run it was last tested in and when the target changed, and the page writes
the dates (NFR-4.3 asks for text beside the symbols, not for English built in the backend).
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m02_targets.models import Target, TargetProfile, TargetStatus, TargetType
from app.modules.m03_threat_models import frameworks, recommendations
from app.modules.m03_threat_models.models import ThreatModel, ThreatModelStatus
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import Severity
from app.modules.m05_campaigns.models import ENDED, Attempt, AttemptStatus, Campaign, CampaignRun
from app.modules.m06_findings.models import OPEN, Finding

OWASP, ATLAS = "owasp", "atlas"
TESTED = "tested"
STALE = "stale"  # tested, but the target changed afterwards (UC-7.4 step 4, UC-2.5)
GAP = "gap"
NOT_APPLICABLE = "not_applicable"
OUT_OF_SCOPE = "out_of_scope"  # 2a1: not part of application testing
NOT_TESTABLE = "not_testable"  # the target's ownership isn't verified, so it was never tested
LABELS = {
    TESTED: "Tested",
    STALE: "Gap",  # a stale test is a gap of its own kind; the reason says which
    GAP: "Gap",
    NOT_APPLICABLE: "Not applicable",
    OUT_OF_SCOPE: "Out of scope",
    NOT_TESTABLE: "Not verified",
}
# Which status a row shows when its targets differ: a gap is what an analyst must see first.
WORST = [GAP, STALE, TESTED, NOT_APPLICABLE, NOT_TESTABLE, OUT_OF_SCOPE]
OUT_OF_SCOPE_REASON = "Out of scope — not part of application testing."
NOT_TESTABLE_REASON = "The target's ownership isn't verified, so nothing has been tested yet."
STALE_REASON = "The target changed after the last test, so the result may no longer hold."
GAP_FROM_MODEL = "The approved threat model names this, but no campaign run has tested it."
GAP_FROM_TYPE = (
    "The approved threat model doesn't name this, but a test of the library covers it for this "
    "kind of target and no campaign run has tested it."
)
NO_THREAT = "No test of Sentra's library covers this for this kind of target."
# What a category needs in the Target Profile to apply at all (Screen 43: "— No tools").
NEEDS = {"LLM06": "tools", "LLM08": "knowledge sources"}
MISSING = "The Target Profile lists no {what}."


@dataclass
class Row:
    """One category or technique, with one cell per target."""

    code: str
    name: str | None
    in_scope: bool = True
    cells: list[dict] = field(default_factory=list)
    open_by_severity: dict[str, int] = field(default_factory=dict)

    def as_json(self, *, cells: bool = True) -> dict:
        worst = min(
            (cell for cell in self.cells),
            key=lambda cell: WORST.index(cell["status"]),
            default=None,
        )
        shown = {
            "code": self.code,
            "name": self.name,
            "in_scope": self.in_scope,
            "status": worst["status"] if worst else OUT_OF_SCOPE,
            "label": LABELS[worst["status"]] if worst else LABELS[OUT_OF_SCOPE],
            "reason": worst["reason"] if worst else OUT_OF_SCOPE_REASON,
            "worst_target": worst["target_name"] if worst else None,
            "open_total": sum(self.open_by_severity.values()),
            "open_by_severity": self.open_by_severity,
        }
        return {**shown, "cells": self.cells} if cells else shown


def _empty() -> dict[str, int]:
    return {severity.value: 0 for severity in Severity}


def _targets(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID | None) -> list[Target]:
    found = list(
        db.scalars(
            scoped_select(Target, organization_id)
            .where(Target.status != TargetStatus.ARCHIVED)
            .order_by(Target.name)
        )
    )
    if target_id is None:
        return found
    chosen = [target for target in found if target.id == target_id]
    if not chosen:
        raise NotFoundError("Target not found.")
    return chosen


@dataclass
class Tested:
    """The newest ended run in which a target answered an attempt of a test of this category."""

    run_code: str
    ended_at: datetime


def _runs(
    db: Session, organization_id: uuid.UUID, targets: list[Target]
) -> tuple[dict[tuple[uuid.UUID, str], Tested], dict[tuple[uuid.UUID, str], Tested]]:
    """Quality requirement 3: what really ran. One query answers both frameworks — per run and
    test, the target, the category and the ATLAS techniques of that test."""
    rows = db.execute(
        select(
            CampaignRun.target_id,
            CampaignRun.id,
            CampaignRun.number,
            CampaignRun.ended_at,
            Campaign.number,
            TestDefinition.category,
            TestDefinition.atlas,
        )
        .join(Attempt, Attempt.campaign_run_id == CampaignRun.id)
        .join(TestDefinition, TestDefinition.id == Attempt.test_definition_id)
        .outerjoin(Campaign, Campaign.id == CampaignRun.campaign_id)
        .where(
            CampaignRun.organization_id == organization_id,
            CampaignRun.target_id.in_([target.id for target in targets]),
            CampaignRun.status.in_(ENDED),
            CampaignRun.ended_at.is_not(None),
            # The target answered it: a planned or failed attempt tested nothing (UC-7.4, QR 3)
            Attempt.status == AttemptStatus.REPLIED,
        )
        .distinct()
    ).all()
    by_category: dict[tuple[uuid.UUID, str], Tested] = {}
    by_technique: dict[tuple[uuid.UUID, str], Tested] = {}
    for target_id, run_id, number, ended_at, campaign_number, category, techniques in rows:
        # The run's code, as m05_campaigns.lifecycle.code() writes it
        code = f"R-{campaign_number:03d}-{number}" if campaign_number else f"R-{str(run_id)[:8]}"
        run = Tested(code, ended_at)
        for found, keys in ((by_category, [category]), (by_technique, list(techniques or []))):
            for key in keys:
                before = found.get((target_id, key))
                if before is None or before.ended_at < ended_at:
                    found[(target_id, key)] = run
    return by_category, by_technique


def _profiles(db: Session, targets: list[Target]) -> dict[uuid.UUID, TargetProfile]:
    rows = db.scalars(
        select(TargetProfile).where(TargetProfile.target_id.in_([target.id for target in targets]))
    ).all()
    return {profile.target_id: profile for profile in rows}


def changed_at(target: Target, profile: TargetProfile | None) -> datetime:
    """When the target was last changed, as far as Sentra knows: its own row and the last save of
    its profile. UC-7.4 step 4 means the configuration changes of UC-2.5, which FR-2.6 records;
    until then these two are the honest answer, and both move when the application is re-mapped."""
    times = [target.updated_at]
    if profile is not None:
        times += [time for time in (profile.reviewed_at, profile.mapped_at) if time is not None]
    return max(times)


def _threat_models(
    db: Session, organization_id: uuid.UUID, targets: list[Target]
) -> dict[uuid.UUID, ThreatModel]:
    """The newest approved version of each target (UC-7.4 step 4: what applies to the target)."""
    rows = db.scalars(
        scoped_select(ThreatModel, organization_id)
        .where(
            ThreatModel.target_id.in_([target.id for target in targets]),
            ThreatModel.status == ThreatModelStatus.APPROVED,
        )
        .order_by(ThreatModel.version)
    ).all()
    return {model.target_id: model for model in rows}


@dataclass
class Relevant:
    """What applies to one target, and where that comes from (UC-7.4 step 4 and 4a1): the
    categories its approved threat model names, and the ones Sentra's library can test for this
    kind of target. Both are gaps until a run has tested them; the reason says which it is, so
    a category the threat model does not name is never silently called inapplicable."""

    model_categories: set[str]
    model_techniques: set[str]
    type_categories: set[str]
    type_techniques: set[str]
    has_model: bool

    def source(self, framework: str, code: str) -> str | None:
        named = self.model_categories if framework == OWASP else self.model_techniques
        testable = self.type_categories if framework == OWASP else self.type_techniques
        if code in named:
            return GAP_FROM_MODEL
        return GAP_FROM_TYPE if code in testable else None


def _relevant(
    db: Session,
    organization_id: uuid.UUID,
    targets: list[Target],
    models: dict[uuid.UUID, ThreatModel],
) -> dict[uuid.UUID, Relevant]:
    by_type: dict[str, tuple[set[str], set[str]]] = {}
    found: dict[uuid.UUID, Relevant] = {}
    for target in targets:
        if target.type not in by_type:
            tests = recommendations.available_tests(db, organization_id, target.type)
            by_type[target.type] = (
                {test.category for test in tests},
                {technique for test in tests for technique in test.atlas},
            )
        model = models.get(target.id)
        threats = [t for t in model.threats if not t.removed] if model is not None else []
        found[target.id] = Relevant(
            {code for threat in threats for code in threat.owasp},
            {threat.atlas for threat in threats if threat.atlas},
            *by_type[target.type],
            model is not None,
        )
    return found


def _findings(
    db: Session, organization_id: uuid.UUID, targets: list[Target]
) -> tuple[dict[tuple[uuid.UUID, str], dict], dict[tuple[uuid.UUID, str], dict]]:
    """The open findings of each target by category, by technique and by severity (Screen 42's
    stacked bars and the "Open findings" column of Screen 43)."""
    rows = db.execute(
        select(Finding.target_id, Finding.category, Finding.atlas, Finding.severity).where(
            Finding.organization_id == organization_id,
            Finding.target_id.in_([target.id for target in targets]),
            Finding.status.in_(OPEN),
        )
    ).all()
    by_category: dict[tuple[uuid.UUID, str], dict[str, int]] = {}
    by_technique: dict[tuple[uuid.UUID, str], dict[str, int]] = {}
    for target_id, category, techniques, severity in rows:
        for found, keys in ((by_category, [category]), (by_technique, list(techniques or []))):
            for key in keys:
                counts = found.setdefault((target_id, key), _empty())
                counts[severity] = counts.get(severity, 0) + 1
    return by_category, by_technique


def _missing(target: Target, profile: TargetProfile | None, code: str) -> str | None:
    """Why a category cannot apply: the profile lists nothing of what it is about (Screen 43)."""
    what = NEEDS.get(code)
    if what is None:
        return None
    listed = (profile.tools if what == "tools" else profile.knowledge_sources) if profile else []
    if listed:
        return None
    # A target of this kind has them even when the profile doesn't name them yet.
    assumed = TargetType.TOOL_USING_AGENT if what == "tools" else TargetType.RAG_APPLICATION
    return None if target.type == assumed else MISSING.format(what=what)


def _cell(
    target: Target,
    profile: TargetProfile | None,
    *,
    framework: str,
    code: str,
    in_scope: bool,
    tested: Tested | None,
    relevant: Relevant,
    open_by_severity: dict[str, int],
) -> dict:
    changed = changed_at(target, profile)
    status, reason = NOT_APPLICABLE, NO_THREAT
    gap_because = relevant.source(framework, code)
    if not in_scope:
        status, reason = OUT_OF_SCOPE, OUT_OF_SCOPE_REASON
    elif target.status != TargetStatus.VERIFIED:
        status, reason = NOT_TESTABLE, NOT_TESTABLE_REASON
    elif tested is not None:
        stale = changed > tested.ended_at
        status, reason = (STALE, STALE_REASON) if stale else (TESTED, "")
    elif gap_because is not None:
        status, reason = GAP, gap_because
    else:
        reason = _missing(target, profile, code) or NO_THREAT
    return {
        "target_id": target.id,
        "target_name": target.name,
        "status": status,
        "label": LABELS[status],
        "reason": reason,
        "run": {"code": tested.run_code, "ended_at": tested.ended_at} if tested else None,
        "changed_at": changed,
        "open_findings": sum(open_by_severity.values()),
        "open_by_severity": open_by_severity,
    }


def _codes(
    framework: str,
    relevant: dict[uuid.UUID, Relevant],
    tested: dict[tuple[uuid.UUID, str], Tested],
) -> list[tuple[str, str | None, bool]]:
    """The rows: the ten OWASP categories (2a1 keeps the two out-of-scope ones in the list), or the
    ATLAS techniques of Sentra's tests together with any the threat models and the runs name."""
    if framework == OWASP:
        return [
            (code, name, code not in frameworks.OWASP_OUT_OF_SCOPE)
            for code, name in frameworks.OWASP_NAMES.items()
        ]
    # A retired technique is a row only where a stored threat model or an old test still names it.
    found = set(frameworks.ATLAS_NAMES) - set(frameworks.ATLAS_RETIRED)
    found |= {code for one in relevant.values() for code in one.model_techniques}
    found |= {code for _, code in tested}
    return [(code, frameworks.ATLAS_NAMES.get(code), True) for code in sorted(found)]


def _rows(
    db: Session,
    organization_id: uuid.UUID,
    targets: list[Target],
    framework: str,
) -> list[Row]:
    profiles = _profiles(db, targets)
    models = _threat_models(db, organization_id, targets)
    relevant = _relevant(db, organization_id, targets, models)
    categories, techniques = _runs(db, organization_id, targets)
    tested = categories if framework == OWASP else techniques
    found, found_techniques = _findings(db, organization_id, targets)
    open_findings = found if framework == OWASP else found_techniques
    rows = []
    for code, name, in_scope in _codes(framework, relevant, tested):
        row = Row(code, name, in_scope, open_by_severity=_empty())
        for target in targets:
            counts = open_findings.get((target.id, code), _empty())
            row.cells.append(
                _cell(
                    target,
                    profiles.get(target.id),
                    framework=framework,
                    code=code,
                    in_scope=in_scope,
                    tested=tested.get((target.id, code)),
                    relevant=relevant[target.id],
                    open_by_severity=counts,
                )
            )
            for severity, count in counts.items():
                row.open_by_severity[severity] += count
        rows.append(row)
    return rows


def matrix(
    db: Session,
    organization_id: uuid.UUID,
    *,
    target_id: uuid.UUID | None = None,
    framework: str = OWASP,
) -> dict:
    """UC-7.4 steps 1-4 (Screen 43): the categories or techniques against the targets, each cell
    with its status and the reason behind it."""
    targets = _targets(db, organization_id, target_id)
    rows = [row.as_json() for row in _rows(db, organization_id, targets, framework)]
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {
        "framework": framework,
        "targets": [
            {
                "id": target.id,
                "name": target.name,
                "type": target.type,
                "environment": target.environment,
                "target_status": target.status,
            }
            for target in targets
        ],
        "rows": rows,
        "by_status": counts,
        "legend": [{"status": status, "label": LABELS[status]} for status in WORST],
    }


def by_category(
    db: Session,
    organization_id: uuid.UUID,
    targets: list[Target],
) -> list[dict]:
    """The "Open findings by OWASP category" table of the dashboard (Screen 42): the same rows
    without the cells, the categories with the most open findings first."""
    rows = [row.as_json(cells=False) for row in _rows(db, organization_id, targets, OWASP)]
    rows.sort(key=lambda row: (-row["open_total"], row["code"]))
    return rows


# ---------------------------------------------------------------- one cell (Screen 43's panel)


def _threats(model: ThreatModel | None, framework: str, code: str) -> list[dict]:
    """The threats behind a cell: why the category applies to this target (UC-7.4 step 4)."""
    if model is None:
        return []
    return [
        {
            "number": threat.threat_no,
            "title": threat.title,
            "component": threat.component_name,
            "risk": threat.risk,
        }
        for threat in model.threats
        if not threat.removed
        and (code in threat.owasp if framework == OWASP else threat.atlas == code)
    ]


def _accepted(db: Session, target: Target, threats: list[dict]) -> dict | None:
    """5a1: the analyst recorded why a gap of this category is accepted (UC-3.3)."""
    numbers = {threat["number"] for threat in threats}
    rows = [
        row
        for number, row in recommendations.acceptances(db, target.id).items()
        if number in numbers
    ]
    if not rows:
        return None
    newest = max(rows, key=lambda row: row.accepted_at)
    return {
        "threat": newest.threat_no,
        "reason": newest.reason,
        "accepted_at": newest.accepted_at,
    }


def _suites(
    db: Session, organization_id: uuid.UUID, target: Target, framework: str, code: str
) -> list[dict]:
    """UC-7.4 step 5: the test suites that cover this category for this kind of target, the ones
    with the most tests for it first (FR-3.4). An empty list is 5a1: nothing covers it yet."""
    tests = recommendations.available_tests(db, organization_id, target.type)
    wanted = {
        test.code
        for test in tests
        if (test.category == code if framework == OWASP else code in test.atlas)
    }
    runnable = {test.code for test in tests}
    found = []
    for suite in recommendations.active_suites(db, organization_id):
        covering = [one for one in suite.tests if one in wanted]
        if not covering:
            continue
        found.append(
            {
                "code": suite.code,
                "name": suite.name,
                "tests": len([one for one in suite.tests if one in runnable]),
                "covering": len(covering),
            }
        )
    found.sort(key=lambda suite: (-suite["covering"], suite["name"]))
    return found


def cell(
    db: Session,
    organization_id: uuid.UUID,
    *,
    code: str,
    target_id: uuid.UUID,
    framework: str = OWASP,
) -> dict:
    """UC-7.4 steps 4-5 for one cell of the matrix (the right panel of Screen 43): the status with
    its reason, the threats behind it, an accepted gap and the suites that would cover it."""
    (target,) = _targets(db, organization_id, target_id)
    rows = {row.code: row for row in _rows(db, organization_id, [target], framework)}
    row = rows.get(code.upper())
    if row is None:
        raise NotFoundError("This framework has no such category.")
    model = _threat_models(db, organization_id, [target]).get(target.id)
    threats = _threats(model, framework, row.code)
    return {
        "framework": framework,
        "code": row.code,
        "name": row.name,
        "in_scope": row.in_scope,
        "target": {"id": target.id, "name": target.name, "type": target.type},
        "cell": row.cells[0],
        "threat_model_version": model.version if model is not None else None,
        "threats": threats,
        "accepted_gap": _accepted(db, target, threats),
        "suites": _suites(db, organization_id, target, framework, row.code),
    }
