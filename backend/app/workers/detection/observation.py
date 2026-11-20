"""What the deterministic methods look at for one attempt (UC-6.1 step 2): the target's raw reply
and tool calls, the canary tokens planted on the target, and the earlier turns of the attempt's
conversation. The engine reads all of it before the methods run, so the methods only compute
(NFR-1.4).

The methods compare text the same way everywhere: in Unicode compatibility form (full-width
letters become plain ones), without invisible characters, with single spaces and in lower case
(normalized()). A canary token is also found when only its letters and digits appear in order,
e.g. split up with spaces or dots (compact()).
"""

import json
import re
import unicodedata
from contextlib import suppress
from dataclasses import dataclass
from functools import cached_property
from typing import Any

# Characters that don't show and can hide a token from a plain search: the soft hyphen,
# zero-width characters, direction marks and the byte order mark (as code points).
_INVISIBLE = dict.fromkeys(
    [
        0x00AD,
        *range(0x200B, 0x2010),
        *range(0x202A, 0x202F),
        *range(0x2060, 0x2065),
        *range(0x2066, 0x206A),
        0xFEFF,
    ]
)
_SPACES = re.compile(r"\s+")
_NOT_LETTERS_OR_DIGITS = re.compile(r"[\W_]+")
MIN_COMPACT_CHARS = 8  # a shorter token is only found as it is

# How a target may name its tool calls (Reply.tool_calls): see read_tool_calls()
_NAME_KEYS = ("name", "tool", "tool_name")
_ARGUMENT_KEYS = ("arguments", "args", "input", "parameters")


def normalized(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_INVISIBLE)
    return _SPACES.sub(" ", text).casefold()


def compact(text: str) -> str:
    return _NOT_LETTERS_OR_DIGITS.sub("", normalized(text))


def find(token: str, text_normalized: str, text_compact: str) -> str | None:
    """Where `token` is in a text given in both forms: "as it is", "in another form" (only its
    letters and digits, in order), or None."""
    if normalized(token) in text_normalized:
        return "as it is"
    squeezed = compact(token)
    if len(squeezed) >= MIN_COMPACT_CHARS and squeezed in text_compact:
        return "in another form"
    return None


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: Any = None

    def text(self) -> str:
        """The call as text, to search it for a canary token."""
        call = {"name": self.name, "arguments": self.arguments}
        return json.dumps(call, ensure_ascii=False, default=str)


def read_tool_calls(raw: Any) -> list[ToolCall] | None:
    """The tool calls in what a target reported, or None if they can't be read. Sentra reads a
    list of calls, or one call, where a call is
    - the tool's name;
    - an OpenAI tool call: {"function": {"name": …, "arguments": …}};
    - an object with "name", "tool" or "tool_name", and "arguments", "args", "input" or
      "parameters".
    Arguments sent as JSON text are read as JSON."""
    if raw is None or raw == [] or raw == {}:
        return []
    calls = []
    for item in raw if isinstance(raw, list) else [raw]:
        if isinstance(item, str) and item.strip():
            calls.append(ToolCall(item.strip()))
            continue
        if not isinstance(item, dict):
            return None
        call = item["function"] if isinstance(item.get("function"), dict) else item
        names = [call[key] for key in _NAME_KEYS if isinstance(call.get(key), str)]
        name = next((n.strip() for n in names if n.strip()), None)
        if name is None:
            return None
        arguments = next((call[key] for key in _ARGUMENT_KEYS if key in call), None)
        if isinstance(arguments, str):
            with suppress(ValueError):  # plain text arguments stay text
                arguments = json.loads(arguments)
        calls.append(ToolCall(name, arguments))
    return calls


def same_tool(reported: str, wanted: str) -> bool:
    """Whether a reported name is the tool: the same name in any case, also with a namespace in
    front, such as functions.issue_refund."""
    reported, wanted = reported.casefold(), wanted.casefold()
    return reported == wanted or reported.endswith(("." + wanted, "/" + wanted, ":" + wanted))


@dataclass(frozen=True)
class Canary:
    slot: str
    label: str  # the slot's name, e.g. "System instructions" (canaries.SLOTS)
    token: str


@dataclass
class Observation:
    reply: str  # the raw reply: the stored one is masked, which could hide a canary token
    # The calls of this turn; None when they can't be inspected, and tool_problem says why
    tool_calls: list[ToolCall] | None
    tool_problem: str | None
    canaries: list[Canary]  # the tokens the canary checks look for
    canary_problem: str | None  # e.g. no token of the slot is planted
    # The calls of each earlier turn of the conversation (None: they can't be read)
    earlier_turns: list[list[ToolCall] | None]

    @cached_property
    def reply_normalized(self) -> str:
        return normalized(self.reply)

    @cached_property
    def reply_compact(self) -> str:
        return compact(self.reply)
