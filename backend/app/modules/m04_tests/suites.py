"""Test suites (FR-4.4) and their versions (FR-4.5): UC-4.4 Create and UC-4.5 Update Test Suite.

A suite refers to its tests by code, so it always uses their current versions. A change to a suite
adds a new current version, like a change to a test (custom.py), so past campaign runs keep the
exact suite they used.
"""

import hashlib
import json
import uuid
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.models import Organization
from app.modules.m01_users.models import Membership, User
from app.modules.m04_tests.custom import org_prefix
from app.modules.m04_tests.library import (
    BUILT_IN,
    LIBRARY_DIR,
    LibraryError,
    SyncResult,
    load_library,
)
from app.modules.m04_tests.models import TestDefinition, TestSuite
from app.modules.m04_tests.schema import Origin, SuiteLibraryFile, SuiteSpec, TargetType

SUITES_FILE = LIBRARY_DIR / "suites" / "built_in.yaml"
# An estimate of the attempts one test needs in a run: its variations from the template plus the
# repetitions that measure reproducibility (FR-6.4). It helps to set a campaign's attempt budget
# (UC-4.4 step 4, FR-5.1); the UI plan uses the same figure (18 tests, about 540 attempts).
ATTEMPTS_PER_TEST = 30
TYPE_PLURAL = {
    TargetType.CHATBOT: "chatbots",
    TargetType.RAG_APPLICATION: "RAG applications",
    TargetType.TOOL_USING_AGENT: "tool-using agents",
}


# ---------------------------------------------------------------- built-in suites


def load_suites(path: Path = SUITES_FILE) -> list[SuiteSpec]:
    try:
        suites = SuiteLibraryFile.model_validate(yaml.safe_load(path.read_text())).suites
    except ValidationError as exc:
        raise LibraryError(f"{path.name}: {exc}") from exc
    known = {spec.code for spec in load_library()}
    for suite in suites:
        unknown = [code for code in suite.tests if code not in known]
        if unknown:
            raise LibraryError(f"suite {suite.code} names unknown tests: {', '.join(unknown)}")
    codes = [suite.code for suite in suites]
    duplicates = sorted({code for code in codes if codes.count(code) > 1})
    if duplicates:
        raise LibraryError(f"duplicate suite codes: {', '.join(duplicates)}")
    return suites


def _hash(name: str, purpose: str, tests: list[str]) -> str:
    content = {"name": name, "purpose": purpose, "tests": tests}
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def sync_built_in_suites(db: Session, specs: list[SuiteSpec] | None = None) -> SyncResult:
    """New suites become version 1; a changed suite gets a new current version (FR-4.5)."""
    result = SyncResult()
    for spec in specs if specs is not None else load_suites():
        digest = _hash(spec.name, spec.purpose, spec.tests)
        current = db.scalar(
            select(TestSuite).where(
                TestSuite.code == spec.code,
                TestSuite.origin == BUILT_IN,
                TestSuite.is_current.is_(True),
            )
        )
        if current is not None and current.content_hash == digest:
            result.unchanged += 1
            continue
        if current is not None:
            current.is_current = False
            db.flush()  # first, because only one version of a suite may be current
            result.updated += 1
        else:
            result.added += 1
        db.add(
            TestSuite(
                code=spec.code,
                version=current.version + 1 if current else 1,
                is_current=True,
                origin=BUILT_IN,
                organization_id=None,
                name=spec.name,
                purpose=spec.purpose,
                tests=spec.tests,
                content_hash=digest,
                change_note="Updated built-in suite" if current else "Initial version",
            )
        )
        db.flush()
    db.commit()
    return result


# ---------------------------------------------------------------- reading


def _visible(model, organization_id: uuid.UUID | None):
    """Built-in rows for everyone; custom rows only within their organization (FR-4.3)."""
    return or_(model.organization_id.is_(None), model.organization_id == organization_id)


def _current_tests(db: Session, organization_id: uuid.UUID | None) -> dict[str, TestDefinition]:
    rows = db.scalars(
        select(TestDefinition).where(
            TestDefinition.is_current.is_(True), _visible(TestDefinition, organization_id)
        )
    )
    return {test.code: test for test in rows}


def summary(codes: list[str], tests: dict[str, TestDefinition]) -> dict:
    """UC-4.4 step 4: what the suite covers and how many attempts one run needs, with the
    warnings of alternative 3a. Retired tests are skipped (UC-4.3, 3a)."""
    active = [tests[code] for code in codes if code in tests and not tests[code].retired]
    types = [t.value for t in TargetType if any(t.value in test.target_types for test in active)]
    warnings = []
    partial = Counter(
        tuple(test.target_types) for test in active if set(test.target_types) != set(types)
    )
    for applies_to, count in sorted(partial.items()):
        names = " and ".join(TYPE_PLURAL[TargetType(t)] for t in applies_to)
        verb = "applies" if count == 1 else "apply"
        rest = "is" if count == 1 else "are"
        warnings.append(
            f"{count} test{'' if count == 1 else 's'} {verb} only to {names} and {rest} skipped "
            "for other target types."
        )
    retired = sum(1 for code in codes if code in tests and tests[code].retired)
    if retired:
        warnings.append(
            f"{retired} test{'' if retired == 1 else 's'} retired: skipped in future campaign runs."
        )
    return {
        "test_count": len(active),
        "categories": sorted({test.category for test in active}),
        "target_types": types,
        "estimated_attempts": ATTEMPTS_PER_TEST * len(active),
        "warnings": warnings,
    }


