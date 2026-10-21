"""Custom tests (FR-4.3) and their versions (FR-4.5): UC-4.2 Create Custom Test and UC-4.3 Update
Custom Test. A change never edits a saved version: it adds a new current version, like the
built-in library does (library.py), so past campaign runs stay reproducible.
"""

import re
import uuid
from dataclasses import dataclass

import yaml
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.models import Organization
from app.modules.m01_users.models import Membership, User
from app.modules.m04_tests import content_rules
from app.modules.m04_tests.library import BUILT_IN, content_hash, safe_templates
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import CATEGORY_NAMES, RULE_KINDS, DefinitionFields, Origin

MAX_FILE = 20_000  # characters of a definition file
FIELDS = list(DefinitionFields.model_fields)

# What to say when a field is empty (UC-4.2, 5a: each error next to its field).
MISSING = {
    "name": "Enter a name.",
    "category": "Choose the OWASP category.",
    "severity": "Choose the severity.",
    "objective": "Describe the objective.",
    "prerequisites": "Describe the prerequisites.",
    "target_types": "Select at least one target type.",
    "success_condition": "Describe the success condition, or add a rule.",
    "detection_methods": "Select at least one detection method.",
    "attempt_template": "Choose how attempts are built.",
    "recommended_mitigation": "Describe the recommended mitigation.",
}
CHOICES = {
    "category": "Choose one of the eight OWASP categories in Sentra's scope.",
    "severity": "Choose critical, high, medium, low or informational.",
    "target_types": "Choose chatbot, RAG application or tool-using agent.",
    "detection_methods": "Choose a detection method and its role.",
    "success_rules": "Choose one of the checks.",
}


# ---------------------------------------------------------------- reading and checking


@dataclass
class CheckResult:
    data: dict  # the definition as given, or tidied up when it is valid
    fields: DefinitionFields | None
    errors: list[dict]
    rules: list[content_rules.RuleResult]

    @property
    def valid(self) -> bool:
        return self.fields is not None and all(rule.ok for rule in self.rules)


def read_file(text: str) -> tuple[dict, dict | None]:
    """UC-4.2, 1b: a definition file (YAML, or JSON, which is also YAML). Returns the definition
    and an error for the field "file", if the file can't be read."""
    if len(text) > MAX_FILE:
        return {}, _error("file", "The file is too long: at most 20,000 characters.")
    try:
        # Anchors and aliases can make a small file expand enormously, so they are refused.
        if any(isinstance(t, yaml.AliasToken | yaml.AnchorToken) for t in yaml.scan(text)):
            return {}, _error("file", "Anchors and aliases (& and *) are not allowed.")
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        problem = getattr(exc, "problem", None) or "this is not valid YAML"
        where = f"Line {mark.line + 1}: " if mark else ""
        return {}, _error("file", f"{where}{problem}.")
    if isinstance(data, dict) and list(data) == ["tests"] and isinstance(data["tests"], list):
        data = data["tests"][0] if len(data["tests"]) == 1 else None  # a library-style file
    if not isinstance(data, dict):
        return {}, _error("file", "The file must describe exactly one test definition.")
    data.pop("code", None)  # Sentra gives every custom test its own identifier (UC-4.2 step 6)
    return data, None


def check(data: dict) -> CheckResult:
    """UC-4.2 step 5 and UC-4.3 step 4: the schema first, then the content rules."""
    rules = content_rules.check(data)
    try:
        fields = DefinitionFields.model_validate(data)
    except ValidationError as exc:
        return CheckResult(data, None, [_friendly(e) for e in exc.errors()], rules)
    return CheckResult(fields.model_dump(mode="json"), fields, [], rules)


def check_input(definition: dict | None, file: str | None) -> CheckResult:
    if file is not None:
        data, problem = read_file(file)
        if problem:
            return CheckResult({}, None, [problem], content_rules.check({}))
        return check(data)
    return check(definition or {})


def to_yaml(data: dict) -> str:
    """The definition as a file, fields in the order of the form (Screen 31, "Definition file")."""
    ordered = {key: data[key] for key in FIELDS if key in data}
    ordered |= {key: value for key, value in data.items() if key not in ordered}
    return yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100)


