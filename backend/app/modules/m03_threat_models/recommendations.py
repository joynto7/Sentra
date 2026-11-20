"""UC-3.3 Review Test Suite Recommendations (FR-3.4): the test suites that address the threats
of the approved threat model, ordered by risk; the threats no test covers; the selection saved as
the default for the target's new campaigns (Module 5)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target
from app.modules.m03_threat_models import frameworks
from app.modules.m03_threat_models.models import (
    Threat,
    ThreatGapAcceptance,
    ThreatModel,
    ThreatModelSelection,
    ThreatModelStatus,
)
from app.modules.m04_tests.models import TestDefinition, TestSuite
from app.modules.m04_tests.suites import ATTEMPTS_PER_TEST

MIN_REASON = 5
NO_APPROVED = "Approve the threat model first. Recommendations are based on the approved version."


def newest_approved(db: Session, target_id: uuid.UUID) -> ThreatModel | None:
    return db.scalar(
        select(ThreatModel)
        .where(ThreatModel.target_id == target_id, ThreatModel.status == ThreatModelStatus.APPROVED)
        .order_by(ThreatModel.version.desc())
        .limit(1)
    )


def _visible(model, organization_id: uuid.UUID):
    return or_(model.organization_id.is_(None), model.organization_id == organization_id)


def available_tests(db: Session, organization_id: uuid.UUID, target_type: str | None) -> list:
    """The tests that can run against a target of this type (every type for None): current, not
    retired, built-in or the organization's own (FR-4.3)."""
    tests = db.scalars(
        select(TestDefinition).where(
            TestDefinition.is_current.is_(True),
            TestDefinition.retired.is_(False),
            _visible(TestDefinition, organization_id),
        )
    ).all()
    return [t for t in tests if target_type is None or target_type in t.target_types]


def coverage(threats: list[Threat], tests: list) -> dict[int, set[str]]:
    """Per threat (step 1): the codes of the tests whose category is one of its categories."""
    by_category: dict[str, set[str]] = {}
    for test in tests:
        by_category.setdefault(test.category, set()).add(test.code)
    return {
        t.threat_no: {code for category in t.owasp for code in by_category.get(category, set())}
        for t in threats
        if not t.removed
    }


def active_suites(db: Session, organization_id: uuid.UUID) -> list[TestSuite]:
    """The suites a campaign can use: the current version of each, not archived, built-in or the
    organization's own. M7's framework coverage reads them too (UC-7.4 step 5)."""
    return list(
        db.scalars(
            select(TestSuite).where(
                TestSuite.is_current.is_(True),
                TestSuite.status == "active",
                _visible(TestSuite, organization_id),
            )
        )
    )


def selection(db: Session, target_id: uuid.UUID) -> ThreatModelSelection | None:
    return db.scalar(
        select(ThreatModelSelection)
        .where(ThreatModelSelection.target_id == target_id)
        .order_by(ThreatModelSelection.saved_at.desc())
        .limit(1)
    )


def acceptances(db: Session, target_id: uuid.UUID) -> dict[int, ThreatGapAcceptance]:
    """The newest accepted gap of each threat number of the target."""
    rows = db.scalars(
        select(ThreatGapAcceptance)
        .where(ThreatGapAcceptance.target_id == target_id)
        .order_by(ThreatGapAcceptance.accepted_at)
    ).all()
    return {row.threat_no: row for row in rows}


