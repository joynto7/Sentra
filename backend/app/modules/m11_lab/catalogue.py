"""The lab catalogue (FR-11.1, UC-11.1 step 1): the intentionally vulnerable applications this
deployment can run in its Lab zone.

An entry holds only what has to be known **before** the application runs: its name, its type, its
address in the Lab zone, the request rate it is safe at and how much memory it needs. Everything
else — above all its documented weaknesses — the application reports about itself through
`GET /lab/state`, so the page never shows a copy that has drifted from the target.

The support agent, the SQL agent and the document agent of FR-11.1 are built in their own task and
join this catalogue there, each with its own entry.
"""

from dataclasses import dataclass
from urllib.parse import urlsplit

from app.core.config import get_settings
from app.modules.m02_targets.models import TargetType

LAB_DISABLED = "The Security Lab isn't enabled in this deployment (LAB_HOSTS is empty)."
ZONE_DOWN = (
    "The Lab zone isn't running, so {name} can't be deployed. Start it on the Sentra host with "
    "`docker compose --profile lab up -d` and try again."
)


@dataclass(frozen=True)
class LabTarget:
    key: str
    name: str
    type: TargetType
    endpoint_url: str
    max_request_rate: int
    memory_mb: int  # what the host needs for it (UC-11.1, 2a)
    about: str  # what the application pretends to be, for the card

    @property
    def host(self) -> str:
        return urlsplit(self.endpoint_url).hostname or ""

    @property
    def available(self) -> bool:
        """Whether this deployment has the application at all (LAB_HOSTS)."""
        return self.host in get_settings().lab_hosts

    @property
    def minutes(self) -> int:
        """Roughly how long deploying takes, for the helper under the button."""
        return 2


CATALOGUE: dict[str, LabTarget] = {
    "rag-chatbot": LabTarget(
        key="rag-chatbot",
        name="RAG chatbot (lab)",
        type=TargetType.RAG_APPLICATION,
        endpoint_url="http://lab-rag-chatbot:8080/v1/chat/completions",
        max_request_rate=60,
        memory_mb=512,
        about="A customer-support assistant of the fictional Halcyon Bank, with a knowledge base "
        "of synthetic documents.",
    ),
}


def entry(key: str) -> LabTarget:
    return CATALOGUE[key]


def available() -> list[LabTarget]:
    return [lab for lab in CATALOGUE.values() if lab.available]
