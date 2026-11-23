"""The agent's simulated tools (UC-11.1 step 2: "with synthetic data, simulated tools and planted
canary tokens").

A tool acts only on this application's own synthetic data: no money moves, no message leaves the
Lab zone, nothing outside this container is touched. What a tool changes is kept in the
application's state, so a reset undoes everything the testing did (UC-11.2 step 2).

A call is reported in the reply the way an OpenAI-compatible application reports it, because that
is the form Sentra's Target Connector reads and its detection looks at (FR-6.1).
"""

import json
import secrets
from collections.abc import Callable
from dataclasses import asdict

from app.support import Desk

MEMORY = 50  # how many calls of one kind the state keeps


def _lookup_order(arguments: dict, desk: Desk, state: dict) -> dict:
    order = desk.order(str(arguments.get("reference", "")))
    return {"found": order is not None, "order": asdict(order) if order is not None else None}


def _lookup_customer(arguments: dict, desk: Desk, state: dict) -> dict:
    customer = desk.customer(str(arguments.get("reference", "")))
    return {"found": customer is not None, "customer": asdict(customer) if customer else None}


def _issue_refund(arguments: dict, desk: Desk, state: dict) -> dict:
    refund = {
        "id": f"HB-REF-{secrets.token_hex(3).upper()}",
        "order": str(arguments.get("order", "")),
        "amount": float(arguments.get("amount") or 0),
    }
    state["refunds"] = (state["refunds"] + [refund])[-MEMORY:]
    return refund


def _send_email(arguments: dict, desk: Desk, state: dict) -> dict:
    message = {
        "to": str(arguments.get("to", "")),
        "subject": str(arguments.get("subject", "")),
        "body": str(arguments.get("body", "")),
    }
    state["emails"] = (state["emails"] + [message])[-MEMORY:]
    return {"sent": True, **message}


def _escalate(arguments: dict, desk: Desk, state: dict) -> dict:
    ticket = {
        "id": f"HB-ESC-{secrets.token_hex(3).upper()}",
        "order": str(arguments.get("order", "")),
        "note": str(arguments.get("note", ""))[:500],
    }
    state["escalations"] = (state["escalations"] + [ticket])[-MEMORY:]
    return ticket


TOOLS: dict[str, Callable[[dict, Desk, dict], dict]] = {
    "lookup_order": _lookup_order,
    "lookup_customer": _lookup_customer,
    "issue_refund": _issue_refund,
    "send_email": _send_email,
    "escalate": _escalate,
}


def reported(name: str, arguments: dict) -> dict:
    """One tool call as the reply reports it."""
    return {
        "id": f"call_{secrets.token_hex(6)}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
    }


def perform(name: str, arguments: dict, desk: Desk, state: dict) -> tuple[dict, dict]:
    """Calls a tool and returns what it answered and the call as the reply reports it."""
    if name not in TOOLS:
        return {"error": f"No such tool: {name}."}, reported(name, arguments)
    return TOOLS[name](arguments, desk, state), reported(name, arguments)
