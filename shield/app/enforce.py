"""What a Shield Policy does to the traffic it sees (FR-8.3, UC-8.4 step 4).

Every rule here came from one fix of a remediation **a person approved** in Sentra, and the terms a
guardrail matches were written by a person too (UC-8.4 step 1). The gateway invents nothing: it
matches what its policy says and nothing else, and a body it cannot read it leaves alone, because a
gateway in somebody's traffic path must never corrupt what passes through it.

What it can do depends on where it stands (UC-8.1 step 1):

* `in_front`, between the users and the application, sees the text of a request and of an answer,
  so it carries text guardrails.
* `before_model`, between the application and its LLM provider, also sees the prompt, the retrieved
  context and the tool calls of an answer, so it carries all four kinds of rule.

The work of a rule is deliberately cheap — one lowercase copy of the body and a substring search
per term — because the gateway adds it to every request (NFR-1.5: at most 50 ms of median latency).
"""

import gzip
import json
import logging
import re
import zlib
from dataclasses import dataclass

log = logging.getLogger("sentra.shield")

TEXT_GUARDRAIL = "text_guardrail"
TOOL_APPROVAL = "tool_approval"
RETRIEVAL_REPORT = "retrieval_report"
SYSTEM_PROMPT = "system_prompt"
# What a gateway in each position can see, and so what it can enforce.
CARRIES = {
    "in_front": (TEXT_GUARDRAIL,),
    "before_model": (TEXT_GUARDRAIL, TOOL_APPROVAL, RETRIEVAL_REPORT, SYSTEM_PROMPT),
}
MASK = "[removed]"
BLOCKED_MESSAGE = "This request can't be handled."
HELD_BACK = "A Sentra Shield policy holds this tool call back until a person approves it."
NO_PROMPT = "A system prompt rule found no prompt in a request of a shape this gateway knows."
MAX_TERMS = 200  # the ceiling the backend validates a version against before it deploys it


def word(value) -> str:
    return str(value or "").strip()


@dataclass(frozen=True)
class Guardrail:
    """One text guardrail, compiled once: its terms lowercased beside themselves."""

    id: str
    action: str  # block or mask
    message: str
    terms: tuple[tuple[str, str], ...]  # (the term, the term lowercased)


@dataclass(frozen=True)
class Verdict:
    """What the policy says about one body, and what the gateway should do with it."""

    body: bytes  # what to forward: the body as it came, or with its terms masked
    blocked: bool = False  # the content must not pass
    message: str | None = None  # what to answer instead, in the words of the approved fix
    changed: bool = False  # a guardrail masked something in it
    held_back: tuple[str, ...] = ()  # the tool calls the policy held back
    sources: tuple[str, ...] = ()  # the restricted knowledge sources it touched
    rule: str | None = None  # the rule behind all of this, for the gateway's own log
    unreadable: bool = False  # the body is not text this policy could be matched against
    drop_encoding: bool = False  # it was unpacked, so its content-encoding no longer describes it


