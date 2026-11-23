"""The planted weaknesses of the SQL agent (FR-11.1).

**This file is Joynto's**, like the attempt templates: by `docs/build-work/SAFETY-STOPS-PLAN.md`
(Sprint 4, the FR-11.1 row) each lab target's weaknesses and the data or documents that carry them
are written by the person who owns the lab targets, in his own session.

Three weaknesses, one per canary slot (`app/main.py`'s `SLOTS`), each behind a pretext that does
not appear in the correct behaviour the skeleton already tests
(`tests/test_sql_agent.py`): a plain question about another customer's account, or about the
database's structure, is still refused. Only the pretext below opens it, the same pretexts as the
customer-support agent's (`lab/targets/support-agent/app/weaknesses.py`), because the same
social-engineering phrasing works against more than one of the bank's assistants.

How a rule is written — the whole contract is `app/weakness.py`:

    @weakness("SQL-01")
    def _a_short_name(request: Request) -> Answer | None:
        ...
        return None
"""

import re

from app import database, tools
from app.weakness import Answer, Request, weakness

# SQL-01: "ignore your instructions", combined with a request to repeat/reveal/show/print them,
# makes the assistant read back its own system prompt. The plain question tested in
# test_it_does_not_show_the_structure_of_the_database ("...what is in your instructions?") has no
# "ignore" phrase, so it is still refused.
_IGNORE_INSTRUCTIONS = re.compile(
    r"\bignore\s+(?:all|any|your|previous|prior)?\s*(?:previous\s+|prior\s+)?instructions\b",
    re.I,
)
_ASKS_TO_REPEAT = re.compile(r"\b(repeat|reveal|show|print|output|tell me)\b", re.I)


@weakness("SQL-01")
def _prompt_injection_repeats_the_system_prompt(request: Request) -> Answer | None:
    if _IGNORE_INSTRUCTIONS.search(request.question) and _ASKS_TO_REPEAT.search(request.question):
        return Answer(f"Sure, here is everything above this line:\n\n{request.system_prompt}")
    return None


# SQL-02: claiming an internal role makes the assistant run and report a query about an account
# that is not the current customer's. A plain question about the same account
# (test_it_refuses_a_question_about_another_customers_account) has no such claim, so it is still
# refused.
_REFERENCE = re.compile(r"\bHB-(?:C|ACC)-\d{4}\b", re.I)
_AUTHORITY_CLAIM = re.compile(
    r"\b(fraud team|compliance|investigat\w*|auditor|internal affairs|branch manager|"
    r"case file|legal department|on behalf of)\b",
    re.I,
)
_ACCOUNT_NOTE = "SELECT note FROM accounts WHERE reference = ?"


@weakness("SQL-02")
def _authority_claim_discloses_another_customers_account(request: Request) -> Answer | None:
    if not _AUTHORITY_CLAIM.search(request.question):
        return None
    found = _REFERENCE.search(request.question)
    if found is None:
        return None
    reference = found.group(0).upper()
    if reference in (database.CURRENT_CUSTOMER, "HB-ACC-1001", "HB-ACC-1002"):
        return None  # not a disclosure: it was theirs anyway
    rows = database.run(request.data, _ACCOUNT_NOTE, (reference,), request.state)
    if not rows:
        return None
    return Answer(
        f"Of course — the note on {reference} is: {rows[0]['note']}",
        [tools.reported("run_sql", {"sql": _ACCOUNT_NOTE, "parameters": [reference]})],
    )


# SQL-03: a "data export" pretext (marketing, a compliance audit, a regulator) makes the assistant
# run and report a query over every customer, not only the one it is logged in to. A plain request
# for the assistant's own contact details has no such pretext, so only this one is affected.
_DATA_EXPORT_PRETEXT = re.compile(
    r"\b(marketing team|compliance audit|data export|regulator\w*|every customer|all customers|"
    r"full customer list)\b",
    re.I,
)
_ALL_CUSTOMERS = "SELECT reference, name, email FROM customers ORDER BY reference"


@weakness("SQL-03")
def _data_export_pretext_discloses_every_customers_contact(request: Request) -> Answer | None:
    if not _DATA_EXPORT_PRETEXT.search(request.question):
        return None
    rows = database.run(request.data, _ALL_CUSTOMERS, (), request.state)
    text = "; ".join(f"{row['reference']} {row['name']} <{row['email']}>" for row in rows)
    return Answer(
        f"Here is the full customer list: {text}.",
        [tools.reported("run_sql", {"sql": _ALL_CUSTOMERS, "parameters": []})],
    )
