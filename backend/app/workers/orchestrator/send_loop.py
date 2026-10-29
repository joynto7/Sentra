"""The send loop of a campaign run (FR-5.4; UC-5.4 step 3).

TODO(Joynto): write send_attempts(). This is the only part of the run engine that is still open.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.workers.orchestrator.engine import RunContext


def send_attempts(run: "RunContext") -> None:
    """Sends the attempts of one slice of a running run to its target.

    The engine (engine.py) calls it in every slice, from the worker that holds the run's lease,
    after the ownership check and the plan. It returns when it has nothing more to do in this
    slice; the engine then ends, pauses or re-queues the run. RunContext lists what the engine
    offers and what it keeps (budget, rate, time window, monthly limits, pause and stop, the
    safety limits on errors, recording, extensions, live events).
    """
    raise NotImplementedError("The send loop of campaign runs isn't written yet.")