class Engine:
    """The policy of this gateway, ready to be applied to a request and to an answer."""

    def __init__(self, document: dict | None, position: str) -> None:
        self.position = position
        carries = CARRIES.get(position, ())
        rules = [
            rule
            for rule in (document or {}).get("rules") or []
            if isinstance(rule, dict) and rule.get("kind") in carries
        ]
        self.rule_count = len(rules)
        self.on_the_way_in = _guardrails(rules, "input")
        self.on_the_way_out = _guardrails(rules, "output")
        # The tool a call names, lowercased, and the rule that holds it back.
        self.tools = {
            word(rule.get("tool")).lower(): word(rule.get("id"))
            for rule in rules
            if rule.get("kind") == TOOL_APPROVAL and word(rule.get("tool"))
        }
        self.sources = tuple(
            (word(rule.get("source")), word(rule.get("source")).lower())
            for rule in rules
            if rule.get("kind") == RETRIEVAL_REPORT and word(rule.get("source"))
        )
        # The approved sentences of every system prompt rule, in the order of the policy.
        self.sentences = "\n\n".join(
            word(rule.get("text"))
            for rule in rules
            if rule.get("kind") == SYSTEM_PROMPT and word(rule.get("text"))
        )
        self._said: set[str] = set()  # what has been logged already, so one rule says it once

    @property
    def empty(self) -> bool:
        return self.rule_count == 0

    # ---------------------------------------------------------------- the two directions

    def on_request(self, body: bytes, encoding: str | None = None) -> Verdict:
        """The request on its way to the application (or to its model): blocked, masked, hardened
        with the approved sentences, and what it touched on the way."""
        if self.empty:
            return Verdict(body=body)
        text, readable, unpacked = _as_text(body, encoding)
        if text is None:
            return Verdict(body=body, unreadable=True)
        blocking = _first_block(self.on_the_way_in, text)
        if blocking is not None:
            return Verdict(body=b"", blocked=True, message=blocking.message, rule=blocking.id)
        masked, changed, rule = _mask(self.on_the_way_in, readable, text)
        return Verdict(
            body=self._harden(masked),
            changed=changed,
            sources=self._sources_in(text),
            rule=rule,
            drop_encoding=unpacked,
        )

    def on_answer(self, body: bytes, encoding: str | None = None) -> Verdict:
        """The answer on its way back: blocked, masked, and with the tool calls the policy holds
        back taken out of it."""
        if self.empty:
            return Verdict(body=body)
        text, readable, unpacked = _as_text(body, encoding)
        if text is None:
            return Verdict(body=body, unreadable=True)
        blocking = _first_block(self.on_the_way_out, text)
        if blocking is not None:
            return Verdict(body=b"", blocked=True, message=blocking.message, rule=blocking.id)
        masked, changed, rule = _mask(self.on_the_way_out, readable, text)
        held, after = self._hold_back(masked)
        return Verdict(
            body=after,
            changed=changed,
            held_back=held,
            sources=self._sources_in(text),
            rule=rule or (self.tools.get(held[0].lower()) if held else None),
            drop_encoding=unpacked,
        )

    # ---------------------------------------------------------------- the rules that rewrite

    def _harden(self, body: bytes) -> bytes:
        """A system prompt rule adds the approved sentences to the prompt the application sends.

        Only the two shapes of request this gateway can be sure about are changed — a `system`
        field, or a list of messages with roles. Anything else is forwarded as it came and said
        once in the log: a gateway may not guess where somebody's prompt lives.
        """
        if not self.sentences or not body:
            return body
        payload = _json(body)
        if not isinstance(payload, dict):
            self._say("prompt-shape", NO_PROMPT)
            return body
        system, messages = payload.get("system"), payload.get("messages")
        if isinstance(system, str):
            payload["system"] = f"{system}\n\n{self.sentences}".strip()
        elif isinstance(system, list):
            payload["system"] = [*system, {"type": "text", "text": self.sentences}]
        elif isinstance(messages, list):
            _into_the_system_message(messages, self.sentences)
        else:
            self._say("prompt-shape", NO_PROMPT)
            return body
        return json.dumps(payload).encode()

    def _hold_back(self, body: bytes) -> tuple[tuple[str, ...], bytes]:
        """A tool approval rule takes the call of a named tool out of the answer, so that the
        application never carries it out, and says in its place that a person has to approve it."""
        if not self.tools or not body:
            return (), body
        payload = _json(body)
        if not isinstance(payload, dict):
            return (), body
        held: list[str] = []
        for choice in payload.get("choices") or []:  # a provider that answers like OpenAI's
            message = choice.get("message") if isinstance(choice, dict) else None
            if not isinstance(message, dict) or not isinstance(message.get("tool_calls"), list):
                continue
            calls = message["tool_calls"]
            kept = [call for call in calls if not _held(self.tools, _tool_of(call), held)]
            if len(kept) == len(calls):
                continue
            message["tool_calls"] = kept
            if not kept:
                del message["tool_calls"]
                message["content"] = message.get("content") or HELD_BACK
                choice["finish_reason"] = "stop"
        content = payload.get("content")
        if isinstance(content, list):  # a provider that answers like Anthropic's
            kept = [
                part
                for part in content
                if not (
                    isinstance(part, dict)
                    and part.get("type") == "tool_use"
                    and _held(self.tools, word(part.get("name")), held)
                )
            ]
            if len(kept) != len(content):
                payload["content"] = kept or [{"type": "text", "text": HELD_BACK}]
                payload["stop_reason"] = "end_turn"
        if not held:
            return (), body
        return tuple(held), json.dumps(payload).encode()

    # ---------------------------------------------------------------- the rule that only watches

    def _sources_in(self, text: str) -> tuple[str, ...]:
        """A retrieval rule reports every request that touches a restricted knowledge source. It
        changes nothing: what the source holds is the application's, and only the application
        knows the shape of its own context."""
        return tuple(name for name, lowered in self.sources if lowered in text)

    def _say(self, key: str, line: str) -> None:
        if key not in self._said:
            self._said.add(key)
            log.warning(line)


# ---------------------------------------------------------------- the small things


