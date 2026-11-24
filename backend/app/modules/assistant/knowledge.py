"""The product guide (knowledge/guide.yaml) and how a question finds its topics.

The search is plain word matching: the guide is small and its words are the product's own, so a
model, an index or a download would add more risk than it removes. It serves two readers: the model
gets the best topics for the question in its instructions, and with no model configured the
assistant answers from them directly.
"""

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

GUIDE = Path(__file__).parent / "knowledge" / "guide.yaml"
STOP = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "can",
        "could",
        "do",
        "does",
        "for",
        "from",
        "how",
        "i",
        "if",
        "in",
        "is",
        "it",
        "me",
        "my",
        "of",
        "on",
        "or",
        "our",
        "so",
        "that",
        "the",
        "this",
        "to",
        "us",
        "was",
        "we",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "you",
        "your",
        "please",
        "tell",
        "show",
        "want",
        "need",
        "would",
        "should",
        "about",
        "get",
        "make",
        "let",
    ]
)


@dataclass(frozen=True)
class Topic:
    id: str
    title: str
    body: str
    href: str
    keywords: frozenset[str]
    steps: tuple[str, ...] = ()
    roles: tuple[str, ...] = ()
    title_words: frozenset[str] = field(default_factory=frozenset)
    body_words: frozenset[str] = field(default_factory=frozenset)


def tokens(text: str) -> set[str]:
    """Lower-case words without the little ones, a trailing s removed ("targets" finds "target")."""
    found = set()
    for word in re.findall(r"[a-z0-9][a-z0-9'-]*", text.lower()):
        word = word.strip("'-")
        if word in STOP or len(word) < 2:
            continue
        found.add(
            word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word
        )
    return found


@lru_cache(maxsize=1)
def topics() -> tuple[Topic, ...]:
    loaded = []
    for raw in yaml.safe_load(GUIDE.read_text(encoding="utf-8")):
        keywords = set()
        for phrase in raw["keywords"]:
            keywords |= tokens(str(phrase))
        loaded.append(
            Topic(
                id=raw["id"],
                title=raw["title"],
                body=" ".join(raw["body"].split()),
                href=raw["href"],
                keywords=frozenset(keywords),
                steps=tuple(raw.get("steps", [])),
                roles=tuple(raw.get("roles", [])),
                title_words=frozenset(tokens(raw["title"])),
                body_words=frozenset(tokens(raw["body"])),
            )
        )
    return tuple(loaded)


def score(topic: Topic, words: set[str]) -> float:
    return (
        3 * len(words & topic.keywords)
        + 2 * len(words & topic.title_words)
        + 0.5 * len(words & topic.body_words)
    )


def relevant(question: str, *, limit: int = 3, minimum: float = 3) -> list[Topic]:
    """The topics that fit the question best, best first; none when nothing fits well enough."""
    words = tokens(question)
    if not words:
        return []
    ranked = sorted(((score(t, words), t) for t in topics()), key=lambda pair: -pair[0])
    return [t for s, t in ranked[:limit] if s >= minimum]


def render(topic: Topic) -> str:
    text = f"{topic.title}: {topic.body}"
    if topic.steps:
        text += " Steps: " + " ".join(f"({i}) {s}" for i, s in enumerate(topic.steps, 1))
    return text


def for_prompt(question: str, limit: int = 3) -> str:
    """The best topics, as the reference block of the model's instructions."""
    found = relevant(question, limit=limit)
    return "\n".join(f"- {render(t)} (page: {t.href})" for t in found)


def get(topic_id: str) -> Topic | None:
    return next((t for t in topics() if t.id == topic_id), None)
