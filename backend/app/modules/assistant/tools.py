"""What the assistant can do. Every tool is one call of Sentra's own API, so a tool can never do
more than the logged-in person's role allows: the API checks the role, the organization, the input
and writes the audit log, exactly as when the person uses the page.

Two kinds of tool:

- a *read* tool runs at once and its result goes to the model, and to the person as a card;
- a *write* tool never runs by itself. The agent turns the call into a proposal the person confirms
  (agent.py); only then does the same API call run, with exactly the arguments that were shown.

What a tool must not have, by design:

- no tool takes a password, an API key or a token, so no secret ever enters a conversation: the
  assistant opens the page where the person types it (`register_target` has no credentials, and
  the assistant says so);
- no tool deletes, and none changes a role, an organization setting or a security setting: those
  stay on their pages, behind the password they ask for (FR-1.6, NFR-3.5);
- the tools that send test traffic to a target (`launch_campaign_run`, `schedule_campaign`) are
  marked high-risk, and the API still refuses a target that is not verified (NFR-8.1).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.modules.m01_users.permissions import Action, allowed

READ, WRITE = "read", "write"
NORMAL, HIGH = "normal", "high"

# A reply is cut to this many characters before the model reads it; long lists keep their first
# items and say how many more there are.
MAX_RESULT_CHARS = 7000
MAX_ITEMS = 12
MAX_TEXT = 400
# Keys that never go to the model or to the page, whatever an answer contains.
HIDDEN_KEYS = {"credentials", "masked_value", "password", "token", "api_key", "secret"}


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    method: str
    path: str  # "/targets/{target_id}": every {name} is taken from the arguments
    label: str  # what the step says while it runs: "Looking up your targets"
    properties: dict[str, dict] = field(default_factory=dict)
    required: tuple[str, ...] = ()
    kind: str = READ
    risk: str = NORMAL
    action: Action | None = None  # the permission it needs; the tool is hidden from other roles
    query: tuple[str, ...] = ()  # arguments sent in the query string; the rest is the body
    fixed: dict = field(default_factory=dict)  # always in the body
    defaults: dict = field(default_factory=dict)  # used when the model gave none; shown on the card
    summary: Callable[[dict], str] | None = None  # for a write: what will happen, in words
    present: Callable[[Any, dict], list[dict]] | None = None  # the cards of a result
    page: Callable[[Any, dict], str | None] | None = None  # the page that shows the result

    def schema(self) -> dict:
        """The tool as the model is told about it (OpenAI function form, which LiteLLM converts
        for every provider)."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.properties,
                    "required": list(self.required),
                },
            },
        }

    def path_names(self) -> list[str]:
        names, current = [], ""
        for char in self.path:
            if char == "{":
                current = ""
            elif char == "}":
                names.append(current)
            else:
                current += char
        return names


# ---------------------------------------------------------------- shaping what comes back


def tone_of(value: str | None) -> str:
    return {
        "critical": "bad",
        "high": "bad",
        "medium": "warn",
        "low": "neutral",
        "info": "neutral",
        "failed": "bad",
        "error": "bad",
        "rejected": "bad",
        "stopped": "warn",
        "paused": "warn",
        "running": "info",
        "queued": "info",
        "generating": "info",
        "pending": "info",
        "awaiting_approval": "info",
        "verified": "good",
        "ready": "good",
        "approved": "good",
        "completed": "good",
        "passed": "good",
        "fixed_and_verified": "good",
        "confirmed": "warn",
        "new": "warn",
        "requires_confirmation": "warn",
        "reopened": "bad",
    }.get((value or "").lower(), "neutral")


def words(value: Any) -> str:
    """ "requires_confirmation" as "Requires confirmation"."""
    text = str(value or "").replace("_", " ").strip()
    return text[:1].upper() + text[1:]


def trim(value: Any, depth: int = 0) -> Any:
    """What the model reads of an answer: no secrets, short texts, the first items of long lists.
    The page's own answer is the source of truth; this is only what fits in a conversation."""
    if isinstance(value, dict):
        return {k: trim(v, depth + 1) for k, v in value.items() if k not in HIDDEN_KEYS}
    if isinstance(value, list):
        kept = [trim(v, depth + 1) for v in value[:MAX_ITEMS]]
        if len(value) > MAX_ITEMS:
            kept.append(f"… and {len(value) - MAX_ITEMS} more")
        return kept
    if isinstance(value, str) and len(value) > MAX_TEXT:
        return value[:MAX_TEXT] + "…"
    return value


def short(value: Any, limit: int = 60) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _table(
    title: str,
    columns: list[str],
    rows: list[dict],
    *,
    total: int | None = None,
    more_href: str | None = None,
    more_label: str = "Open the full list",
) -> dict:
    return {
        "type": "table",
        "title": title,
        "columns": columns,
        "rows": rows,
        "total": total if total is not None else len(rows),
        "more_href": more_href,
        "more_label": more_label,
    }


