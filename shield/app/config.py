"""What a gateway needs to know about itself, all from its environment (UC-8.1 step 3)."""

import os
from dataclasses import dataclass

VERSION = "1.0.0"  # what the gateway reports about itself (step 4)


@dataclass(frozen=True)
class Settings:
    sentra_url: str  # where Sentra is, e.g. https://sentra.halcyonbank.com
    token: str  # the gateway credential, shown once when the gateway was registered
    upstream_url: str  # the application (or its LLM provider) this gateway stands in front of
    position: str  # in_front or before_model
    policy_file: str  # where the last policy is kept, so it survives a restart
    heartbeat_seconds: int
    request_timeout: float


def load() -> Settings:
    return Settings(
        sentra_url=os.environ.get("SENTRA_URL", "").rstrip("/"),
        token=os.environ.get("SENTRA_GATEWAY_TOKEN", ""),
        upstream_url=os.environ.get("SHIELD_UPSTREAM_URL", "").rstrip("/"),
        position=os.environ.get("SHIELD_POSITION", "in_front"),
        policy_file=os.environ.get("SHIELD_POLICY_FILE", "/var/lib/sentra-shield/policy.json"),
        heartbeat_seconds=int(os.environ.get("SHIELD_HEARTBEAT_SECONDS", "30")),
        request_timeout=float(os.environ.get("SHIELD_REQUEST_TIMEOUT", "60")),
    )
