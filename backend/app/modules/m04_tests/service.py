"""Catalogue queries (FR-4.1, UC-4.1)."""

import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import (
    CATEGORY_NAMES,
    OUT_OF_SCOPE,
    RULE_KINDS,
    RuleCheck,
    Severity,
)

SEVERITY_ORDER = {s.value: i for i, s in enumerate(Severity)}


@dataclass
class CatalogueFilters:
    search: str = ""
    category: list[str] = field(default_factory=list)
    severity: list[str] = field(default_factory=list)
    target_type: list[str] = field(default_factory=list)
    origin: list[str] = field(default_factory=list)
    atlas: str = ""


def _visible(organization_id: uuid.UUID | None):
    """Built-in tests are visible to everyone; custom tests only within their organization
    (FR-4.3). A user without an organization sees the built-in tests."""
    return or_(
        TestDefinition.organization_id.is_(None),
        TestDefinition.organization_id == organization_id,
    )


def _visible_current(db: Session, organization_id: uuid.UUID | None) -> list[TestDefinition]:
    # Retired custom tests are left out (UC-4.3, 3a); their pages still open by address.
    return list(
        db.scalars(
            select(TestDefinition)
            .where(
                TestDefinition.is_current.is_(True),
                TestDefinition.retired.is_(False),
                _visible(organization_id),
            )
            .order_by(TestDefinition.category, TestDefinition.code)
        )
    )


def _checks(filters: CatalogueFilters) -> dict[str, Callable[[TestDefinition], bool]]:
    """One check per filter; a test is shown when it passes all of them."""
    text = filters.search.strip().lower()
    return {
        "search": lambda t: (
            not text
            or text in t.name.lower()
            or text in t.code.lower()
            or any(text in a.lower() for a in t.atlas)
        ),
        "category": lambda t: not filters.category or t.category in filters.category,
        "severity": lambda t: not filters.severity or t.severity in filters.severity,
        "target_type": lambda t: (
            not filters.target_type or any(tt in filters.target_type for tt in t.target_types)
        ),
        "origin": lambda t: not filters.origin or t.origin in filters.origin,
        "atlas": lambda t: not filters.atlas or filters.atlas in t.atlas,
    }


def list_catalogue(
    db: Session,
    organization_id: uuid.UUID | None,
    filters: CatalogueFilters,
    page: int,
    page_size: int,
) -> tuple[list[TestDefinition], int, dict[str, dict[str, int]]]:
    tests = _visible_current(db, organization_id)
    checks = _checks(filters)

    def passes(test: TestDefinition, skip: str | None = None) -> bool:
        return all(check(test) for name, check in checks.items() if name != skip)

    # Each facet counts the tests that match every OTHER filter, so the numbers show what
    # ticking that option would give.
    facets: dict[str, Counter] = {
        name: Counter() for name in ("category", "severity", "target_type", "origin")
    }
    for test in tests:
        for name in facets:
            if passes(test, skip=name):
                values = test.target_types if name == "target_type" else [getattr(test, name)]
                facets[name].update(values)

    matching = [t for t in tests if passes(t)]
    start = (page - 1) * page_size
    return (
        matching[start : start + page_size],
        len(matching),
        {name: dict(counter) for name, counter in facets.items()},
    )


def coverage(db: Session, organization_id: uuid.UUID | None) -> list[dict]:
    """Tests per OWASP category, including the two categories outside Sentra's scope."""
    counts = Counter(t.category for t in _visible_current(db, organization_id))
    return [
        {
            "category": code,
            "name": name,
            "in_scope": code not in OUT_OF_SCOPE,
            "tests": counts[code],
        }
        for code, name in CATEGORY_NAMES.items()
    ]


def get_definition(
    db: Session, organization_id: uuid.UUID | None, code: str, version: int | None = None
) -> dict:
    """A test definition (the current version, or the one asked for) with its version history.
    Another organization's custom test is "not found", as if it did not exist (FR-4.3)."""
    rows = list(
        db.scalars(
            select(TestDefinition)
            .where(TestDefinition.code == code, _visible(organization_id))
            .order_by(TestDefinition.version.desc())
        )
    )
    chosen = next(
        (r for r in rows if (r.version == version if version is not None else r.is_current)),
        None,
    )
    if chosen is None:
        raise NotFoundError("Test definition not found.")
    return {
        **{c.key: getattr(chosen, c.key) for c in TestDefinition.__table__.columns},
        "category_name": CATEGORY_NAMES[chosen.category],
        "success_rules": [_described(rule) for rule in chosen.success_rules],
        "versions": rows,
    }


def _described(rule: dict) -> dict:
    kind = RULE_KINDS[RuleCheck(rule["check"])]
    value = rule.get("value", "")
    return {**rule, "method": kind.method, "sentence": kind.sentence.format(value=value)}