def _record(
    title: str,
    subtitle: str = "",
    *,
    badges: list[dict] | None = None,
    facts: list[list[str]] | None = None,
    href: str | None = None,
) -> dict:
    return {
        "type": "record",
        "title": title,
        "subtitle": subtitle,
        "badges": badges or [],
        "facts": facts or [],
        "href": href,
    }


def _badge(label: str, tone: str = "neutral") -> dict:
    return {"label": label, "tone": tone}


# ---------------------------------------------------------------- presenters (read tools)


def _present_targets(result: dict, args: dict) -> list[dict]:
    items = result.get("items") or []
    rows = [
        {
            "cells": [
                {"text": it["name"], "strong": True},
                {"text": words(it.get("type"))},
                {
                    "badge": _badge(
                        words(it.get("environment")),
                        "warn" if it.get("environment") == "production" else "neutral",
                    )
                },
                {"badge": _badge(words(it.get("status")), tone_of(it.get("status")))},
            ],
            "href": f"/targets/{it['id']}",
        }
        for it in items
    ]
    return [
        _table(
            "Targets",
            ["Name", "Type", "Environment", "Status"],
            rows,
            total=result.get("total"),
            more_href="/targets",
        )
    ]


def _present_target(result: dict, args: dict) -> list[dict]:
    owner = (result.get("owner") or {}).get("name") or "—"
    test = result.get("last_connection_test") or {}
    return [
        _record(
            result["name"],
            result.get("endpoint_host") or "",
            badges=[
                _badge(words(result.get("status")), tone_of(result.get("status"))),
                _badge(
                    words(result.get("environment")),
                    "warn" if result.get("environment") == "production" else "neutral",
                ),
            ],
            facts=[
                ["Type", words(result.get("type"))],
                ["Owner", owner],
                ["Requests per minute", str(result.get("max_request_rate", "—"))],
                ["Last connection test", words(test.get("status")) if test else "Not tested yet"],
                ["Verified", "Yes" if result.get("verified_at") else "Not yet"],
            ],
            href=f"/targets/{result['id']}",
        )
    ]


def _present_campaigns(result: list, args: dict) -> list[dict]:
    rows = []
    for it in result or []:
        last = it.get("last_run") or {}
        rows.append(
            {
                "cells": [
                    {"text": f"{it['code']} · {short(it['name'], 38)}", "strong": True},
                    {"text": (it.get("target") or {}).get("name", "—")},
                    {
                        "badge": _badge(
                            words(last.get("status")) if last else "Not run yet",
                            tone_of(last.get("status")),
                        )
                    },
                    {"text": f"{it.get('attempt_budget', 0)} attempts"},
                ],
                "href": f"/campaigns/{it['code']}",
            }
        )
    return [
        _table(
            "Campaigns",
            ["Campaign", "Target", "Last run", "Budget"],
            rows[:MAX_ITEMS],
            total=len(rows),
            more_href="/campaigns",
        )
    ]


def _present_campaign(result: dict, args: dict) -> list[dict]:
    schedule = result.get("schedule") or {}
    return [
        _record(
            f"{result['code']} · {result['name']}",
            (result.get("target") or {}).get("name", ""),
            badges=[
                _badge(words(result.get("approval_status")), tone_of(result.get("approval_status")))
            ],
            facts=[
                ["Suites", ", ".join(s["name"] for s in result.get("suites", [])[:4]) or "—"],
                ["Attempt budget", str(result.get("attempt_budget", "—"))],
                ["Request rate", f"{result.get('request_rate', '—')} per minute"],
                ["Schedule", schedule.get("summary") or "Runs when launched"],
            ],
            href=f"/campaigns/{result['code']}",
        )
    ]


def _campaign_of(run: dict) -> str:
    """The campaign's code: R-238-2 is the second run of C-238."""
    code = (run.get("campaign") or {}).get("code")
    return code or "C-" + run["code"].split("-")[1]


def _present_runs(result: list, args: dict) -> list[dict]:
    rows = [
        {
            "cells": [
                {"text": it["code"], "strong": True},
                {"badge": _badge(words(it.get("status")), tone_of(it.get("status")))},
                {"text": f"{it.get('attempts_sent', 0)} / {it.get('attempt_budget', 0)} attempts"},
            ],
            "href": f"/campaigns/{_campaign_of(it)}/runs/{it['number']}",
        }
        for it in (result or [])[:MAX_ITEMS]
    ]
    return [_table("Campaign runs", ["Run", "Status", "Progress"], rows, total=len(result or []))]


def _present_run(result: dict, args: dict) -> list[dict]:
    return [
        _record(
            f"Run {result.get('code', '')}",
            "",
            badges=[_badge(words(result.get("status")), tone_of(result.get("status")))],
            facts=[
                [
                    "Attempts sent",
                    f"{result.get('attempts_sent', 0)} of {result.get('attempt_budget', 0)}",
                ],
                ["Started", short(result.get("started_at") or "Not started", 19)],
                ["Ended", short(result.get("ended_at") or "—", 19)],
            ],
            href=f"/campaigns/{args.get('code')}/runs/{args.get('number')}",
        )
    ]


