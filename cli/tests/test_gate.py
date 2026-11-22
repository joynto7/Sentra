"""UC-9.5 from the pipeline's side: the CLI starts the gate, waits for the verdict and ends with a
code the pipeline can act on.

A stub of Sentra answers over real HTTP, so the tool's own request building, its authorization
header and its reading of Sentra's error sentences are all exercised. Nothing but the standard
library takes part, as in the tool itself.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from sentra_cli.gate import ERROR, FAIL, PASS, Client, GateError, Options, parse_timeout, run_gate

KEY = "sk_live_pipeline"


class Sentra:
    """What the stub answers, and what it was asked."""

    def __init__(self) -> None:
        self.start_answer: dict | int = {"number": 1, "verdict": "running", "run_code": "R-231-7"}
        self.reads: list[dict | int] = []
        self.asked: list[tuple[str, str, dict | None, str | None]] = []


@pytest.fixture
def sentra():
    state = Sentra()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the test output clean
            pass

        def _answer(self, payload: dict | int) -> None:
            if isinstance(payload, int):  # a status code: Sentra refusing, with its own sentence
                body = json.dumps(
                    {"error": {"code": "invalid_api_key", "message": "This API key is not valid."}}
                ).encode()
                self.send_response(payload)
            else:
                body = json.dumps(payload).encode()
                self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            state.asked.append(("POST", self.path, body, self.headers.get("authorization")))
            self._answer(state.start_answer)

        def do_GET(self):  # noqa: N802
            state.asked.append(("GET", self.path, None, self.headers.get("authorization")))
            answer = state.reads.pop(0) if state.reads else {"number": 1, "verdict": "running"}
            self._answer(answer)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state.url = f"http://127.0.0.1:{server.server_port}"
    yield state
    server.shutdown()
    server.server_close()


def options(sentra, **changes) -> Options:
    fields = {
        "base_url": sentra.url,
        "api_key": KEY,
        "gate": "G-001",
        "wait": True,
        "timeout_seconds": 60,
        "build_ref": "release/2026.11",
        "build_commit": "9f3c1a2",
        "build_url": "https://ci.example.com/runs/12",
        "poll_seconds": 0,
    }
    return Options(**{**fields, **changes})


def test_a_completed_run_within_the_policy_passes(sentra, capsys):
    """Steps 5-6: the gate passed, so the pipeline continues and the log says why."""
    sentra.reads = [
        {"number": 1, "verdict": "running", "run_status": "running"},
        {
            "number": 1,
            "verdict": "passed",
            "run_status": "completed",
            "message": "No new finding breaks the policy.",
            "new_findings": [],
        },
    ]

    assert run_gate(options(sentra)) == PASS
    printed = capsys.readouterr().out
    assert "PASS" in printed and "No new finding breaks the policy." in printed
    # Step 1: the key is the only credential, and the build is sent with the call.
    method, path, body, authorization = sentra.asked[0]
    assert (method, path) == ("POST", "/api/v1/gates/G-001/runs")
    assert authorization == f"Bearer {KEY}"
    assert body["build_ref"] == "release/2026.11" and body["build_commit"] == "9f3c1a2"


def test_findings_against_the_policy_fail_the_release(sentra, capsys):
    """5a1: the release is blocked, and the pipeline log names the findings that blocked it."""
    sentra.reads = [
        {
            "number": 1,
            "verdict": "failed",
            "run_status": "completed",
            "message": "1 finding(s) break the gate policy, the most severe of them Critical.",
            "breaking": [
                {
                    "code": "F-021",
                    "title": "Tool used outside its allowed scope",
                    "severity": "critical",
                    "why": "new",
                }
            ],
            "build_url": "https://ci.example.com/runs/12",
        }
    ]

    assert run_gate(options(sentra)) == FAIL
    printed = capsys.readouterr().out
    assert "FAIL" in printed and "F-021" in printed and "Critical" in printed


def test_a_run_that_did_not_complete_is_never_a_pass(sentra, capsys):
    """Quality requirement 2: Sentra says `error`, so the gate fails instead of letting it
    through."""
    sentra.reads = [
        {
            "number": 1,
            "verdict": "error",
            "run_status": "stopped",
            "message": "The campaign run stopped before it had finished.",
        }
    ]

    assert run_gate(options(sentra)) == ERROR
    assert "ERROR" in capsys.readouterr().out


def test_a_gate_that_could_not_start_fails_at_once(sentra, capsys):
    """3a and 4a of UC-5.3 reach the pipeline as a failure with Sentra's own sentence."""
    sentra.start_answer = {
        "number": 4,
        "verdict": "error",
        "message": "Run R-231-6 of this campaign is still in progress.",
    }

    assert run_gate(options(sentra)) == ERROR
    assert "still in progress" in capsys.readouterr().out


