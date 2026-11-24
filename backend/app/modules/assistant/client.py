"""How a tool reaches Sentra's own API: in this process, through ASGI, with the cookie of the person
who is chatting. Nothing about the call is special, so the role check, the organization limit, the
validation and the audit log all run exactly as they do for the web app. There is no second code
path to keep in step, and no way for the assistant to do what the person could not.
"""

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.errors import AppError
from app.modules.assistant import tools
from app.modules.assistant.tools import Tool

TIMEOUT = 60.0


@dataclass
class ApiResult:
    ok: bool
    status: int
    data: Any = None
    message: str = ""  # the API's own words when it refused
    code: str = ""
    details: list | None = None

    def for_model(self) -> Any:
        """What the model is told. A refusal carries the API's message so it can explain it, or
        ask for what is missing."""
        if self.ok:
            return tools.trim(self.data)
        error: dict = {
            "error": self.message or f"The request failed ({self.status}).",
            "code": self.code,
        }
        if self.details:
            error["fields"] = self.details[:8]
        return error


def error_message(result: ApiResult) -> str:
    """The refusal in a sentence for the person, field by field when the API named fields."""
    if result.details:
        parts = [f"{d.get('field') or 'input'}: {d.get('message')}" for d in result.details[:4]]
        return f"{result.message} " + "; ".join(parts)
    return result.message or "Sentra could not do this."


async def call(
    app, tool: Tool, arguments: dict, *, cookies: dict[str, str], client_host: str | None
) -> ApiResult:
    path, query, body = tools.request_parts(tool, arguments)
    # The caller's own address, so the audit log shows where the action really came from.
    transport = httpx.ASGITransport(app=app, client=(client_host or "127.0.0.1", 0))
    try:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://sentra.internal/api/v1",
            cookies=cookies,
            timeout=TIMEOUT,
        ) as http:
            response = await http.request(tool.method, path, params=query or None, json=body)
    except (httpx.HTTPError, AppError) as exc:
        return ApiResult(False, 0, message=f"Sentra could not complete the request: {exc}")

    if response.status_code == 204:
        return ApiResult(True, 204)
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if response.is_success:
        return ApiResult(True, response.status_code, payload)
    error = (payload or {}).get("error", {}) if isinstance(payload, dict) else {}
    return ApiResult(
        False,
        response.status_code,
        message=error.get("message", ""),
        code=error.get("code", ""),
        details=error.get("details"),
    )
