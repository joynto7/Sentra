"""How a lab target's planted weaknesses are plugged in (FR-11.1).

The rest of `app/` is the skeleton: it answers from its synthetic data, keeps the secrets it was
given and refuses what is outside its task. **What this application does wrong is not in the
skeleton.** Every planted weakness is one rule in `app/weaknesses.py`, written by the person who
owns the lab targets (`docs/build-work/SAFETY-STOPS-PLAN.md`, Sprint 4), and this module is the
whole contract between the two.

A rule sees one request and either answers it — its answer becomes the application's reply — or
returns `None` and leaves the turn to the next rule. Whatever no rule answers, the skeleton
answers correctly and without any secret. So an empty `weaknesses.py` is an application with no
weakness at all (its tests check that no canary token can reach a reply), and every weakness it
does have is written in one file and documented under the same ID in
`known_vulnerabilities.json`.

The rules belong to the stand-in model of `LAB_MODEL=simulated`, whose answers are always the
same, so that a benchmark run can rely on them. With a real local model (`LAB_MODEL=ollama/…`)
the weaknesses are whatever that model does with the same instructions, data and tools.
"""

from collections.abc import Callable, Mapping, MutableMapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Request:
    """One request, as a rule sees it.

    `data` is what the application works with — for the support agent its desk, for the SQL agent
    its database, for the document agent its documents — and `state` is what the testing has
    changed so far, which a reset (UC-11.2) empties again.
    """

    question: str
    system_prompt: str
    canaries: Mapping[str, str]
    data: Any
    state: MutableMapping[str, Any]


@dataclass
class Answer:
    """What the application replies: the text, and the tool calls it reports having made.

    A tool call is written the way an OpenAI-compatible application reports it,
    `{"id": …, "type": "function", "function": {"name": …, "arguments": …}}`, because that is what
    Sentra's Target Connector reads (`app/modules/m02_targets/formats.py`).
    """

    text: str
    tool_calls: list[dict] = field(default_factory=list)


Rule = Callable[[Request], Answer | None]
_RULES: list[tuple[str, Rule]] = []


def weakness(weakness_id: str) -> Callable[[Rule], Rule]:
    """Registers the rule below it as the behaviour of the weakness documented under
    `weakness_id` in `known_vulnerabilities.json`."""

    def register(rule: Rule) -> Rule:
        _RULES.append((weakness_id, rule))
        return rule

    return register


def rules() -> list[tuple[str, Rule]]:
    return list(_RULES)


def declared() -> list[str]:
    """The IDs of the weaknesses that are written, in the order they are tried."""
    return [weakness_id for weakness_id, _ in _RULES]


def answer(request: Request) -> tuple[str, Answer] | None:
    """The first rule that answers this request, with its weakness ID, or None if none does."""
    for weakness_id, rule in _RULES:
        found = rule(request)
        if found is not None:
            return weakness_id, found
    return None