class Plan:
    """The recommendation of one approved version: per suite, the threats it addresses."""

    def __init__(self, db: Session, organization_id: uuid.UUID, target: Target, model):
        self.model = model
        self.threats = sorted(
            (t for t in model.threats if not t.removed), key=lambda t: (-t.risk, t.threat_no)
        )
        tests = available_tests(db, organization_id, target.type)
        self.test_codes = {t.code for t in tests}
        self.covered = coverage(self.threats, tests)
        self.suites = []
        for suite in active_suites(db, organization_id):
            runnable = [code for code in suite.tests if code in self.test_codes]
            if not runnable:
                continue  # none of its tests applies to this type of target
            addressed = [t for t in self.threats if self.covered[t.threat_no] & set(runnable)]
            self.suites.append((suite, runnable, addressed))
        # Step 2: by the risk of the threats they address (likelihood × impact)
        self.suites.sort(
            key=lambda s: (
                not s[2],
                -max((t.risk for t in s[2]), default=0),
                len(s[1]),
                s[0].name,
            )
        )

    def proposal(self) -> list[str]:
        """Sentra's preselection: for each threat, from the highest risk down, the smallest suite
        that covers it, unless a chosen suite covers it already. Broad suites such as Full
        Assessment stay available without doubling the tests."""
        chosen: list[str] = []
        covered: set[int] = set()
        for threat in self.threats:
            if threat.threat_no in covered or not self.covered[threat.threat_no]:
                continue
            options = [s for s in self.suites if threat in s[2]]
            if not options:
                continue
            suite, _, addressed = min(options, key=lambda s: (len(s[1]), s[0].name))
            chosen.append(suite.code)
            covered |= {t.threat_no for t in addressed}
        return chosen

    def covered_by(self, codes: list[str]) -> set[int]:
        """The threats the tests of these suites cover."""
        wanted = set(codes)
        return {t.threat_no for s in self.suites if s[0].code in wanted for t in s[2]}


def recommendations(db: Session, target: Target) -> dict:
    model = newest_approved(db, target.id)
    if model is None:
        raise ConflictError(NO_APPROVED, code="no_approved_threat_model")
    plan = Plan(db, target.organization_id, target, model)
    saved = selection(db, target.id)
    chosen = set(saved.suites) if saved else set(plan.proposal())
    accepted = acceptances(db, target.id)
    versions_of = dict(
        db.execute(
            select(ThreatModel.id, ThreatModel.version).where(ThreatModel.target_id == target.id)
        ).all()
    )
    ids = [model.approved_by_id, model.created_by_id, saved.saved_by_id if saved else None]
    ids += [a.accepted_by_id for a in accepted.values()]
    names = dict(
        db.execute(select(User.id, User.name).where(User.id.in_({i for i in ids if i}))).all()
    )
    gaps = []
    for threat in plan.threats:
        if plan.covered[threat.threat_no]:
            continue
        acceptance = accepted.get(threat.threat_no)
        gaps.append(
            {
                "number": threat.threat_no,
                "title": threat.title,
                "component_name": threat.component_name,
                "owasp": [
                    {
                        "code": code,
                        "name": frameworks.OWASP_NAMES.get(code),
                        "in_scope": code not in frameworks.OWASP_OUT_OF_SCOPE,
                    }
                    for code in threat.owasp
                ],
                "risk": threat.risk,
                "out_of_scope": set(threat.owasp) <= frameworks.OWASP_OUT_OF_SCOPE,
                "accepted": {
                    "reason": acceptance.reason,
                    "accepted_by": names.get(acceptance.accepted_by_id),
                    "accepted_at": acceptance.accepted_at,
                    "version": versions_of.get(acceptance.threat_model_id, 0),
                }
                if acceptance
                else None,
            }
        )
    return {
        "model": model,
        "names": names,
        "threats_total": len(plan.threats),
        "threats_covered": sum(bool(plan.covered[t.threat_no]) for t in plan.threats),
        "suites": [
            {
                "code": suite.code,
                "name": suite.name,
                "purpose": suite.purpose,
                "version": suite.version,
                "origin": suite.origin,
                "tests": len(runnable),
                "attempts": len(runnable) * ATTEMPTS_PER_TEST,
                "threats": [
                    {"number": t.threat_no, "title": t.title, "risk": t.risk} for t in addressed
                ],
                "top_risk": max((t.risk for t in addressed), default=0),
                "recommended": bool(addressed),
                "selected": suite.code in chosen,
            }
            for suite, runnable, addressed in plan.suites
        ],
        "gaps": gaps,
        "selection": {
            "version": versions_of.get(saved.threat_model_id, 0),
            "suites": list(saved.suites),
            "uncovered": list(saved.uncovered),
            "saved_by": names.get(saved.saved_by_id),
            "saved_at": saved.saved_at,
            "current": saved.threat_model_id == model.id,
        }
        if saved
        else None,
    }


def _approved_version(db: Session, target: Target, version: int) -> ThreatModel:
    model = newest_approved(db, target.id)
    if model is None:
        raise ConflictError(NO_APPROVED, code="no_approved_threat_model")
    if model.version != version:
        raise ConflictError(
            f"Version {model.version} is the approved version now. Review its recommendations "
            "first.",
            code="newer_version",
            details=[{"field": "version", "message": str(model.version)}],
        )
    return model


