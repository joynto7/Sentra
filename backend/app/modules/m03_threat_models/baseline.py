"""UC-3.1 step 3: the baseline threats of each component, from rules that link component types
to OWASP categories (FR-3.2), with a MITRE ATLAS technique where one fits and a first rating.

Threat modelling only: each rule says what could go wrong and why, never how it is done."""

from dataclasses import dataclass, field

from app.modules.m02_targets.models import Environment, Target
from app.modules.m03_threat_models.components import Component
from app.modules.m03_threat_models.models import ComponentKind, ThreatSource


@dataclass
class Draft:
    """A threat before it is stored in a version."""

    title: str
    component_kind: str
    component_name: str
    owasp: list[str]
    atlas: str | None
    likelihood: int
    impact: int
    source: str
    rule: str | None = None
    rationale: str = ""
    extra: dict = field(default_factory=dict)  # fields kept from an earlier version


@dataclass(frozen=True)
class Rule:
    key: str
    kind: ComponentKind
    title: str  # "{name}" is the component's name
    owasp: tuple[str, ...]
    atlas: str | None
    likelihood: int
    impact: int
    why: str
    sensitive: bool = False  # its impact depends on who may read the knowledge source


RULES = [
    Rule(
        "model-policy-limits",
        ComponentKind.MODEL,
        "Role-play or persuasive requests push the assistant past its usage policy",
        ("LLM01",),
        "AML.T0054",
        3,
        3,
        "A model can be talked out of its instructions to some degree.",
    ),
    Rule(
        "model-token-budget",
        ComponentKind.MODEL,
        "Very long conversations or requests exhaust the token budget",
        ("LLM10",),
        "AML.T0034",
        2,
        2,
        "Every request costs tokens; without limits, long inputs raise the cost and slow the "
        "service down.",
    ),
    Rule(
        "prompt-revealed",
        ComponentKind.SYSTEM_PROMPT,
        "System prompt revealed on request",
        ("LLM07",),
        "AML.T0056",
        3,
        2,
        "The system prompt is part of every request, and a model can repeat what it was given.",
    ),
    Rule(
        "prompt-overridden",
        ComponentKind.SYSTEM_PROMPT,
        "Instructions in a user's message override the system prompt",
        ("LLM01",),
        "AML.T0051.000",
        3,
        3,
        "The model reads the user's text and its own instructions together.",
    ),
    Rule(
        "kb-hidden-instructions",
        ComponentKind.KNOWLEDGE_SOURCE,
        "Instructions hidden in {name} change the assistant's behaviour",
        ("LLM01",),
        "AML.T0051.001",
        3,
        4,
        "Retrieved text reaches the model next to its instructions.",
    ),
    Rule(
        "kb-restricted-retrieval",
        ComponentKind.KNOWLEDGE_SOURCE,
        "Documents from {name} retrieved for users who may not see them",
        ("LLM08",),
        "AML.T0057",
        3,
        4,
        "Retrieval returns whatever matches the question unless access is checked per user.",
        sensitive=True,
    ),
    Rule(
        "kb-confidential-disclosure",
        ComponentKind.KNOWLEDGE_SOURCE,
        "Confidential data from {name} disclosed in answers",
        ("LLM02",),
        "AML.T0057",
        3,
        4,
        "The assistant answers from whatever the knowledge source contains.",
        sensitive=True,
    ),
    Rule(
        "kb-poisoned",
        ComponentKind.KNOWLEDGE_SOURCE,
        "A changed or poisoned document in {name} alters the answers for all users",
        ("LLM04",),
        "AML.T0070",
        2,
        4,
        "Every answer that uses the knowledge source trusts its documents.",
    ),
    Rule(
        "tool-unconfirmed",
        ComponentKind.TOOL,
        "{name} used without the user's confirmation",
        ("LLM06",),
        "AML.T0053",
        3,
        3,
        "The model decides when the agent calls its tools.",
    ),
    Rule(
        "tool-instructed",
        ComponentKind.TOOL,
        "Instructions in a message or a retrieved document make the agent use {name}",
        ("LLM06", "LLM01"),
        "AML.T0053",
        3,
        3,
        "Text from users and documents reaches the model that chooses the tool calls.",
    ),
    Rule(
        "output-active-content",
        ComponentKind.OUTPUT,
        "Model output shown as active HTML or script in {name}",
        ("LLM05",),
        None,
        2,
        3,
        "Text that comes from the model is untrusted wherever it is displayed.",
    ),
]


def _rating(rule: Rule, component: Component, target: Target) -> tuple[int, int]:
    """The rule's rating, adjusted by what the profile says. Production targets and tools that
    change something have a higher impact; a public knowledge source has little to disclose."""
    impact = rule.impact
    if target.environment == Environment.PRODUCTION:
        impact += 1
    if component.kind == ComponentKind.TOOL and component.changes_things:
        impact += 1
    if rule.sensitive and "public" in component.access.lower():
        impact = 2
    return rule.likelihood, max(1, min(5, impact))


def derive(target: Target, components: list[Component]) -> list[Draft]:
    drafts = []
    for component in components:
        for rule in RULES:
            if rule.kind != component.kind:
                continue
            likelihood, impact = _rating(rule, component, target)
            drafts.append(
                Draft(
                    title=rule.title.format(name=component.name),
                    component_kind=component.kind.value,
                    component_name=component.name,
                    owasp=list(rule.owasp),
                    atlas=rule.atlas,
                    likelihood=likelihood,
                    impact=impact,
                    source=ThreatSource.BASELINE.value,
                    rule=rule.key,
                    rationale=rule.why,
                )
            )
    return drafts