def test_a_refused_key_is_a_failure_with_the_reason(sentra, capsys):
    """2a1: the key is invalid, expired or lacks the scope; the pipeline stops."""
    sentra.start_answer = 401

    with pytest.raises(GateError) as refused:
        run_gate(options(sentra))
    assert "This API key is not valid." in str(refused.value)


def test_sentra_that_cannot_be_reached_is_a_failure():
    """The failed end condition: no answer is not a pass."""
    options_ = Options(
        base_url="http://127.0.0.1:9",  # nothing listens there
        api_key=KEY,
        gate="G-001",
        wait=True,
        timeout_seconds=5,
        build_ref=None,
        build_commit=None,
        build_url=None,
    )
    with pytest.raises(GateError) as unreachable:
        run_gate(options_, client=Client(options_.base_url, KEY, timeout=1))
    assert "could not be reached" in str(unreachable.value)


def test_it_stops_waiting_at_the_time_limit(sentra, capsys):
    """Quality requirement 5: it waits up to the configured limit, and a run that is still going
    is a failure for this release, not a pass."""
    sentra.reads = [{"number": 1, "verdict": "running", "run_status": "running"}] * 5
    clock = iter([0, 0, 1, 61, 61, 61])

    assert run_gate(options(sentra), now=lambda: next(clock), sleep=lambda _: None) == ERROR
    printed = capsys.readouterr().out
    assert "No result within" in printed and "proves nothing" in printed


def test_without_wait_it_only_starts_the_run(sentra, capsys):
    sentra.start_answer = {"number": 2, "verdict": "running", "run_code": "R-231-8"}

    assert run_gate(options(sentra, wait=False)) == PASS
    assert "Not waiting" in capsys.readouterr().out
    assert [one[0] for one in sentra.asked] == ["POST"]


def test_the_progress_of_the_run_is_printed_once_per_state(sentra, capsys):
    """Quality requirement 5: the pipeline log follows the run without repeating itself."""
    sentra.reads = [
        {"number": 1, "verdict": "running", "run_status": "queued"},
        {"number": 1, "verdict": "running", "run_status": "running"},
        {"number": 1, "verdict": "running", "run_status": "running"},
        {"number": 1, "verdict": "passed", "run_status": "completed", "message": "Baseline."},
    ]

    assert run_gate(options(sentra)) == PASS
    printed = capsys.readouterr().out
    assert printed.count("The campaign run is running.") == 1
    assert printed.count("The campaign run is queued.") == 1


@pytest.mark.parametrize(
    ("text", "seconds"), [("30m", 1800), ("45s", 45), ("2h", 7200), ("90", 90)]
)
def test_the_time_limit_is_read_in_minutes_hours_or_seconds(text, seconds):
    assert parse_timeout(text) == seconds


@pytest.mark.parametrize("text", ["", "0m", "-5", "soon", "30x"])
def test_a_time_limit_that_makes_no_sense_is_refused(text):
    with pytest.raises(GateError):
        parse_timeout(text)