def _error(field: str, message: str) -> dict:
    return {"field": field, "message": message}


def _friendly(error: dict) -> dict:
    """A pydantic error in plain words."""
    loc = [str(part) for part in error["loc"]]
    field, kind, ctx = loc[0] if loc else "", error["type"], error.get("ctx") or {}
    empty = error.get("input") in ("", None, [])
    if kind == "missing" or (kind in ("string_too_short", "too_short") and empty):
        message = MISSING.get(field, "Fill this in.")
    elif kind == "string_too_short":
        message = f"Use at least {ctx.get('min_length')} characters."
    elif kind == "string_too_long":
        message = f"Use at most {ctx.get('max_length')} characters."
    elif kind == "too_long":
        message = f"Add at most {ctx.get('max_length')}."
    elif kind == "enum" or kind == "literal_error":
        message = CHOICES.get(field, "Choose one of the options.")
    elif kind == "string_pattern_mismatch":
        message = MISSING.get(field, "This format is not valid.")
    elif kind == "extra_forbidden":
        message = f'Sentra doesn\'t know the field "{loc[-1]}". Remove it.'
    elif kind == "value_error":
        text = str(ctx.get("error") or error["msg"]).removeprefix("Value error, ")
        message = text[:1].upper() + text[1:] + ("" if text.endswith(".") else ".")
    else:
        message = "This value has the wrong type."
    return _error(".".join(loc), message)


def require_valid(result: CheckResult) -> DefinitionFields:
    """The checked fields, or the errors as a 422 response."""
    if result.errors:
        raise AppError(
            "Some fields are invalid.",
            code="validation_error",
            status_code=422,
            details=result.errors,
        )
    broken = [rule for rule in result.rules if not rule.ok]
    if broken:
        # UC-4.2, 5b: rejected, naming the rule it breaks.
        raise AppError(
            broken[0].message,
            code="content_rule",
            status_code=422,
            details=[_error(rule.field, rule.message) for rule in broken],
        )
    assert result.fields is not None
    return result.fields


# ---------------------------------------------------------------- vocabulary for the editor


def vocabulary() -> dict:
    """The safe attempt templates and the checks of the success-condition builder."""
    templates = sorted(safe_templates().items(), key=lambda item: (item[1].category, item[0]))
    return {
        "templates": [
            {
                "name": name,
                "label": name.replace("-", " ").capitalize(),
                "category": spec.category,
                "category_name": CATEGORY_NAMES[spec.category],
                "target_types": spec.target_types,
                "used_by_code": spec.code,
                "used_by_name": spec.name,
            }
            for name, spec in templates
        ],
        "rule_checks": [
            {"check": check, "method": kind.method, "sentence": kind.sentence, "value": kind.value}
            for check, kind in RULE_KINDS.items()
        ],
    }


# ---------------------------------------------------------------- saving


STOPWORDS = {"the", "and", "for", "with", "from", "into", "that", "this", "test", "tests", "check"}


def org_prefix(organization_name: str) -> str:
    """The organization's initials for identifiers: "Halcyon Bank" gives HB (2 to 4 letters)."""
    words = re.findall(r"[A-Za-z]+", organization_name)
    prefix = "".join(word[0] for word in words).upper()[:4]
    if len(prefix) < 2:
        prefix = (words[0][:2] if words else "").upper()
    return prefix if len(prefix) >= 2 else "CU"


def _new_code(db: Session, organization: Organization, test_name: str) -> str:
    """UC-4.2 step 6: a unique identifier such as HB-REFUND-001 (organization initials, the first
    meaningful word of the name, a number). It never repeats a code the organization can see."""
    prefix = org_prefix(organization.name)
    candidates = re.findall(r"[A-Za-z0-9]+", test_name)
    word = next((w for w in candidates if len(w) >= 3 and w.lower() not in STOPWORDS), "test")
    stem = f"{prefix}-{word.upper()[:8]}"
    taken = set(
        db.scalars(
            select(TestDefinition.code).where(
                TestDefinition.code.like(f"{stem}-%"),
                or_(
                    TestDefinition.organization_id.is_(None),
                    TestDefinition.organization_id == organization.id,
                ),
            )
        )
    )
    for number in range(1, 1000):
        if f"{stem}-{number:03d}" not in taken:
            return f"{stem}-{number:03d}"
    raise ConflictError("Too many tests start with this word. Choose another name.")


