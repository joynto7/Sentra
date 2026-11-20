"""UC-3.1 step 2: the components of a target, taken from its reviewed Target Profile (FR-3.1:
model, system prompt, knowledge sources, tools and output channels)."""

from dataclasses import dataclass

from app.modules.m02_targets.models import Target, TargetProfile, TargetType
from app.modules.m03_threat_models.models import ComponentKind

KIND_LABELS = {
    ComponentKind.MODEL: "Model",
    ComponentKind.SYSTEM_PROMPT: "System prompt",
    ComponentKind.KNOWLEDGE_SOURCE: "Knowledge source",
    ComponentKind.TOOL: "Tool",
    ComponentKind.OUTPUT: "Output",
}
# The reply channel every target has. The profile lists no other outputs (FR-2.5), so analysts
# name further outputs, such as "E-mail summary", on the threats they add (UC-3.2 step 3).
DEFAULT_OUTPUT = "Chat replies"
NOT_LISTED = "Not listed in the Target Profile yet. Add it there for more specific threats."
NO_EFFECT = {"", "none", "no", "read-only", "read only", "readonly"}


@dataclass(frozen=True)
class Component:
    kind: ComponentKind
    name: str
    note: str = ""
    access: str = ""  # who may read a knowledge source, as the profile says
    side_effect: str = ""  # what a tool changes, as the profile says

    @property
    def changes_things(self) -> bool:
        return self.side_effect.strip().lower() not in NO_EFFECT

    def as_json(self) -> dict:
        return {"kind": self.kind.value, "name": self.name, "note": self.note}


def _names(items: list[dict]) -> list[dict]:
    """The items of a profile list with a name, each name once."""
    seen: set[str] = set()
    result = []
    for item in items or []:
        name = " ".join(str(item.get("name", "")).split())[:120]
        if name and name.lower() not in seen:
            seen.add(name.lower())
            result.append({**item, "name": name})
    return result


def identify(target: Target, profile: TargetProfile) -> list[Component]:
    components = [
        Component(ComponentKind.MODEL, "Model"),
        Component(ComponentKind.SYSTEM_PROMPT, "System prompt"),
    ]
    sources = _names(profile.knowledge_sources)
    components += [
        Component(
            ComponentKind.KNOWLEDGE_SOURCE,
            source["name"],
            access=str(source.get("access", "")),
        )
        for source in sources
    ]
    if not sources and target.type == TargetType.RAG_APPLICATION:
        # A RAG application has knowledge sources even when the profile names none.
        components.append(
            Component(ComponentKind.KNOWLEDGE_SOURCE, "Knowledge sources", NOT_LISTED)
        )
    tools = _names(profile.tools)
    components += [
        Component(ComponentKind.TOOL, tool["name"], side_effect=str(tool.get("side_effect", "")))
        for tool in tools
    ]
    if not tools and target.type == TargetType.TOOL_USING_AGENT:
        components.append(Component(ComponentKind.TOOL, "Tools", NOT_LISTED))
    components.append(Component(ComponentKind.OUTPUT, DEFAULT_OUTPUT))
    return components


def label(kind: str, name: str) -> str:
    """How the component is named to the LLM and in messages, e.g. "Tool: issue_refund"."""
    if kind in (ComponentKind.MODEL, ComponentKind.SYSTEM_PROMPT):
        return name
    return f"{KIND_LABELS[ComponentKind(kind)]}: {name}"
