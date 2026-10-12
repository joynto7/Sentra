"""Password policy used at registration and whenever a password is changed (FR-1.1)."""

from dataclasses import dataclass
from pathlib import Path

MIN_LENGTH = 12

# A local list of commonly used passwords. It is checked offline, so no password ever
# leaves Sentra.
_COMMON = frozenset(
    line.strip().lower()
    for line in (Path(__file__).parent / "common_passwords.txt").read_text().splitlines()
    if line.strip() and not line.startswith("#")
)


@dataclass(frozen=True)
class Rule:
    key: str
    label: str  # the wording of the checklist on the registration page


RULES = [
    Rule("length", "At least 12 characters"),
    Rule("common", "Not a commonly used or breached password"),
    Rule("email", "Doesn't contain your e-mail address"),
]


def _is_common(password: str) -> bool:
    lowered = password.lower()
    if lowered in _COMMON:
        return True
    if len(set(lowered)) <= 2:  # "aaaaaaaaaaaa", "abababababab"
        return True
    digits = "0123456789012345678901234567890"
    letters = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"
    keyboard = "qwertyuiopasdfghjklzxcvbnmqwertyuiop"
    return any(lowered in seq or lowered in seq[::-1] for seq in (digits, letters, keyboard))


def _contains_email(password: str, email: str) -> bool:
    lowered = password.lower()
    local_part = email.lower().split("@")[0]
    return email.lower() in lowered or (len(local_part) >= 3 and local_part in lowered)


def failed_rules(password: str, email: str) -> list[Rule]:
    """The rules this password breaks (empty list = the password is acceptable)."""
    failed = []
    if len(password) < MIN_LENGTH:
        failed.append(RULES[0])
    if _is_common(password):
        failed.append(RULES[1])
    if _contains_email(password, email):
        failed.append(RULES[2])
    return failed
