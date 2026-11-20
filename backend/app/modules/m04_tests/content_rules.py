"""The content rules for tests (NFR-9.1), checked before a custom test is saved (UC-4.2 step 5,
UC-4.3 step 4) and shown live in the editor (Screen 31).

A definition never contains attack text: attempts come only from Sentra's safe templates. These
rules keep the rest of the definition safe as well. They work on the raw input, so the editor can
show them even while the schema still has errors.
"""

import re
from dataclasses import dataclass

from app.modules.m04_tests.library import safe_templates

PREFIX = "The definition breaks a content rule: "
LABELS = {
    "synthetic_data": "Uses synthetic data or a canary token",
    "least_harm": "Shows the weakness with the least harmful means",
    "no_personal_data": "No real personal data",
}
MESSAGES = {
    "synthetic_data": PREFIX + "attempts must be built from one of Sentra's safe templates, which "
    'use synthetic data and canary tokens. Choose one under "How attempts are built".',
    "least_harm": PREFIX + "a test must show the weakness with the least harmful means. Don't ask "
    "the target for harmful content such as weapons or malware; check for the canary token "
    "instead.",
    "no_personal_data": PREFIX + "a test must not contain real personal data. Use synthetic data "
    "or a canary token instead.",
}

TEXT_FIELDS = ("name", "objective", "prerequisites", "success_condition", "recommended_mitigation")

# Asking the target for content like this would cause harm beyond showing the weakness.
HARMFUL = re.compile(
    r"\b(bombs?|explosives?|nerve agents?|bio-?weapons?|chemical weapons?|firearms?|"
    r"malware|ransomware|keyloggers?|spyware|botnets?|self-harm|suicide|child sexual|"
    r"methamphetamine|meth lab)\b",
    re.IGNORECASE,
)

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})")
# Domains reserved for examples (RFC 2606) are synthetic, so addresses there are allowed.
RESERVED = re.compile(r"(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$", re.I)
CARD = re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])")
PHONE = re.compile(r"(?<![\w+])\+?\d[\d ()-]{8,}\d(?!\w)")
NATIONAL_ID = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b")
SECRET = re.compile(
    r"AKIA[0-9A-Z]{16}|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{36}|\bxox[abprs]-[A-Za-z0-9-]{10,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)


@dataclass
class RuleResult:
    id: str
    label: str
    ok: bool
    message: str = ""
    field: str = ""  # the field that breaks the rule, so the editor can show it there


def _texts(data: dict) -> list[tuple[str, str]]:
    found = [(f, data[f]) for f in TEXT_FIELDS if isinstance(data.get(f), str)]
    rules = data.get("success_rules")
    for number, rule in enumerate(rules if isinstance(rules, list) else []):
        if isinstance(rule, dict) and isinstance(rule.get("value"), str):
            found.append((f"success_rules.{number}.value", rule["value"]))
    return found


def _luhn(digits: str) -> bool:
    total = 0
    for position, digit in enumerate(reversed(digits)):
        n = int(digit)
        if position % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def has_personal_data(text: str) -> bool:
    if any(not RESERVED.search(m.group(1)) for m in EMAIL.finditer(text)):
        return True
    for match in CARD.finditer(text):
        if _luhn(re.sub(r"\D", "", match.group())):
            return True
    # A phone number has 9 to 15 digits (E.164); fewer is more likely a date or an amount.
    if any(9 <= len(re.sub(r"\D", "", m.group())) <= 15 for m in PHONE.finditer(text)):
        return True
    return bool(NATIONAL_ID.search(text) or IBAN.search(text) or SECRET.search(text))


def check(data: dict) -> list[RuleResult]:
    """Every rule with its result; a failed rule names the field that breaks it."""
    texts = _texts(data)
    template = data.get("attempt_template")
    results = [
        RuleResult(
            "synthetic_data",
            LABELS["synthetic_data"],
            isinstance(template, str) and template in safe_templates(),
        ),
        RuleResult("least_harm", LABELS["least_harm"], True),
        RuleResult("no_personal_data", LABELS["no_personal_data"], True),
    ]
    results[0].field = "" if results[0].ok else "attempt_template"
    harmful = next((field for field, text in texts if HARMFUL.search(text)), None)
    personal = next((field for field, text in texts if has_personal_data(text)), None)
    if harmful:
        results[1].ok, results[1].field = False, harmful
    if personal:
        results[2].ok, results[2].field = False, personal
    for result in results:
        if not result.ok:
            result.message = MESSAGES[result.id]
    return results
