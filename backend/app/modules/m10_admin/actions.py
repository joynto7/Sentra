"""The kinds of action in the audit log, for its "Action type" filter (Screen 58). An event code
such as "member.role_changed" belongs to the group of its first part."""

GROUPS: dict[str, tuple[str, list[str]]] = {
    "organization": ("Organization settings", ["organization"]),
    "members": ("Members and roles", ["member", "invitation"]),
    "targets": ("Targets", ["target"]),
    "tests": ("Test library", ["test", "suite"]),
    "campaigns": ("Campaigns", ["campaign"]),
    "findings": ("Findings", ["finding"]),
    "remediation": ("Remediation and Sentra Shield", ["remediation", "policy"]),
    "reports": ("Reports and integrations", ["report", "gate", "api_key", "webhook"]),
    "data": ("Data and AI, retention", ["data", "retention"]),
    "audit": ("Audit log", ["audit"]),
    "accounts": ("Accounts", ["account"]),
    "platform": ("Platform administration", ["platform"]),
}


def prefixes(group: str) -> list[str]:
    return [f"{prefix}." for prefix in GROUPS[group][1]] if group in GROUPS else []


def group_of(action: str) -> str | None:
    first = action.split(".", 1)[0]
    return next((key for key, (_, parts) in GROUPS.items() if first in parts), None)
