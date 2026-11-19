"""How Sentra talks to a target: its request and response format (FR-2.1, UC-2.1 step 3).

OpenAI-compatible chat API: Sentra sends {"messages": [{"role": "user", "content": "..."}]}
and reads the reply at choices[0].message.content.

Custom JSON: the user writes the request body as a JSON template with placeholders, for example
{"session": "{{session_id}}", "input": "{{message}}"}, and says where the reply is in the response
with a path such as $.output.text. The Target Connector uses render() and extract().
"""

import json
import re
from enum import StrEnum
from typing import Any


class RequestFormat(StrEnum):
    OPENAI_CHAT = "openai_chat"
    CUSTOM_JSON = "custom_json"


PLACEHOLDERS = ("message", "session_id")
PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")
OPENAI_REPLY_PATH = "$.choices[0].message.content"
OPENAI_TOOL_CALLS_PATH = "$.choices[0].message.tool_calls"

# One step of a path: .key, [0] or ['key with spaces']
_STEP = re.compile(r"\.([A-Za-z_][\w-]*)|\[(\d+)\]|\[['\"]([^'\"]+)['\"]\]")


def template_problem(template: str) -> str | None:
    """Why a request template cannot be used, or None if it is fine."""
    names = PLACEHOLDER.findall(template)
    unknown = [name for name in names if name not in PLACEHOLDERS]
    if unknown:
        return (
            f"Unknown placeholder {{{{{unknown[0]}}}}}. Use {{{{message}}}} or {{{{session_id}}}}."
        )
    if "message" not in names:
        return "Add {{message}} where Sentra's message goes."
    try:
        body = json.loads(PLACEHOLDER.sub("x", template))
    except json.JSONDecodeError:
        return 'The template must be valid JSON, with placeholders in quotes: "{{message}}".'
    if not isinstance(body, dict):
        return 'The template must be a JSON object, such as {"input": "{{message}}"}.'
    return None


def parse_path(path: str) -> list[str | int] | None:
    """The steps of a path such as $.output.text, or None if it is not a valid path."""
    if not path.startswith("$"):
        return None
    steps: list[str | int] = []
    position = 1
    while position < len(path):
        match = _STEP.match(path, position)
        if match is None:
            return None
        key, index, quoted_key = match.groups()
        steps.append(int(index) if index is not None else (key or quoted_key))
        position = match.end()
    return steps or None  # "$" alone is the whole response, not a location in it


def render(template: str, message: str, session_id: str) -> dict:
    """The request body: the template with its placeholders filled in."""
    values = {"message": message, "session_id": session_id}
    # Placeholders stand inside JSON strings, so each value is JSON-escaped, without quotes.
    text = PLACEHOLDER.sub(lambda m: json.dumps(values[m.group(1)])[1:-1], template)
    return json.loads(text)


def extract(response: Any, path: str) -> Any:
    """The value at `path` in a response, or None if it is not there."""
    value = response
    for step in parse_path(path) or []:
        in_list = isinstance(step, int) and isinstance(value, list) and step < len(value)
        in_object = isinstance(step, str) and isinstance(value, dict) and step in value
        if not (in_list or in_object):
            return None
        value = value[step]
    return value