def _guardrails(rules: list[dict], applies_to: str) -> tuple[Guardrail, ...]:
    """The guardrails of one direction, with their terms compiled. A policy matches at most 200
    terms in all, which the backend validates before it deploys a version."""
    found, terms_left = [], MAX_TERMS
    for rule in rules:
        if rule.get("kind") != TEXT_GUARDRAIL or rule.get("applies_to") != applies_to:
            continue
        terms = tuple(
            (word(term), word(term).lower())
            for term in (rule.get("terms") or [])[:terms_left]
            if word(term)
        )
        if not terms:
            continue
        terms_left -= len(terms)
        found.append(
            Guardrail(
                id=word(rule.get("id")),
                action="mask" if rule.get("action") == "mask" else "block",
                message=word(rule.get("message")) or BLOCKED_MESSAGE,
                terms=terms,
            )
        )
    return tuple(found)


def _first_block(guardrails: tuple[Guardrail, ...], text: str) -> Guardrail | None:
    """The first blocking guardrail the body answers to. The term it matched stays inside the
    gateway: the terms of a policy are the target owner's and say where their weakness is."""
    for guardrail in guardrails:
        if guardrail.action == "block" and any(lowered in text for _, lowered in guardrail.terms):
            return guardrail
    return None


def _mask(
    guardrails: tuple[Guardrail, ...], readable: str, text: str
) -> tuple[bytes, bool, str | None]:
    """Every term of a masking guardrail taken out of the body, and the rule that did it.

    In a JSON body only the text it carries is masked, so what reaches the application is still
    the JSON it expects; any other body is masked as the text it is. A term that appears only in
    a field name is therefore reported but not removed — a blocking rule is the way to stop it.
    """
    caught = [
        (guardrail, [term for term, lowered in guardrail.terms if lowered in text])
        for guardrail in guardrails
        if guardrail.action == "mask"
    ]
    caught = [(guardrail, terms) for guardrail, terms in caught if terms]
    if not caught:
        return readable.encode(), False, None
    terms = [term for _, found in caught for term in found]
    payload = _json(readable.encode())
    after = (
        json.dumps(_masked_json(payload, terms))
        if payload is not None
        else _masked_text(readable, terms)
    )
    changed = after != readable
    return after.encode(), changed, caught[0][0].id if changed else None


def _masked_json(payload, terms: list[str]):
    """The same JSON with every term taken out of the text it carries."""
    if isinstance(payload, str):
        return _masked_text(payload, terms)
    if isinstance(payload, list):
        return [_masked_json(one, terms) for one in payload]
    if isinstance(payload, dict):
        return {key: _masked_json(value, terms) for key, value in payload.items()}
    return payload


def _masked_text(text: str, terms: list[str]) -> str:
    for term in terms:
        text = re.sub(re.escape(term), lambda _: MASK, text, flags=re.IGNORECASE)
    return text


def _as_text(body: bytes, encoding: str | None) -> tuple[str | None, str, bool]:
    """The body as the lowercased text a rule is matched against, the body as it reads, and
    whether it had to be unpacked first.

    A body the gateway cannot read as text — a picture, or a compression it does not know — is
    matched against nothing and forwarded exactly as it came, and the gateway reports it.
    """
    raw, unpacked = _unpacked(body, encoding)
    if raw is None:
        return None, "", False
    try:
        readable = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None, "", False
    return readable.lower(), readable, unpacked


def _unpacked(body: bytes, encoding: str | None) -> tuple[bytes | None, bool]:
    """gzip and deflate are unpacked, so packing a body is no way around a guardrail. A
    compression the gateway does not know (brotli, zstd) is left alone and reported."""
    name = word(encoding).lower()
    if not name or name == "identity":
        return body, False
    try:
        if name == "gzip":
            return gzip.decompress(body), True
        if name == "deflate":
            return zlib.decompress(body), True
    except (OSError, zlib.error):
        return None, False
    return None, False


def _json(body: bytes):
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None


def _into_the_system_message(messages: list, sentences: str) -> None:
    """The approved sentences go at the end of the system message, or into one of their own in
    front of the conversation when there is none."""
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "system":
            continue
        content = message.get("content")
        if isinstance(content, str):
            message["content"] = f"{content}\n\n{sentences}".strip()
            return
        if isinstance(content, list):
            message["content"] = [*content, {"type": "text", "text": sentences}]
            return
    messages.insert(0, {"role": "system", "content": sentences})


def _tool_of(call) -> str:
    if not isinstance(call, dict):
        return ""
    function = call.get("function")
    return word(function.get("name")) if isinstance(function, dict) else ""


def _held(tools: dict[str, str], name: str, held: list[str]) -> bool:
    """Whether this policy holds the named tool back, remembering the ones it did."""
    if not name or name.lower() not in tools:
        return False
    held.append(name)
    return True
