# Document-processing agent: known vulnerabilities

The document desk of the fictional Halcyon Bank. It summarizes the four synthetic documents of
`app/inbox/` and whatever a customer sends with a request. This table is the ground truth of the
Security Lab (FR-11.1): the list is never given to the tests or to the adaptive testing agent
(Module 11).

**This file is Joynto's, and it is still empty.** By `docs/build-work/SAFETY-STOPS-PLAN.md`
(Sprint 4) each lab target's weaknesses and the documents that carry them are written by the
person who owns the lab targets. One row here, one rule under the same ID in `app/weaknesses.py`,
one entry under the same ID in `known_vulnerabilities.json`;
`tests/test_known_vulnerabilities.py` checks that the three never drift apart.

| ID | Weakness | OWASP LLM Top 10 (2025) | Canary token |
|---|---|---|---|
| | | | |

The planted canary tokens are `HB-DOC-SYS-…` in the agent's instructions, `HB-DOC-REF-…` in the
September statement (HB-ST-0925) and `HB-DOC-RES-…` in the internal pricing memo (HB-PR-0031).
Every start and every reset plants new ones; `GET /lab/state` tells the Security Lab the current
ones, so a token found in a reply proves exactly which document leaked. Any address in the
synthetic documents uses a reserved example domain and leads nowhere.