def _present_autopilot(result: dict, args: dict) -> list[dict]:
    plan = result.get("plan") or {}
    return [
        _record(
            f"Autopilot {result.get('code', '')}: {result.get('target_name', '')}",
            words(result.get("stage")),
            badges=[_badge(words(result.get("status")), tone_of(result.get("status")))],
            facts=[
                ["Now", short(result.get("message") or "—", 120)],
                ["Tests", str(plan.get("tests", "—"))],
                ["Attempts at most", str(plan.get("attempt_budget", "—"))],
            ],
            href=f"/autopilot/{result.get('id')}",
        )
    ]


def _present_findings(result: dict, args: dict) -> list[dict]:
    items = result.get("items") or []
    rows = [
        {
            "cells": [
                {"text": f"{it['code']} · {short(it['title'], 46)}", "strong": True},
                {"badge": _badge(words(it.get("severity")), tone_of(it.get("severity")))},
                {"badge": _badge(words(it.get("status")), tone_of(it.get("status")))},
                {"text": (it.get("target") or {}).get("name", "—")},
            ],
            "href": f"/findings/{it['code']}",
        }
        for it in items
    ]
    return [
        _table(
            "Findings",
            ["Finding", "Severity", "Status", "Target"],
            rows,
            total=result.get("total"),
            more_href="/findings",
        )
    ]


def _present_finding(result: dict, args: dict) -> list[dict]:
    owner = (result.get("owner") or {}).get("name") or "Nobody yet"
    return [
        _record(
            f"{result['code']} · {result['title']}",
            (result.get("target") or {}).get("name", ""),
            badges=[
                _badge(words(result.get("severity")), tone_of(result.get("severity"))),
                _badge(words(result.get("status")), tone_of(result.get("status"))),
            ],
            facts=[
                [
                    "Category",
                    f"{result.get('category', '')} {result.get('category_name', '')}".strip(),
                ],
                ["Owner", owner],
                ["Evidence", f"{result.get('evidence_count', 0)} items"],
                ["Reproducibility", words(result.get("reproducibility") or "Not rated yet")],
            ],
            href=f"/findings/{result['code']}",
        )
    ]


def _present_dashboard(result: dict, args: dict) -> list[dict]:
    by = result.get("open_by_severity") or {}
    cards = [
        {
            "type": "metrics",
            "title": f"Risk in the last {result.get('period_days', 30)} days",
            "items": [
                {"label": "Open findings", "value": result.get("open_total", 0), "tone": "neutral"},
                {"label": "Critical", "value": by.get("critical", 0), "tone": "bad"},
                {"label": "High", "value": by.get("high", 0), "tone": "bad"},
                {
                    "label": "Awaiting triage",
                    "value": result.get("awaiting_triage", 0),
                    "tone": "warn",
                },
                {
                    "label": "Awaiting a fix",
                    "value": result.get("awaiting_remediation", 0),
                    "tone": "warn",
                },
                {
                    "label": "Fixed and verified",
                    "value": result.get("fixed_and_verified", 0),
                    "tone": "good",
                },
            ],
            "href": "/dashboard",
        }
    ]
    targets = result.get("targets") or []
    if targets:
        rows = [
            {
                "cells": [
                    {"text": it["name"], "strong": True},
                    {"text": "—" if it.get("score") is None else f"{it['score']}"},
                    {
                        "badge": _badge(
                            words(it.get("band") or "Not scored"), tone_of(it.get("band"))
                        )
                    },
                ],
                "href": f"/targets/{it['id']}",
            }
            for it in targets[:6]
        ]
        cards.append(
            _table(
                "Target risk",
                ["Target", "Score", "Band"],
                rows,
                total=len(targets),
                more_href="/dashboard",
            )
        )
    return cards


def _present_remediations(result: dict, args: dict) -> list[dict]:
    rows = [
        {
            "cells": [
                {
                    "text": f"{r['finding']['code']} · {short(r['finding']['title'], 40)}",
                    "strong": True,
                },
                {
                    "badge": _badge(
                        words(r["finding"].get("severity")), tone_of(r["finding"].get("severity"))
                    )
                },
                {
                    "badge": _badge(
                        words((r.get("latest") or {}).get("status") or "No proposal yet"),
                        "info" if r.get("latest") else "neutral",
                    )
                },
            ],
            "href": f"/remediation/{r['finding']['code']}",
        }
        for r in (result.get("rows") or [])[:MAX_ITEMS]
    ]
    return [
        _table(
            "Remediation",
            ["Finding", "Severity", "Proposal"],
            rows,
            total=len(result.get("rows") or []),
            more_href="/remediation",
        )
    ]


def _present_reports(result: Any, args: dict) -> list[dict]:
    items = result.get("items", result) if isinstance(result, dict) else result
    rows = [
        {
            "cells": [
                {"text": f"{r['code']} · {short(r['title'], 40)}", "strong": True},
                {"text": f"{words(r.get('type'))} · {str(r.get('format', '')).upper()}"},
                {"badge": _badge(words(r.get("status")), tone_of(r.get("status")))},
            ],
            "href": "/reports",
        }
        for r in (items or [])[:MAX_ITEMS]
    ]
    return [
        _table(
            "Reports",
            ["Report", "Kind", "Status"],
            rows,
            total=len(items or []),
            more_href="/reports",
        )
    ]


