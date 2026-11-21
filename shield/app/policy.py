"""The policy the gateway enforces, and the file it keeps it in.

A gateway must keep working when Sentra cannot be reached: it writes every version it receives to
disk and starts from that file, so a restart during an outage still enforces the last version
anybody approved (UC-8.1, quality requirement). The rules themselves arrive with FR-8.3's policy
deployment (UC-8.4); until then a policy is empty and the gateway only forwards and measures.
"""

import json
import os
from dataclasses import dataclass, field


@dataclass
class Policy:
    version: int = 0
    document: dict = field(default_factory=lambda: {"rules": []})

    @property
    def rule_count(self) -> int:
        rules = self.document.get("rules")
        return len(rules) if isinstance(rules, list) else 0


def load(path: str) -> Policy:
    """The last policy this gateway was given, or the empty one."""
    try:
        with open(path, encoding="utf-8") as file:
            stored = json.load(file)
    except (OSError, json.JSONDecodeError):
        return Policy()
    document = stored.get("document")
    return Policy(
        version=int(stored.get("version", 0)),
        document=document if isinstance(document, dict) else {"rules": []},
    )


def save(path: str, policy: Policy) -> None:
    """Written beside the file and moved into place, so a half-written file never replaces a
    policy that works."""
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    temporary = f"{path}.new"
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump({"version": policy.version, "document": policy.document}, file)
    os.replace(temporary, path)