def preview(db: Session, organization_id: uuid.UUID | None, codes: list[str]) -> dict:
    """The builder's summary card for the tests chosen so far (Screen 32)."""
    return summary(codes, _current_tests(db, organization_id))


def list_suites(db: Session, organization_id: uuid.UUID | None) -> list[dict]:
    """The active suites the organization can use: built-in and its own (UC-4.1 step 2)."""
    tests = _current_tests(db, organization_id)
    suites = db.scalars(
        select(TestSuite)
        .where(
            TestSuite.is_current.is_(True),
            TestSuite.status == "active",
            _visible(TestSuite, organization_id),
        )
        .order_by(TestSuite.origin, func.lower(TestSuite.name))
    )
    return [{**_fields(suite), **summary(suite.tests, tests)} for suite in suites]


def get_suite(
    db: Session, organization_id: uuid.UUID | None, code: str, version: int | None = None
) -> dict:
    """A suite (current or an earlier version) with its tests, summary and versions (UC-4.1, 5a)."""
    rows = list(
        db.scalars(
            select(TestSuite)
            .where(TestSuite.code == code, _visible(TestSuite, organization_id))
            .order_by(TestSuite.version.desc())
        )
    )
    chosen = next(
        (r for r in rows if (r.version == version if version is not None else r.is_current)),
        None,
    )
    if chosen is None:
        raise NotFoundError("Test suite not found.")
    tests = _current_tests(db, organization_id)
    return {
        **_fields(chosen),
        **summary(chosen.tests, tests),
        "tests": [_test_row(code, tests.get(code)) for code in chosen.tests],
        "versions": rows,
    }


def containing(db: Session, organization_id: uuid.UUID | None, test_code: str) -> list[dict]:
    """The active suites that include a test (UC-4.3 step 2; Screen 30, "Used by")."""
    suites = db.scalars(
        select(TestSuite)
        .where(
            TestSuite.is_current.is_(True),
            TestSuite.status == "active",
            TestSuite.tests.contains([test_code]),
            _visible(TestSuite, organization_id),
        )
        .order_by(func.lower(TestSuite.name))
    )
    return [
        {"code": s.code, "name": s.name, "version": s.version, "origin": s.origin} for s in suites
    ]


def _fields(suite: TestSuite) -> dict:
    return {
        key: getattr(suite, key)
        for key in ("code", "version", "is_current", "origin", "status", "name", "purpose")
    } | {
        "test_codes": suite.tests,
        "change_note": suite.change_note,
        "created_at": suite.created_at,
    }


def _test_row(code: str, test: TestDefinition | None) -> dict:
    if test is None:  # cannot happen through the API; kept for safety
        return {"code": code, "found": False}
    return {
        "code": code,
        "found": True,
        "name": test.name,
        "category": test.category,
        "severity": test.severity,
        "target_types": test.target_types,
        "version": test.version,
        "origin": test.origin,
        "retired": test.retired,
    }


# ---------------------------------------------------------------- saving


@dataclass
class SuiteInput:
    name: str
    purpose: str
    tests: list[str]


def _check(
    db: Session,
    organization: Organization,
    data: SuiteInput,
    code: str | None,
    kept: list[str] | None = None,
) -> SuiteInput:
    """UC-4.4 step 6 and UC-4.5 step 4: every problem at once, next to its field (6a, 4a).
    `kept` are the tests of the current version: one retired since may stay, and is skipped in
    runs (UC-4.3, 3a), but a retired test can't be added."""
    name, purpose = data.name.strip(), data.purpose.strip()
    errors: list[dict] = []
    if not name:
        errors.append({"field": "name", "message": "Enter a name."})
    elif not 3 <= len(name) <= 80:
        errors.append({"field": "name", "message": "Use 3 to 80 characters."})
    elif _name_taken(db, organization.id, name, code):
        errors.append(
            {"field": "name", "message": f"{organization.name} already has a suite with this name."}
        )
    if not purpose:
        errors.append({"field": "purpose", "message": "Describe the purpose of the suite."})
    elif not 10 <= len(purpose) <= 300:
        errors.append({"field": "purpose", "message": "Use 10 to 300 characters."})
    tests = list(dict.fromkeys(test.strip() for test in data.tests))  # drops repeats
    available = _current_tests(db, organization.id)
    if not tests:
        errors.append(
            {"field": "tests", "message": "Add at least one test. A suite can't be empty."}
        )
    else:
        missing = [c for c in tests if c not in available]
        retired = [
            c for c in tests if c in available and available[c].retired and c not in (kept or [])
        ]
        if missing:
            errors.append({"field": "tests", "message": f"Not found: {', '.join(missing)}."})
        if retired:
            errors.append(
                {
                    "field": "tests",
                    "message": f"Retired, so it can't be added: {', '.join(retired)}.",
                }
            )
    if errors:
        raise AppError(
            "Some fields are invalid.", code="validation_error", status_code=422, details=errors
        )
    return SuiteInput(name, purpose, tests)


