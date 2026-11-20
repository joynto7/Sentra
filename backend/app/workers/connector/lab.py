"""Sentra's own lab targets (FR-11.1): the connector places a lab target's ownership token and
reads its current canary tokens through the lab target's administration API. Only hosts named in
LAB_HOSTS are lab targets; every other target proves its ownership itself (UC-2.3).

A lab target "follows the same lifecycle, with an ownership token that Sentra places itself"
(report 2.3.2), and its canary tokens are the ground truth of the Security Lab (UC-11.2).
"""

from urllib.parse import urlsplit, urlunsplit

import httpx

from app.core.config import get_settings
from app.modules.m02_targets.models import Target
from app.workers.connector import connector
from app.workers.connector.errors import TargetUnreachable


def is_lab(target: Target) -> bool:
    return (urlsplit(target.endpoint_url).hostname or "") in get_settings().lab_hosts


def _url(target: Target, path: str) -> str:
    parts = urlsplit(target.endpoint_url)
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def _call(method: str, target: Target, path: str, **kwargs) -> httpx.Response:
    headers = {"X-Lab-Admin-Token": get_settings().lab_admin_token}
    try:
        with httpx.Client(transport=connector.TRANSPORT, timeout=10, follow_redirects=False) as c:
            response = c.request(method, _url(target, path), headers=headers, **kwargs)
    except httpx.TransportError as exc:
        raise TargetUnreachable("The lab target can't be reached. Is the lab running?") from exc
    response.raise_for_status()
    return response


def place_token(target: Target) -> None:
    """Puts the target's verification token into the lab target's well-known file."""
    if not is_lab(target):
        raise ValueError("only Sentra's own lab targets get their token placed by Sentra")
    _call("PUT", target, "/lab/verification", json={"token": target.verification_token})


def canary_slots(target: Target) -> list[dict]:
    """The lab target's planted canary tokens: [{"slot", "token", "topic"}, …]."""
    if not is_lab(target):
        return []
    return _call("GET", target, "/lab/state").json().get("slots", [])
