"""Attempt templates (FR-5.4): how the attempts of a test are built, exactly as templates.yaml says.

Every test definition names its attempt template (m04_tests/library). templates.yaml has one entry
per template name of the built-in library, and each entry has four fields:

    canary_slot    the slot of the target's canary token that the template relies on, or empty
    placeholders   the placeholders that its messages use, from PLACEHOLDERS below
    checks         the success checks of the built-in tests that use it, written like the success
                   rules of a test definition (m04_tests/schema.py, SuccessRule)
    messages       at most three short messages; each is sent as its own attempt, in a new
                   conversation with the target

The entries are written by hand. This module reads the file and checks its form, and the run
engine uses what an entry says; nothing here adds content of its own. An entry without messages
isn't filled in yet: a run skips the tests that use it and says so in its summary.

The rules for messages (MAX_MESSAGES, MAX_MESSAGE_CHARS, placeholders, no canary tokens, only
example.com addresses) keep every attempt harmless and its result honest (NFR-9.1): a message
that already contained a canary token would "find" a leak that isn't there.
"""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator

from app.modules.m02_targets.canaries import BY_KEY as CANARY_SLOTS
from app.modules.m04_tests.schema import (
    DETECTION_LABELS,
    DetectionMethod,
    SuccessRule,
    TargetType,
    TestDefinitionSpec,
)

TEMPLATES_FILE = Path(__file__).with_name("templates.yaml")
MAX_MESSAGES = 3
MAX_MESSAGE_CHARS = 300


@dataclass(frozen=True)
class Placeholder:
    description: str
    needs_canary_slot: bool = False  # filled from the canary token of the template's slot


# What the run engine can fill into a message, written {name}. Values come from the target's own
# registration and profile at run time, never from the target's replies.
PLACEHOLDERS = {
    "topic": Placeholder(
        "The topic of the canary token in the template's canary slot, as the target's profile "
        "gives it (for example the topic of a test document).",
        needs_canary_slot=True,
    ),
    "target_name": Placeholder("The target's name as it is registered in Sentra."),
}

# Anything in braces without spaces is read as a placeholder, e.g. {topic}.
_PLACEHOLDER = re.compile(r"\{([^{}\s]*)\}")
# The shapes of canary tokens: those Sentra makes (canaries.new_token) and those of the lab targets.
_CANARY_SHAPES = [
    re.compile(r"\b[A-Z][A-Z0-9]{1,11}(?:-[A-Z0-9]{2,12}){1,2}-[0-9A-F]{8}\b"),  # SENTRA-SYS-1A2B3C4D
    re.compile(r"\b(?:[A-Z0-9]+-)*CANARY(?:-[A-Z0-9]+)+\b"),  # HB-CANARY-SYS-1A2B3C4D
    re.compile(r"\bcanary\.[0-9a-f]{6,}@", re.IGNORECASE),  # canary.1a2b3c4d@example.com
]
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)")
_WEB = re.compile(r"(?i)\b(?:https?://|www\.)([A-Za-z0-9.-]+)")
_ALLOWED_DOMAIN = "example.com"  # reserved for examples (RFC 2606)
_CANARY_CHECKS = {"canary_in_reply", "canary_in_tool_call"}
# Control, format (zero-width, direction), private-use and line/paragraph separator characters
_HIDDEN = {"Cc", "Cf", "Co", "Zl", "Zp"}


def placeholders_in(message: str) -> list[str]:
    return _PLACEHOLDER.findall(message)


def _domain_allowed(domain: str) -> bool:
    domain = domain.lower().rstrip(".")
    return domain == _ALLOWED_DOMAIN or domain.endswith("." + _ALLOWED_DOMAIN)


def message_problems(message: str, declared: list[str]) -> list[str]:
    """What breaks the rules in one message; [] when it is fine."""
    problems = []
    if not message.strip():
        return ["is empty"]
    if message != message.strip():
        problems.append("starts or ends with spaces")
    if len(message) > MAX_MESSAGE_CHARS:
        problems.append(f"is {len(message)} characters long; at most {MAX_MESSAGE_CHARS} are allowed")
    hidden = [c for c in message if c != "\n" and unicodedata.category(c) in _HIDDEN]
    if hidden:
        names = sorted({unicodedata.name(c, f"U+{ord(c):04X}") for c in hidden})
        problems.append(f"contains invisible or control characters ({', '.join(names)})")
    for name in dict.fromkeys(placeholders_in(message)):
        if name not in PLACEHOLDERS:
            known = ", ".join(f"{{{n}}}" for n in PLACEHOLDERS)
            problems.append(f"uses the unknown placeholder {{{name}}}; the known ones are {known}")
        elif name not in declared:
            problems.append(f"uses {{{name}}}, which isn't listed under placeholders")
    if any(shape.search(message) for shape in _CANARY_SHAPES):
        problems.append("contains something shaped like a canary token")
    for domain in [*_EMAIL.findall(message), *_WEB.findall(message)]:
        if not _domain_allowed(domain):
            problems.append(f"names the address domain {domain}; only example.com may be used")
    return problems