def _name_taken(db: Session, organization_id: uuid.UUID, name: str, code: str | None) -> bool:
    """Names are unique among the active suites the organization sees, built-in ones included."""
    query = select(TestSuite.code).where(
        TestSuite.is_current.is_(True),
        TestSuite.status == "active",
        func.lower(TestSuite.name) == name.lower(),
        _visible(TestSuite, organization_id),
    )
    return any(found != code for found in db.scalars(query))


def _new_code(db: Session, organization: Organization) -> str:
    """HB-SUITE-001, HB-SUITE-002, … for the organization's own suites."""
    stem = f"{org_prefix(organization.name)}-SUITE"
    taken = set(
        db.scalars(
            select(TestSuite.code).where(
                TestSuite.code.like(f"{stem}-%"), TestSuite.organization_id == organization.id
            )
        )
    )
    return next(f"{stem}-{n:03d}" for n in range(1, 10_000) if f"{stem}-{n:03d}" not in taken)


def create(db: Session, membership: Membership, data: SuiteInput) -> TestSuite:
    """UC-4.4 step 6: saved as version 1."""
    organization = db.get_one(Organization, membership.organization_id)
    checked = _check(db, organization, data, None)
    suite = TestSuite(
        code=_new_code(db, organization),
        version=1,
        is_current=True,
        origin=Origin.CUSTOM.value,
        organization_id=organization.id,
        name=checked.name,
        purpose=checked.purpose,
        tests=checked.tests,
        content_hash=_hash(checked.name, checked.purpose, checked.tests),
        change_note="Initial version",
    )
    _audit(db, membership, suite, "suite.created", f"Created test suite {suite.code}")
    return _save(db, suite)


def new_version(
    db: Session, membership: Membership, code: str, data: SuiteInput, reason: str
) -> TestSuite:
    """UC-4.5 steps 4-5: the change becomes the new current version, which campaigns use from
    their next run; earlier versions stay as they were (FR-4.5)."""
    current = editable(db, membership.organization_id, code)
    organization = db.get_one(Organization, membership.organization_id)
    checked = _check(db, organization, data, code, current.tests)
    digest = _hash(checked.name, checked.purpose, checked.tests)
    if digest == current.content_hash:
        raise AppError(
            "Nothing has changed. Change the suite before saving a new version.",
            code="unchanged",
            status_code=422,
        )
    _audit(
        db, membership, current, "suite.updated", f"Saved version {current.version + 1} of {code}"
    )
    return _next_version(db, current, checked, digest, reason, "active")


def archive(db: Session, membership: Membership, code: str, reason: str) -> TestSuite:
    """UC-4.5, 3a: a new version marked archived. It leaves the list; past runs keep showing it.
    (Replacing it in scheduled campaigns first comes with scheduling, FR-5.3.)"""
    current = editable(db, membership.organization_id, code)
    content = SuiteInput(current.name, current.purpose, current.tests)
    _audit(db, membership, current, "suite.archived", f"Archived test suite {code}")
    return _next_version(db, current, content, current.content_hash, reason, "archived")


def editable(db: Session, organization_id: uuid.UUID, code: str) -> TestSuite:
    current = db.scalar(
        select(TestSuite).where(
            TestSuite.code == code,
            TestSuite.is_current.is_(True),
            _visible(TestSuite, organization_id),
        )
    )
    if current is None:
        raise NotFoundError("Test suite not found.")
    if current.origin == BUILT_IN:  # UC-4.5, 1a
        raise ConflictError(
            "Built-in suites are read-only. Duplicate it to get a copy you can change.",
            code="built_in_read_only",
        )
    if current.status == "archived":
        raise ConflictError(
            "This suite is archived, so it can't be changed.", code="suite_archived"
        )
    return current


def _next_version(
    db: Session, current: TestSuite, content: SuiteInput, digest: str, note: str, status: str
) -> TestSuite:
    current.is_current = False
    db.flush()  # first, because only one version of a suite may be current
    suite = TestSuite(
        code=current.code,
        version=current.version + 1,
        is_current=True,
        origin=current.origin,
        organization_id=current.organization_id,
        status=status,
        name=content.name,
        purpose=content.purpose,
        tests=content.tests,
        content_hash=digest,
        change_note=note,
    )
    return _save(db, suite)


def _audit(
    db: Session, membership: Membership, suite: TestSuite, action: str, summary: str
) -> None:
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=db.get_one(User, membership.user_id),
        action=action,
        summary=summary,
        item=audit.Item("suite", suite.code, suite.name),
    )


def _save(db: Session, suite: TestSuite) -> TestSuite:
    db.add(suite)
    try:
        db.commit()
    except IntegrityError as exc:  # someone saved the same suite, or took the same code, just now
        db.rollback()
        raise ConflictError(
            "Someone else saved this suite at the same moment. Reload it and try again."
        ) from exc
    return suite