def create(db: Session, membership: Membership, fields: DefinitionFields) -> TestDefinition:
    """UC-4.2 step 6: saved as version 1, visible only within the organization (FR-4.3)."""
    organization = db.get_one(Organization, membership.organization_id)
    test = TestDefinition(
        code=_new_code(db, organization, fields.name),
        version=1,
        is_current=True,
        origin=Origin.CUSTOM.value,
        organization_id=organization.id,
        content_hash=content_hash(fields),
        change_note="Initial version",
        **fields.model_dump(mode="json"),
    )
    _audit(db, membership, test, "test.created", f"Created custom test {test.code}")
    return _save(db, test)


def new_version(
    db: Session, membership: Membership, code: str, fields: DefinitionFields, reason: str
) -> TestDefinition:
    """UC-4.3 step 5: the change becomes the new current version; earlier versions stay as they
    were (FR-4.5)."""
    current = editable(db, membership.organization_id, code)
    digest = content_hash(fields)
    if digest == current.content_hash:
        raise AppError(
            "Nothing has changed. Change the definition before saving a new version.",
            code="unchanged",
            status_code=422,
        )
    _audit(
        db, membership, current, "test.updated", f"Saved version {current.version + 1} of {code}"
    )
    return _next_version(db, current, fields.model_dump(mode="json"), digest, reason, False)


def retire(db: Session, membership: Membership, code: str, reason: str) -> TestDefinition:
    """UC-4.3, 3a: a new version marked retired. It leaves the catalogue and future campaign runs;
    past results keep showing it."""
    current = editable(db, membership.organization_id, code)
    content = {key: getattr(current, key) for key in FIELDS}
    _audit(db, membership, current, "test.retired", f"Retired custom test {code}")
    return _next_version(db, current, content, current.content_hash, reason, True)


def editable(db: Session, organization_id: uuid.UUID, code: str) -> TestDefinition:
    """The current version of a test this organization may change."""
    current = db.scalar(
        select(TestDefinition).where(
            TestDefinition.code == code,
            TestDefinition.is_current.is_(True),
            or_(
                TestDefinition.organization_id.is_(None),
                TestDefinition.organization_id == organization_id,
            ),
        )
    )
    if current is None:
        raise NotFoundError("Test definition not found.")
    if current.origin == BUILT_IN:
        # UC-4.3, 1a: read-only, with the way out.
        raise ConflictError(
            "Built-in tests are read-only. Duplicate it as a custom test to change it.",
            code="built_in_read_only",
        )
    if current.retired:
        raise ConflictError("This test is retired, so it can't be changed.", code="test_retired")
    return current


def _next_version(
    db: Session, current: TestDefinition, content: dict, digest: str, note: str, retired: bool
) -> TestDefinition:
    current.is_current = False
    db.flush()  # first, because only one version of a test may be current
    test = TestDefinition(
        code=current.code,
        version=current.version + 1,
        is_current=True,
        origin=current.origin,
        organization_id=current.organization_id,
        retired=retired,
        content_hash=digest,
        change_note=note,
        **content,
    )
    return _save(db, test)


def _audit(
    db: Session, membership: Membership, test: TestDefinition, action: str, summary: str
) -> None:
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=db.get_one(User, membership.user_id),
        action=action,
        summary=summary,
        item=audit.Item("test", test.code, test.name),
    )


def _save(db: Session, test: TestDefinition) -> TestDefinition:
    db.add(test)
    try:
        db.commit()
    except IntegrityError as exc:  # someone saved the same test, or took the same code, just now
        db.rollback()
        raise ConflictError(
            "Someone else saved this test at the same moment. Reload it and try again."
        ) from exc
    return test