class TemplateEntry(BaseModel):
    """One entry of templates.yaml. Every field may be empty."""

    model_config = ConfigDict(extra="forbid")

    canary_slot: str | None = None
    placeholders: list[str] = []
    checks: list[SuccessRule] = []
    messages: list[str] = []

    @field_validator("placeholders", "checks", "messages", mode="before")
    @classmethod
    def _empty_is_a_list(cls, value):
        return [] if value is None else value

    @field_validator("canary_slot")
    @classmethod
    def _known_slot(cls, value: str | None) -> str | None:
        value = (value or "").strip() or None
        if value is not None and value not in CANARY_SLOTS:
            raise ValueError(
                f"'{value}' is not a canary slot; the slots are {', '.join(CANARY_SLOTS)}"
            )
        return value

    @field_validator("placeholders")
    @classmethod
    def _known_placeholders(cls, value: list[str]) -> list[str]:
        for name in value:
            if name not in PLACEHOLDERS:
                raise ValueError(
                    f"'{name}' is not a known placeholder; the known ones are "
                    f"{', '.join(PLACEHOLDERS)}"
                )
        if len(set(value)) != len(value):
            raise ValueError("a placeholder may be listed only once")
        return value

    @model_validator(mode="after")
    def _messages_follow_the_rules(self) -> "TemplateEntry":
        problems = []
        if len(self.messages) > MAX_MESSAGES:
            problems.append(f"has {len(self.messages)} messages; at most {MAX_MESSAGES} are allowed")
        if len(set(self.messages)) != len(self.messages):
            problems.append("has the same message twice")
        for number, message in enumerate(self.messages, start=1):
            found = message_problems(message, self.placeholders)
            problems += [f"message {number} {problem}" for problem in found]
        used = {name for message in self.messages for name in placeholders_in(message)}
        for name in self.placeholders:
            if name not in used:
                problems.append(f"lists the placeholder {{{name}}}, but no message uses it")
            if PLACEHOLDERS.get(name) and PLACEHOLDERS[name].needs_canary_slot and not self.canary_slot:
                problems.append(f"uses {{{name}}}, which needs a canary_slot")
        if any(rule.check in _CANARY_CHECKS for rule in self.checks) and not self.canary_slot:
            problems.append("has a canary check, which needs a canary_slot")
        if problems:
            raise ValueError("; ".join(problems))
        return self

    @property
    def filled_in(self) -> bool:
        return bool(self.messages)

    def digest(self) -> str:
        """SHA-256 of the entry, recorded with each run so its results stay reproducible."""
        canonical = json.dumps(self.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass
class Templates:
    """What templates.yaml says: the valid entries by name, and the problems of the others."""

    entries: dict[str, TemplateEntry] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)  # by name; "" for the whole file
    digest: str = ""  # SHA-256 of the file, recorded with each run (FR-4.5)

    def problem(self, name: str) -> str | None:
        return self.errors.get("") or self.errors.get(name)


def _error_text(exc: ValidationError) -> str:
    parts = []
    for error in exc.errors():
        where = ".".join(str(p) for p in error["loc"])
        message = error["msg"].removeprefix("Value error, ")
        parts.append(f"{where}: {message}" if where else message)
    return "; ".join(parts)


def parse(text: str) -> Templates:
    result = Templates(digest=hashlib.sha256(text.encode()).hexdigest())
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        result.errors[""] = f"templates.yaml isn't valid YAML: {exc}"
        return result
    entries = data.get("templates") if isinstance(data, dict) else None
    if not isinstance(entries, dict) or set(data) != {"templates"}:
        result.errors[""] = "templates.yaml must contain only the key 'templates' with one entry per name"
        return result
    for name, value in entries.items():
        try:
            result.entries[str(name)] = TemplateEntry.model_validate(value or {})
        except ValidationError as exc:
            result.errors[str(name)] = _error_text(exc)
    return result


_cache: dict[Path, tuple[tuple[int, int], Templates]] = {}


def load(path: Path = TEMPLATES_FILE) -> Templates:
    """The templates, read again whenever the file changes."""
    try:
        stat = path.stat()
    except OSError as exc:
        return Templates(errors={"": f"templates.yaml can't be read: {exc.strerror}"})
    key = (stat.st_mtime_ns, stat.st_size)
    cached = _cache.get(path)
    if cached is not None and cached[0] == key:
        return cached[1]
    templates = parse(path.read_text(encoding="utf-8"))
    _cache[path] = (key, templates)
    return templates


def fill(message: str, values: dict[str, str]) -> str:
    return _PLACEHOLDER.sub(lambda m: values[m.group(1)], message)


def library_problems(templates: Templates, library: list[TestDefinitionSpec]) -> list[str]:
    """Whether the file fits the library: one entry for every template name, none more, and checks
    that the tests using a template can evaluate (the same rule as for success rules, FR-4.2)."""
    problems = []
    names = {spec.attempt_template for spec in library}
    found = set(templates.entries) | {n for n in templates.errors if n}
    problems += [f"{n}: missing; every template of the library needs an entry" for n in sorted(names - found)]
    problems += [f"{n}: no test of the library uses this template" for n in sorted(found - names)]
    for spec in library:
        entry = templates.entries.get(spec.attempt_template)
        if entry is None:
            continue
        methods = {d.method for d in spec.detection_methods}
        for number, rule in enumerate(entry.checks, start=1):
            if rule.method not in methods:
                problems.append(
                    f"{spec.attempt_template}: check {number} is evaluated by "
                    f"{DETECTION_LABELS[rule.method]}, which {spec.code} doesn't use"
                )
            needs_agent = rule.method == DetectionMethod.TOOL_CALL_INSPECTION
            if needs_agent and TargetType.TOOL_USING_AGENT not in spec.target_types:
                problems.append(
                    f"{spec.attempt_template}: check {number} needs tool calls, but {spec.code} "
                    "doesn't apply to tool-using agents"
                )
    return problems