def save_selection(
    db: Session, target: Target, user: User, version: int, codes: list[str]
) -> ThreatModelSelection:
    """Steps 5-6: the default for new campaigns of the target. The threats the chosen suites
    leave uncovered are recorded with it."""
    model = _approved_version(db, target, version)
    plan = Plan(db, target.organization_id, target, model)
    usable = {suite.code for suite, _, _ in plan.suites}
    codes = list(dict.fromkeys(code.strip() for code in codes))
    if not codes:
        raise AppError(
            "Some fields are invalid.",
            code="validation_error",
            status_code=422,
            details=[{"field": "suites", "message": "Choose at least one test suite."}],
        )
    if missing := [code for code in codes if code not in usable]:
        raise AppError(
            "Some fields are invalid.",
            code="validation_error",
            status_code=422,
            details=[
                {
                    "field": "suites",
                    "message": f"Not found, archived or not for this target: {', '.join(missing)}.",
                }
            ],
        )
    covered = plan.covered_by(codes)
    uncovered = [t.threat_no for t in plan.threats if t.threat_no not in covered]
    row = ThreatModelSelection(
        organization_id=target.organization_id,
        target_id=target.id,
        threat_model_id=model.id,
        suites=codes,
        uncovered=uncovered,
        saved_by_id=user.id,
        saved_at=datetime.now(UTC),
    )
    db.add(row)
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="threat_model.selection_saved",
        summary=f"Saved {len(codes)} test suites as the default for new campaigns of "
        f"{target.name} (threat model version {model.version})",
        item=audit.Item("threat_model", target.id, f"{target.name}, version {model.version}"),
        details={"version": model.version, "suites": codes, "uncovered": uncovered},
    )
    db.commit()
    return row


def accept_gap(
    db: Session, target: Target, user: User, version: int, number: int, reason: str
) -> ThreatGapAcceptance:
    """3a1: the reason for accepting a threat that no test covers. The threat stays listed, now
    with the reason (quality requirement 3)."""
    model = _approved_version(db, target, version)
    plan = Plan(db, target.organization_id, target, model)
    threat = next((t for t in plan.threats if t.threat_no == number), None)
    problem = None
    if threat is None:
        problem = f"Version {version} has no threat {number}."
    elif plan.covered[number]:
        problem = "A test covers this threat, so there is no gap to accept."
    elif len(reason.strip()) < MIN_REASON:
        problem = "Give a reason for accepting the gap."
    if problem:
        raise AppError(
            "Some fields are invalid.",
            code="validation_error",
            status_code=422,
            details=[{"field": "reason" if threat else "threat", "message": problem}],
        )
    row = ThreatGapAcceptance(
        organization_id=target.organization_id,
        target_id=target.id,
        threat_model_id=model.id,
        threat_no=number,
        reason=reason.strip(),
        accepted_by_id=user.id,
        accepted_at=datetime.now(UTC),
    )
    db.add(row)
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="threat_model.gap_accepted",
        summary=f"Accepted that no test covers threat {number} of {target.name}: {reason.strip()}",
        item=audit.Item("threat_model", target.id, f"{target.name}, version {model.version}"),
        details={"version": model.version, "threat": number},
    )
    db.commit()
    return row


def campaign_brief(
    db: Session, organization_id: uuid.UUID, target: Target, codes: list[str]
) -> dict | None:
    """UC-5.1 step 2 for the campaign builder: the approved version, the suites to preselect
    and how many of its threats the chosen suites cover. None when there is no approved
    threat model (2a)."""
    model = newest_approved(db, target.id)
    if model is None:
        return None
    plan = Plan(db, organization_id, target, model)
    saved = selection(db, target.id)
    defaults = list(saved.suites) if saved else plan.proposal()
    approver = db.get(User, model.approved_by_id) if model.approved_by_id else None
    return {
        "version": model.version,
        "approved_at": model.approved_at,
        "approved_by": approver.name if approver else None,
        "default_suites": defaults,
        "threats_total": len(plan.threats),
        "threats_covered": len(plan.covered_by(codes or defaults)),
    }
