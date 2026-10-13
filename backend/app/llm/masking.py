"""Masking of secrets and personal data (NFR-9.6, NFR-8.2).

Before any text leaves Sentra for an LLM provider, the LLM layer replaces secrets and personal
data with placeholders such as [EMAIL_1] or [SECRET_2]. The same value gets the same placeholder
within one text, so the model can still see that two places mention the same thing. Evidence
storage (FR-6.3) can use the same function.

Patterns find what has a recognisable form: keys and tokens, e-mail addresses, phone and card
numbers, bank accounts, identity numbers and IP addresses. Names in free text have no such form,
so they are not found here; that is why only the data a task needs is sent at all (NFR-9.6).
"""

import ipaddress
import re
from collections import Counter
from dataclasses import dataclass, field

# Secrets first, so that a key containing digits is never taken for a phone number.
_SECRETS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),  # AWS access key
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),  # GitHub token
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,255}\b"),
    re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}"),  # OpenAI and Anthropic keys
    re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}\b"),  # Stripe
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),  # Slack
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),  # Google API key
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),  # JWT
]
# "password: hunter2", "api_key=…", "Authorization: Bearer …": the value is masked, the name stays.
_NAMED_SECRET = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token"
    r"|token|authorization)(\s*[:=]\s*[\"']?(?:bearer\s+|basic\s+)?)([^\s\"',;]{6,})"
)
_BEARER = re.compile(r"(?i)\b(bearer|basic)\s+([A-Za-z0-9._~+/=-]{16,})")

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b")
_CARD = re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])")
_US_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_PHONE = re.compile(
    r"(?<![\w+])(?:\+\d{8,15}|(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,5}[ .-]\d{2,6}"
    r"(?:[ .-]\d{2,6}){0,3})(?![\w-])"
)
_DATE = re.compile(r"\d{1,4}[./-]\d{1,2}[./-]\d{2,4}")
_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


@dataclass
class Masked:
    """The masked text, and how many values of each kind were replaced."""

    text: str
    counts: dict[str, int] = field(default_factory=dict)


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch) * (2 if i % 2 else 1)
        total += n - 9 if n > 9 else n
    return total % 10 == 0


def _iban_valid(value: str) -> bool:
    compact = value.replace(" ", "")
    moved = compact[4:] + compact[:4]
    number = "".join(str(int(ch, 36)) for ch in moved)
    return 15 <= len(compact) <= 34 and int(number) % 97 == 1


def _public_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return not (address.is_loopback or address.is_unspecified)


class _Placeholders:
    """[KIND_n], the same n for the same value within one text."""

    def __init__(self) -> None:
        self.seen: dict[tuple[str, str], str] = {}
        self.counts: Counter[str] = Counter()

    def __call__(self, kind: str, value: str) -> str:
        key = (kind, value)
        if key not in self.seen:
            self.counts[kind] += 1
            self.seen[key] = f"[{kind}_{self.counts[kind]}]"
        return self.seen[key]


def mask(text: str) -> Masked:
    """Replaces secrets and personal data in `text` with placeholders."""
    tag = _Placeholders()

    for pattern in _SECRETS:
        text = pattern.sub(lambda m: tag("SECRET", m.group(0)), text)
    text = _NAMED_SECRET.sub(
        lambda m: (
            m.group(1) + m.group(2) + tag("SECRET", m.group(3))
            if not m.group(3).startswith("[SECRET_")
            else m.group(0)
        ),
        text,
    )
    text = _BEARER.sub(lambda m: f"{m.group(1)} {tag('SECRET', m.group(2))}", text)
    text = _EMAIL.sub(lambda m: tag("EMAIL", m.group(0)), text)
    text = _IBAN.sub(
        lambda m: tag("IBAN", m.group(0)) if _iban_valid(m.group(0)) else m.group(0), text
    )

    def card(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        return tag("CARD", m.group(0)) if 13 <= len(digits) <= 19 and _luhn(digits) else m.group(0)

    text = _CARD.sub(card, text)
    text = _US_SSN.sub(lambda m: tag("ID_NUMBER", m.group(0)), text)
    text = _IPV4.sub(
        lambda m: tag("IP", m.group(0)) if _public_ip(m.group(0)) else m.group(0), text
    )
    text = _PHONE.sub(
        lambda m: tag("PHONE", m.group(0)) if _looks_like_phone(m.group(0)) else m.group(0), text
    )
    return Masked(text=text, counts=dict(tag.counts))


def _looks_like_phone(value: str) -> bool:
    # A date such as 2026-10-13 or a version such as 1.105.0 is not a phone number.
    if _DATE.fullmatch(value) or ("." in value and not value.startswith("+")):
        return False
    return 7 <= len(re.sub(r"\D", "", value)) <= 15