def _present_notifications(result: Any, args: dict) -> list[dict]:
    items = result.get("items", result) if isinstance(result, dict) else result
    rows = [
        {
            "cells": [
                {
                    "text": short(n.get("title") or n.get("summary") or n.get("event"), 70),
                    "strong": not n.get("read_at"),
                },
                {"text": short(n.get("created_at"), 10)},
            ],
            "href": "/notifications",
        }
        for n in (items or [])[:8]
    ]
    return (
        [
            _table(
                "Notifications",
                ["What happened", "When"],
                rows,
                total=len(items or []),
                more_href="/notifications",
            )
        ]
        if rows
        else []
    )


def _present_suites(result: Any, args: dict) -> list[dict]:
    items = result.get("items", result) if isinstance(result, dict) else result
    rows = [
        {
            "cells": [
                {"text": s.get("name") or s.get("code"), "strong": True},
                {"text": s.get("code", "")},
                {"text": f"{s.get('test_count', '—')} tests"},
            ],
            "href": f"/test-library/suites/{s['code']}" if s.get("code") else None,
        }
        for s in (items or [])[:MAX_ITEMS]
    ]
    return [
        _table(
            "Test suites",
            ["Suite", "Code", "Size"],
            rows,
            total=len(items or []),
            more_href="/test-library/suites",
        )
    ]


def _present_getting_started(result: dict, args: dict) -> list[dict]:
    steps = result.get("steps") or []
    rows = [
        {
            "cells": [
                {"text": s.get("title") or s.get("key"), "strong": True},
                {
                    "badge": _badge(
                        "Done" if s.get("done") else "To do", "good" if s.get("done") else "info"
                    )
                },
            ],
            "href": s.get("href") or "/getting-started",
        }
        for s in steps
    ]
    return (
        [
            _table(
                "Getting started", ["Step", ""], rows, total=len(rows), more_href="/getting-started"
            )
        ]
        if rows
        else []
    )


def _present_threat_model(result: dict, args: dict) -> list[dict]:
    return [
        {
            "type": "link",
            "title": "Open the threat model",
            "description": "Review the threats and approve the version.",
            "href": f"/targets/{args.get('target_id')}/threat-model",
        }
    ]


def _present_job(label: str, href: Callable[[dict], str]) -> Callable[[Any, dict], list[dict]]:
    def present(result: dict, args: dict) -> list[dict]:
        return [
            {
                "type": "link",
                "title": label,
                "description": "It is being prepared; the page follows it.",
                "href": href(args),
            }
        ]

    return present


def _register_summary(a: dict) -> str:
    kind = words(a.get("type")).lower()
    return (
        f"Register the target “{a.get('name')}” ({kind}, {a.get('environment')}) "
        f"at {a.get('endpoint_url')}"
    )


def _create_campaign_summary(a: dict) -> str:
    return (
        f"Create the campaign “{a.get('name')}” with {len(a.get('suites') or [])} suite(s). "
        "Nothing is sent to the target yet."
    )


def _report_summary(a: dict) -> str:
    scope = "the whole organization" if a.get("scope") == "organization" else "one target"
    text = f"Generate a {a.get('type')} report ({str(a.get('format')).upper()}) for {scope}"
    return text + (f", last {a['period_days']} days" if a.get("period_days") else "")


# ---------------------------------------------------------------- the tools

_target_id = {
    "type": "string",
    "description": "The target's id (a UUID), from list_targets or get_target.",
}
_code = {"type": "string", "description": "The campaign's code, such as C-12."}
_finding = {"type": "string", "description": "The finding's code, such as F-007."}
_severity = {"type": "string", "enum": ["critical", "high", "medium", "low", "info"]}

