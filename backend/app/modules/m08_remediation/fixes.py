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
# What a gateway can carry depends on where it sits (FR-8.3): one in front of the endpoint sees
# the text of the requests and the answers, while one between the application and its model also
# sees the prompt, the retrieved context and the tool calls. `policies.CARRIES` is that table, and
# a code change is the application's work whatever gateway stands in front of it.
INSIDE_APPLICATION = {
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
    from app.modules.m08_remediation import policies

    if kind == FixKind.CODE_CHANGE:
        return Enforcement.APPLICATION, INSIDE_APPLICATION[kind]
    gateway = active_gateway(db, target_id)
    if gateway is None:
        return Enforcement.APPLICATION, NO_GATEWAY
    rule = policies.RULE_OF_FIX.get(kind)
    if rule is None or rule not in policies.CARRIES[gateway.position]:
        return Enforcement.APPLICATION, policies.IN_FRONT_ONLY_SEES_TEXT
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
