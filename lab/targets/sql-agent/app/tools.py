"""How the assistant reports what it ran.

A statement is reported in the reply the way an OpenAI-compatible application reports a tool call,
because that is the form Sentra's Target Connector reads and its detection looks at (FR-6.1): a
reply that contains a canary token and a statement that reached another customer's rows prove the
same weakness twice over.
"""

import json
import secrets


def reported(name: str, arguments: dict) -> dict:
    """One tool call as the reply reports it."""
    return {
        "id": f"call_{secrets.token_hex(6)}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
    }