TOOLS: list[Tool] = [
    # ------------------------------------------------------------ overview
    Tool(
        "get_risk_overview",
        "The risk dashboard: open findings by severity, what awaits triage or a fix, and the risk "
        "score of each target. Use it to answer 'how are we doing' or 'what needs attention'.",
        "GET",
        "/risk/dashboard",
        "Reading the risk dashboard",
        properties={
            "target_id": _target_id,
            "days": {"type": "integer", "description": "The period in days (default 30)."},
        },
        query=("target_id", "days"),
        present=_present_dashboard,
        page=lambda r, a: "/dashboard",
    ),
    Tool(
        "get_getting_started",
        "The setup steps of the organization and which are done. Use it to guide a new person.",
        "GET",
        "/organizations/current/getting-started",
        "Checking the setup steps",
        present=_present_getting_started,
        page=lambda r, a: "/getting-started",
    ),
    # ------------------------------------------------------------ targets (M2)
    Tool(
        "list_targets",
        "The organization's targets (the AI applications under test), with environment and status.",
        "GET",
        "/targets",
        "Looking up targets",
        properties={
            "search": {"type": "string", "description": "Part of the name or address."},
            "tab": {"type": "string", "enum": ["active", "archived"]},
            "environment": {
                "type": "array",
                "items": {"type": "string", "enum": ["staging", "production"]},
            },
        },
        query=("search", "tab", "environment"),
        present=_present_targets,
        page=lambda r, a: "/targets",
    ),
    Tool(
        "get_target",
        "One target: status, owner, environment, ownership verification and last connection test.",
        "GET",
        "/targets/{target_id}",
        "Opening the target",
        properties={"target_id": _target_id},
        required=("target_id",),
        present=_present_target,
        page=lambda r, a: f"/targets/{a['target_id']}",
    ),
    Tool(
        "register_target",
        "Register a new target. Needs a name, a type, an address (endpoint_url) and an "
        "environment. "
        "Never ask for or accept a password, API key or token: tell the person to add credentials "
        "on the target's page afterwards.",
        "POST",
        "/targets",
        "Preparing to register the target",
        properties={
            "name": {"type": "string"},
            "type": {"type": "string", "enum": ["chatbot", "rag_application", "tool_using_agent"]},
            "endpoint_url": {
                "type": "string",
                "description": "The https address Sentra sends requests to.",
            },
            "environment": {"type": "string", "enum": ["staging", "production"]},
            "max_request_rate": {
                "type": "integer",
                "description": "Requests per minute Sentra may send (default 20).",
            },
        },
        required=("name", "type", "endpoint_url", "environment"),
        defaults={"max_request_rate": 20},
        kind=WRITE,
        action=Action.MANAGE_TARGETS,
        summary=_register_summary,
        present=_present_target,
        page=lambda r, a: (
            f"/targets/{r['id']}" if isinstance(r, dict) and r.get("id") else "/targets"
        ),
    ),
    Tool(
        "update_target",
        "Change a target's name, environment or request rate.",
        "PATCH",
        "/targets/{target_id}",
        "Preparing the change",
        properties={
            "target_id": _target_id,
            "name": {"type": "string"},
            "environment": {"type": "string", "enum": ["staging", "production"]},
            "max_request_rate": {"type": "integer"},
        },
        required=("target_id",),
        kind=WRITE,
        action=Action.MANAGE_TARGETS,
        summary=lambda a: (
            "Change the target: "
            + ", ".join(f"{k.replace('_', ' ')} to {v}" for k, v in a.items() if k != "target_id")
        ),
        present=_present_target,
        page=lambda r, a: f"/targets/{a['target_id']}",
    ),
    Tool(
        "test_target_connection",
        "Send one harmless request to a target to check that Sentra can reach it.",
        "POST",
        "/targets/{target_id}/connection-tests",
        "Preparing the connection test",
        properties={"target_id": _target_id},
        required=("target_id",),
        kind=WRITE,
        action=Action.TEST_TARGET_CONNECTIONS,
        summary=lambda a: "Send one harmless test request to the target to check the connection",
        present=_present_job("See the test result", lambda a: f"/targets/{a['target_id']}"),
        page=lambda r, a: f"/targets/{a['target_id']}",
    ),
    Tool(
        "check_target_ownership",
        "Check that the person controls the target, by looking for the token Sentra gave them in a "
        "DNS TXT record or in a file at /.well-known/. Campaigns only run against verified "
        "targets.",
        "POST",
        "/targets/{target_id}/verification/checks",
        "Preparing the ownership check",
        properties={
            "target_id": _target_id,
            "method": {"type": "string", "enum": ["dns_txt_record", "well_known_file"]},
        },
        required=("target_id", "method"),
        kind=WRITE,
        action=Action.VERIFY_TARGETS,
        summary=lambda a: (
            "Check now that the token is in place ("
            + ("DNS TXT record" if a.get("method") == "dns_txt_record" else "well-known file")
            + ")"
        ),
        present=_present_job("See the verification", lambda a: f"/targets/{a['target_id']}/verify"),
        page=lambda r, a: f"/targets/{a['target_id']}/verify",
    ),
    # ------------------------------------------------------------ threat models (M3)
    Tool(
        "get_threat_model",
        "The threat model of a target: its versions and which is approved.",
        "GET",
        "/threat-models/{target_id}",
        "Reading the threat model",
        properties={"target_id": _target_id},
        required=("target_id",),
        present=_present_threat_model,
        page=lambda r, a: f"/targets/{a['target_id']}/threat-model",
    ),
    Tool(
        "generate_threat_model",
        "Draft a new version of the target's threat model from its profile.",
        "POST",
        "/threat-models/{target_id}/generate",
        "Preparing the threat model",
        properties={"target_id": _target_id},
        required=("target_id",),
        kind=WRITE,
        action=Action.MANAGE_THREAT_MODELS,
        summary=lambda a: "Generate a new draft of the threat model for this target",
        present=_present_threat_model,
        page=lambda r, a: f"/targets/{a['target_id']}/threat-model",
    ),
    Tool(
        "approve_threat_model",
        "Approve a version of the threat model, so campaigns can be based on it. Only the newest "
        "version can be approved.",
        "POST",
        "/threat-models/{target_id}/versions/{version}/approve",
        "Preparing the approval",
        properties={"target_id": _target_id, "version": {"type": "integer"}},
        required=("target_id", "version"),
        kind=WRITE,
        risk=HIGH,
        action=Action.MANAGE_THREAT_MODELS,
        summary=lambda a: f"Approve version {a.get('version')} of the threat model",
        present=_present_threat_model,
        page=lambda r, a: f"/targets/{a['target_id']}/threat-model",
    ),
    # ------------------------------------------------------------ tests (M4)
    Tool(
        "list_test_suites",
        "The test suites a campaign can run, such as the OWASP LLM Top 10 suites.",
        "GET",
        "/test-suites",
        "Looking up test suites",
        present=_present_suites,
        page=lambda r, a: "/test-library/suites",
    ),
    # ------------------------------------------------------------ campaigns (M5)
    Tool(
        "list_campaigns",
        "The organization's campaigns with their target and newest run.",
        "GET",
        "/campaigns",
        "Looking up campaigns",
        properties={"target_id": _target_id},
        query=("target_id",),
        present=_present_campaigns,
        page=lambda r, a: "/campaigns",
    ),
    Tool(
        "get_campaign",
        "One campaign: suites, budget, rate, schedule and approval state.",
        "GET",
        "/campaigns/{code}",
        "Opening the campaign",
        properties={"code": _code},
        required=("code",),
        present=_present_campaign,
        page=lambda r, a: f"/campaigns/{a['code']}",
    ),
    Tool(
        "create_campaign",
        "Create a campaign. It sends nothing to the target until a run is launched. Needs a name, "
        "a target and at least one suite (list_test_suites).",
        "POST",
        "/campaigns",
        "Preparing the campaign",
        properties={
            "name": {"type": "string"},
            "target_id": _target_id,
            "suites": {"type": "array", "items": {"type": "string"}, "description": "Suite codes."},
            "attempt_budget": {
                "type": "integer",
                "description": "The most attempts one run may send.",
            },
            "repetitions": {
                "type": "integer",
                "description": "How often each test is repeated (default 5).",
            },
            "request_rate": {"type": "integer", "description": "Requests per minute."},
        },
        required=("name", "target_id", "suites"),
        kind=WRITE,
        action=Action.MANAGE_CAMPAIGNS,
        summary=_create_campaign_summary,
        present=_present_campaign,
        page=lambda r, a: (
            f"/campaigns/{r['code']}" if isinstance(r, dict) and r.get("code") else "/campaigns"
        ),
    ),
    Tool(
        "launch_campaign_run",
        "Launch a run of a campaign. This SENDS TEST TRAFFIC to the target. Only for a verified "
        "target, and only when the person has clearly asked for it.",
        "POST",
        "/campaigns/{code}/runs",
        "Preparing the launch",
        properties={"code": _code},
        required=("code",),
        kind=WRITE,
        risk=HIGH,
        action=Action.MANAGE_CAMPAIGNS,
        summary=lambda a: (
            f"Launch a run of campaign {a.get('code')}. This sends test traffic to its target."
        ),
        present=_present_run,
        page=lambda r, a: (
            f"/campaigns/{a['code']}/runs/{r.get('number', '')}"
            if isinstance(r, dict) and r.get("number")
            else f"/campaigns/{a['code']}"
        ),
    ),
    Tool(
        "start_autopilot",
        "Start the autopilot on a verified target: it makes the threat model, creates and "
        "launches a campaign of every test, and drafts remediation proposals for the most "
        "severe findings. This SENDS TEST TRAFFIC to the target. The person still approves the "
        "threat model, the campaign's scope where required, and every fix. Only when the "
        "person has clearly asked for the whole assessment.",
        "POST",
        "/autopilot",
        "Preparing the autopilot",
        properties={"target_id": _target_id},
        required=("target_id",),
        kind=WRITE,
        risk=HIGH,
        action=Action.MANAGE_CAMPAIGNS,
        summary=lambda a: (
            "Start the autopilot on this target: threat model, a campaign of every test, a run "
            "that sends test traffic to it, and remediation proposals. You still approve every fix."
        ),
        present=_present_autopilot,
        page=lambda r, a: (
            f"/autopilot/{r['id']}" if isinstance(r, dict) and r.get("id") else "/autopilot"
        ),
    ),
    Tool(
        "list_campaign_runs",
        "The runs of one campaign, newest first, with status and progress.",
        "GET",
        "/campaigns/{code}/runs",
        "Looking up the runs",
        properties={"code": _code},
        required=("code",),
        present=_present_runs,
        page=lambda r, a: f"/campaigns/{a['code']}",
    ),
    Tool(
        "get_campaign_run",
        "One run of a campaign: status, attempts sent, start and end.",
        "GET",
        "/campaigns/{code}/runs/{number}",
        "Checking the run",
        properties={"code": _code, "number": {"type": "integer"}},
        required=("code", "number"),
        present=_present_run,
        page=lambda r, a: f"/campaigns/{a['code']}/runs/{a['number']}",
    ),
    Tool(
        "pause_campaign_run",
        "Pause a running campaign run; it can be resumed.",
        "POST",
        "/campaigns/{code}/runs/{number}/pause",
        "Preparing to pause",
        properties={"code": _code, "number": {"type": "integer"}},
        required=("code", "number"),
        kind=WRITE,
        action=Action.PAUSE_CAMPAIGN_RUNS,
        summary=lambda a: f"Pause run {a.get('number')} of campaign {a.get('code')}",
        present=_present_run,
        page=lambda r, a: f"/campaigns/{a['code']}/runs/{a['number']}",
    ),
    Tool(
        "resume_campaign_run",
        "Resume a paused campaign run. This sends test traffic again.",
        "POST",
        "/campaigns/{code}/runs/{number}/resume",
        "Preparing to resume",
        properties={"code": _code, "number": {"type": "integer"}},
        required=("code", "number"),
        kind=WRITE,
        risk=HIGH,
        action=Action.PAUSE_CAMPAIGN_RUNS,
        summary=lambda a: (
            f"Resume run {a.get('number')} of campaign {a.get('code')}. "
            "This sends test traffic again."
        ),
        present=_present_run,
        page=lambda r, a: f"/campaigns/{a['code']}/runs/{a['number']}",
    ),
    Tool(
        "stop_campaign_run",
        "Stop a campaign run for good: no further attempt is sent. It cannot be resumed.",
        "POST",
        "/campaigns/{code}/runs/{number}/stop",
        "Preparing to stop",
        properties={
            "code": _code,
            "number": {"type": "integer"},
            "reason": {"type": "string", "description": "Why it is stopped."},
        },
        required=("code", "number"),
        kind=WRITE,
        risk=HIGH,
        action=Action.STOP_CAMPAIGN_RUNS,
        summary=lambda a: (
            f"Stop run {a.get('number')} of campaign {a.get('code')} for good. "
            "It cannot be resumed."
        ),
        present=_present_run,
        page=lambda r, a: f"/campaigns/{a['code']}/runs/{a['number']}",
    ),
    Tool(
        "decide_campaign_scope",
        "Approve or reject a campaign's scope and budget, for an organization that requires it. "
        "A rejection needs a reason. Nobody decides on a campaign they created.",
        "POST",
        "/campaigns/{code}/approval/decision",
        "Preparing the decision",
        properties={
            "code": _code,
            "approve": {"type": "boolean"},
            "reason": {"type": "string", "description": "Required when rejecting."},
        },
        required=("code", "approve"),
        kind=WRITE,
        risk=HIGH,
        action=Action.APPROVE_CAMPAIGN_SCOPE,
        summary=lambda a: (
            ("Approve" if a.get("approve") else "Reject")
            + f" the scope of campaign {a.get('code')}"
            + (f": {a['reason']}" if a.get("reason") else "")
        ),
        page=lambda r, a: f"/campaigns/{a['code']}/approval",
    ),
    # ------------------------------------------------------------ findings (M6)
    Tool(
        "list_findings",
        "The organization's findings, the most severe first. Filter by severity, status, target or "
        "a search.",
        "GET",
        "/findings",
        "Looking up findings",
        properties={
            "view": {
                "type": "string",
                "enum": [
                    "open",
                    "assigned",
                    "requires_confirmation",
                    "closed",
                    "all",
                    "awaiting_triage",
                    "awaiting_remediation",
                ],
            },
            "severity": _severity,
            "target_id": _target_id,
            "search": {"type": "string"},
            "page_size": {
                "type": "integer",
                "description": "How many to read (at most 12 are shown).",
            },
        },
        query=("view", "severity", "target_id", "search", "page_size"),
        present=_present_findings,
        page=lambda r, a: "/findings",
    ),
    Tool(
        "get_finding",
        "One finding: severity, status, category, owner, evidence count and reproducibility.",
        "GET",
        "/findings/{code}",
        "Opening the finding",
        properties={"code": _finding},
        required=("code",),
        present=_present_finding,
        page=lambda r, a: f"/findings/{a['code']}",
    ),
    Tool(
        "triage_finding",
        "Triage a finding: confirm it, mark it a false positive (needs a reason), or merge it into "
        "a duplicate. A comment can go with it.",
        "POST",
        "/findings/{code}/triage",
        "Preparing the triage",
        properties={
            "code": _finding,
            "decision": {"type": "string", "enum": ["confirm", "false_positive", "merge"]},
            "reason": {"type": "string", "description": "Needed for a false positive."},
            "merge_into": {
                "type": "string",
                "description": "The code of the finding it duplicates.",
            },
            "comment": {"type": "string"},
        },
        required=("code",),
        kind=WRITE,
        action=Action.TRIAGE_FINDINGS,
        summary=lambda a: (
            {
                "confirm": "Confirm",
                "false_positive": "Mark as a false positive",
                "merge": "Merge into " + str(a.get("merge_into")),
            }.get(a.get("decision"), "Save a comment on")
            + f" finding {a.get('code')}"
            + (f": {a['reason']}" if a.get("reason") else "")
        ),
        present=_present_finding,
        page=lambda r, a: f"/findings/{a['code']}",
    ),
    # ------------------------------------------------------------ remediation (M8)
    Tool(
        "list_remediations",
        "The confirmed findings that wait for a fix, and the state of their fix proposals.",
        "GET",
        "/remediations",
        "Looking up fix proposals",
        present=_present_remediations,
        page=lambda r, a: "/remediation",
    ),
    Tool(
        "generate_remediation",
        "Ask Sentra to draft a fix proposal for a confirmed finding.",
        "POST",
        "/remediations/{finding_code}/generate",
        "Preparing the fix request",
        properties={"finding_code": _finding},
        required=("finding_code",),
        kind=WRITE,
        action=Action.REQUEST_REMEDIATIONS,
        summary=lambda a: f"Draft a fix proposal for finding {a.get('finding_code')}",
        present=_present_job("See the proposal", lambda a: f"/remediation/{a['finding_code']}"),
        page=lambda r, a: f"/remediation/{a['finding_code']}",
    ),
    Tool(
        "approve_remediation",
        "Approve a version of a fix proposal. A person who adapted the version cannot approve it.",
        "POST",
        "/remediations/{finding_code}/versions/{version}/approve",
        "Preparing the approval",
        properties={"finding_code": _finding, "version": {"type": "integer"}},
        required=("finding_code", "version"),
        kind=WRITE,
        risk=HIGH,
        action=Action.APPROVE_REMEDIATIONS,
        summary=lambda a: (
            f"Approve version {a.get('version')} of the fix for finding {a.get('finding_code')}"
        ),
        page=lambda r, a: f"/remediation/{a['finding_code']}",
    ),
    Tool(
        "reject_remediation",
        "Reject a version of a fix proposal, with the reason.",
        "POST",
        "/remediations/{finding_code}/versions/{version}/reject",
        "Preparing the rejection",
        properties={
            "finding_code": _finding,
            "version": {"type": "integer"},
            "reason": {"type": "string"},
        },
        required=("finding_code", "version", "reason"),
        kind=WRITE,
        action=Action.APPROVE_REMEDIATIONS,
        summary=lambda a: (
            f"Reject version {a.get('version')} of the fix for finding "
            f"{a.get('finding_code')}: {a.get('reason')}"
        ),
        page=lambda r, a: f"/remediation/{a['finding_code']}",
    ),
    # ------------------------------------------------------------ reports and notifications (M9)
    Tool(
        "list_reports",
        "The reports that were generated.",
        "GET",
        "/reports",
        "Looking up reports",
        present=_present_reports,
        page=lambda r, a: "/reports",
    ),
    Tool(
        "generate_report",
        "Generate a report: executive (plain language) or technical (every finding), as a PDF or "
        "JSON file, for the whole organization or for one target.",
        "POST",
        "/reports",
        "Preparing the report",
        properties={
            "type": {"type": "string", "enum": ["executive", "technical"]},
            "scope": {"type": "string", "enum": ["organization", "target"]},
            "format": {"type": "string", "enum": ["pdf", "json"]},
            "target_id": _target_id,
            "period_days": {"type": "integer", "description": "The period in days."},
        },
        required=("type", "scope", "format"),
        kind=WRITE,
        action=Action.GENERATE_REPORTS,
        summary=_report_summary,
        present=_present_job("See the report", lambda a: "/reports"),
        page=lambda r, a: "/reports",
    ),
    Tool(
        "list_notifications",
        "The person's newest notifications.",
        "GET",
        "/notifications",
        "Reading notifications",
        present=_present_notifications,
        page=lambda r, a: "/notifications",
    ),
]

BY_NAME = {tool.name: tool for tool in TOOLS}


def available(role: str) -> list[Tool]:
    """The tools this role may use: the model is only told about those."""
    return [t for t in TOOLS if t.action is None or allowed(role, t.action)]


def missing(tool: Tool, arguments: dict) -> list[str]:
    return [name for name in tool.required if arguments.get(name) in (None, "")]


def clean_arguments(tool: Tool, arguments: dict) -> dict:
    """Only the arguments the tool declares, so the model can't add a field of its own."""
    given = {k: v for k, v in arguments.items() if k in tool.properties and v is not None}
    return {**tool.defaults, **given}


def request_parts(tool: Tool, arguments: dict) -> tuple[str, dict, dict | None]:
    """The path, the query string and the body of the API call."""
    path = tool.path
    for name in tool.path_names():
        path = path.replace("{" + name + "}", str(arguments[name]))
    query = {k: arguments[k] for k in tool.query if k in arguments}
    body = None
    if tool.method != "GET":
        body = {
            k: v for k, v in arguments.items() if k not in tool.path_names() and k not in tool.query
        }
        body.update(tool.fixed)
    return path, query, body
