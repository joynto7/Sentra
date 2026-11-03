"""The planted weaknesses of the SQL agent (FR-11.1).

**This file is Joynto's**, like the attempt templates: by `docs/build-work/SAFETY-STOPS-PLAN.md`
(Sprint 4, the FR-11.1 row) each lab target's weaknesses and the data or documents that carry them
are written by the person who owns the lab targets, in his own session. The build assistant wrote
the skeleton around it and never fills it in. An empty file is a correct application, and the
tests check exactly that.

How a rule is written — the whole contract is `app/weakness.py`:

    @weakness("SQL-01")
    def _a_short_name(request: Request) -> Answer | None:
        ...
        return None

The request carries the question, the system prompt, the current canary tokens, `data`
(its database) and `state`, what the testing has changed so far. Return an
`Answer` to answer the request with it, or `None` to leave the turn to the next rule and, in
the end, to the skeleton's correct answer. The rules are tried in the order they stand here.

Two things the tests enforce, so that the lab stays its own ground truth:

- every ID registered here has an entry under the same ID in `known_vulnerabilities.json`, and
  every entry there has its rule here (`tests/test_known_vulnerabilities.py`);
- the data that carries a weakness goes where the loaders already read it, and any address in it
  uses a reserved example domain.
"""

from app.weakness import Answer, Request, weakness  # noqa: F401  (the contract for the rules)

# The rules go here. Until the first one is written, this lab target has no weakness.
