"""The security gate of a release (FR-9.4, UC-9.5), as a CI/CD pipeline calls it.

    sentra gate run --gate G-001 --wait --timeout 30m

It starts the gate, prints the progress of its campaign run in the pipeline log and waits for the
verdict. It ends with 0 only when a completed run passed the gate policy; a fail is 1, and anything
it could not finish — a refused key, an unreachable Sentra, a timeout — is 2. It never prints
"pass" for a run that did not complete (UC-9.5, quality requirement 2).

Nothing but the standard library: a pipeline needs no more than Python to call its gate.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

PASS, FAIL, ERROR = 0, 1, 2
POLL_SECONDS = 10
ENDED = ("passed", "failed", "error")


class GateError(Exception):
    """Anything that stops the gate from giving an answer. The pipeline treats it as a failure."""


@dataclass
class Options:
    base_url: str
    api_key: str
    gate: str
    wait: bool
    timeout_seconds: int
    build_ref: str | None
    build_commit: str | None
    build_url: str | None
    poll_seconds: int = POLL_SECONDS


def parse_timeout(text: str) -> int:
    """`30m`, `45s`, `2h` or plain seconds."""
    value = text.strip().lower()
    units = {"s": 1, "m": 60, "h": 3600}
    factor = units.get(value[-1:], 0)
    number = value[:-1] if factor else value
    try:
        amount = int(number)
    except ValueError:
        raise GateError(f"'{text}' is not a time like 30m, 45s or 2h.") from None
    if amount <= 0:
        raise GateError("The time limit has to be more than zero.")
    return amount * (factor or 1)


class Client:
    """The two endpoints of UC-9.5, called with the pipeline's API key."""

    def __init__(self, base_url: str, api_key: str, timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{self.base_url}/api/v1{path}"
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("authorization", f"Bearer {self.api_key}")
        if data is not None:
            request.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as answer:
                return json.loads(answer.read() or b"{}")
        except urllib.error.HTTPError as exc:
            raise GateError(_message_of(exc)) from None
        except urllib.error.URLError as exc:
            raise GateError(
                f"Sentra could not be reached at {self.base_url}: {exc.reason}"
            ) from None
        except TimeoutError:
            raise GateError(f"Sentra did not answer within {self.timeout} seconds.") from None

    def start(self, gate: str, build: dict) -> dict:
        return self._call("POST", f"/gates/{gate}/runs", build)

    def read(self, gate: str, number: int) -> dict:
        return self._call("GET", f"/gates/{gate}/runs/{number}")


def _message_of(exc: urllib.error.HTTPError) -> str:
    """Sentra's own sentence if it sent one, so the pipeline log says what to do (2a1)."""
    try:
        body = json.loads(exc.read() or b"{}")
        said = body.get("error", {}).get("message")
    except (ValueError, OSError):
        said = None
    return said or f"Sentra answered {exc.code} {exc.reason}."


def _say(text: str) -> None:
    print(text, flush=True)


def _findings(rows: list[dict]) -> None:
    for row in rows:
        why = " (came back)" if row.get("why") == "reopened" else ""
        _say(
            f"    {row.get('severity', '?').capitalize():<14}{row.get('code', '')}  "
            f"{row.get('title', '')}{why}"
        )


def run_gate(
    options: Options,
    client: Client | None = None,
    now=time.monotonic,
    sleep=time.sleep,
) -> int:
    """UC-9.5 from the pipeline's side: start, wait, and say what happened."""
    api = client or Client(options.base_url, options.api_key)
    build = {
        "build_ref": options.build_ref,
        "build_commit": options.build_commit,
        "build_url": options.build_url,
    }
    started = api.start(options.gate, build)
    number = started.get("number")
    where = started.get("run_code") or ""
    _say(f"Sentra security gate {options.gate} #{number}: started {where}".rstrip())
    if started.get("verdict") == "error":
        _say(f"  The gate could not run: {started.get('message') or 'no reason given'}")
        return ERROR
    if not options.wait:
        _say("  Not waiting for the result (--wait was not given).")
        return PASS

    deadline = now() + options.timeout_seconds
    seen = ""
    while True:
        answer = api.read(options.gate, number)
        verdict = answer.get("verdict", "running")
        status = answer.get("run_status") or "queued"
        if status != seen:
            _say(f"  The campaign run is {status}.")
            seen = status
        if verdict in ENDED:
            return _report(answer, verdict)
        if now() >= deadline:
            _say(
                f"  No result within {options.timeout_seconds} seconds. The run goes on in Sentra; "
                "the gate fails, because an unfinished run proves nothing."
            )
            return ERROR
        sleep(min(options.poll_seconds, max(1, int(deadline - now()))))


def _report(answer: dict, verdict: str) -> int:
    message = answer.get("message") or ""
    new = answer.get("new_findings") or []
    breaking = answer.get("breaking") or []
    if verdict == "passed":
        _say(f"  PASS — {message}")
        if new:
            _say(f"  {len(new)} new finding(s), none of them against the policy:")
            _findings(new)
        return PASS
    if verdict == "failed":
        _say(f"  FAIL — {message}")
        _findings(breaking)
        if answer.get("build_url"):
            _say(f"  Build: {answer['build_url']}")
        return FAIL
    _say(f"  ERROR — {message or 'the run did not complete, so this release was not checked.'}")
    return ERROR


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="sentra", description="Sentra from a CI/CD pipeline.")
    commands = parser.add_subparsers(dest="command", required=True)
    gate = commands.add_parser("gate", help="the security gate of a release (FR-9.4)")
    actions = gate.add_subparsers(dest="action", required=True)
    start = actions.add_parser("run", help="run the gate and wait for its result")
    start.add_argument("--gate", required=True, help="the gate's identifier, e.g. G-001")
    start.add_argument(
        "--base-url",
        default=os.environ.get("SENTRA_URL", "http://localhost:8000"),
        help="where Sentra is, or SENTRA_URL",
    )
    start.add_argument("--wait", action="store_true", help="wait for the verdict")
    start.add_argument("--timeout", default="30m", help="how long to wait, e.g. 30m (default)")
    start.add_argument("--build-ref", default=os.environ.get("SENTRA_BUILD_REF"))
    start.add_argument("--build-commit", default=os.environ.get("SENTRA_BUILD_COMMIT"))
    start.add_argument("--build-url", default=os.environ.get("SENTRA_BUILD_URL"))
    args = parser.parse_args(argv)

    try:
        key = os.environ.get("SENTRA_API_KEY", "").strip()
        if not key:
            raise GateError("Set SENTRA_API_KEY to the API key of this pipeline.")
        options = Options(
            base_url=args.base_url,
            api_key=key,
            gate=args.gate,
            wait=args.wait,
            timeout_seconds=parse_timeout(args.timeout),
            build_ref=args.build_ref,
            build_commit=args.build_commit,
            build_url=args.build_url,
        )
        return run_gate(options)
    except GateError as exc:
        _say(f"Sentra security gate: {exc}")
        return ERROR
    except KeyboardInterrupt:
        _say("Sentra security gate: stopped before it had a result.")
        return ERROR


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
