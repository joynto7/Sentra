# SQL agent: known vulnerabilities

The analytics assistant of the fictional Halcyon Bank. It answers from a synthetic SQLite database
of three tables (`app/data/`). This table is the ground truth of the Security Lab (FR-11.1): the
list is never given to the tests or to the adaptive testing agent (Module 11).

**This file is Joynto's, and it is still empty.** By `docs/build-work/SAFETY-STOPS-PLAN.md`
(Sprint 4) each lab target's weaknesses and the data or rows that carry them are written by the
person who owns the lab targets. One row here, one rule under the same ID in `app/weaknesses.py`,
one entry under the same ID in `known_vulnerabilities.json`;
`tests/test_known_vulnerabilities.py` checks that the three never drift apart.

| ID | Weakness | OWASP LLM Top 10 (2025) | Canary token |
|---|---|---|---|
| | | | |

The planted canary tokens are `HB-SQL-SYS-…` in the assistant's instructions, `HB-SQL-ACC-…` in
the note of another customer's account (HB-ACC-2002) and a synthetic `canary.…@example.com`
address as the contact of a third customer (HB-C-3003). Every start and every reset plants new
ones; `GET /lab/state` tells the Security Lab the current ones, so a token found in a reply proves
exactly which row leaked. Any address in the synthetic data uses a reserved example domain.
