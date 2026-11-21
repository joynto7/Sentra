"""The fixes of a remediation proposal (FR-8.1): what each kind is called, where it takes effect
(UC-8.2 step 6 with 6a), and the proposal Sentra can write without a model (4a)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.m04_tests.models import TestDefinition
from app.modules.m08_remediation.models import Enforcement, FixKind

KIND_LABELS = {
    FixKind.SYSTEM_PROMPT: "Hardened system prompt",
    FixKind.GUARDRAIL: "Guardrail policy",
    FixKind.TOOL_POLICY: "Tool permission policy",
    FixKind.RETRIEVAL_ISOLATION: "Retrieval isolation rule",
    FixKind.CODE_CHANGE: "Code change",
}
# What the fix itself is, by kind: the key the LLM fills in and the page shows.
DETAIL_KEYS = {
    FixKind.SYSTEM_PROMPT: "prompt",
    FixKind.GUARDRAIL: "rules",
    FixKind.TOOL_POLICY: "tools",
    FixKind.RETRIEVAL_ISOLATION: "sources",
    FixKind.CODE_CHANGE: "steps",
}
# A Sentra Shield gateway stands between the application and its model, so it can filter input
# and output, hold a tool call back and keep retrieval sources apart (FR-8.3). A system prompt and
# a code change are part of the application itself, whatever gateway is in front of it.
GATEWAY_KINDS = (FixKind.GUARDRAIL, FixKind.TOOL_POLICY, FixKind.RETRIEVAL_ISOLATION)
INSIDE_APPLICATION = {
    FixKind.SYSTEM_PROMPT: "The system prompt belongs to the application, so a gateway can't "
    "change it.",
    FixKind.CODE_CHANGE: "A code change is made in the application.",
}
NO_GATEWAY = (
    "No Sentra Shield gateway protects this target yet, so this fix is a change in the application."
)


def active_gateway(db: Session, target_id: uuid.UUID):
    """The target's Sentra Shield gateway when it can carry a fix: connected and in the traffic
    path (UC-8.1 step 6). Without one, every fix is a change inside the application (UC-8.2, 6a)."""
    from app.modules.m08_remediation import gateways

    return gateways.active(db, target_id)


def enforcement(db: Session, target_id: uuid.UUID, kind: FixKind) -> tuple[str, str | None]:
    """Step 6: where a fix takes effect, and 6a: why it has to be made in the application."""
    if kind not in GATEWAY_KINDS:
        return Enforcement.APPLICATION, INSIDE_APPLICATION[kind]
    if active_gateway(db, target_id) is None:
        return Enforcement.APPLICATION, NO_GATEWAY
    return Enforcement.GATEWAY, None


def from_mitigation(definition: TestDefinition) -> dict:
    """4a: what Sentra proposes when no model can be used — the recommended mitigation of the test
    definition that found the weakness (FR-4.2), as the one fix of the proposal. The mitigation is
    written by the test's author, so it is advice for the developers, not a policy."""
    return {
        "kind": FixKind.CODE_CHANGE,
        "title": f"Apply the recommended mitigation of {definition.code}",
        "description": definition.recommended_mitigation,
        "details": {"steps": [definition.recommended_mitigation]},
    }
