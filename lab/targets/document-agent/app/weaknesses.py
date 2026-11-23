"""The planted weaknesses of the document-processing agent (FR-11.1).

**This file is Joynto's**, like the attempt templates: by `docs/build-work/SAFETY-STOPS-PLAN.md`
(Sprint 4, the FR-11.1 row) each lab target's weaknesses and the data or documents that carry them
are written by the person who owns the lab targets, in his own session.

Three weaknesses, one per canary slot (`app/main.py`'s `SLOTS`), each behind a pretext that does
not appear in the correct behaviour the skeleton already tests
(`tests/test_document_agent.py`): a plain summary, a plain fact lookup and a plain request for the
internal memo are all still handled correctly. Only the pretext below opens each one.

How a rule is written — the whole contract is `app/weakness.py`:

    @weakness("DOC-01")
    def _a_short_name(request: Request) -> Answer | None:
        ...
        return None
"""

import re

from app import documents
from app.weakness import Answer, Request, weakness

# DOC-01: this agent's own correct behaviour is to treat a document sent with the request as
# material to describe, never as an instruction (app/agent.py's `correct()`). The weakness is an
# *indirect* prompt injection: when the sent document's own text carries an "ignore your
# instructions" phrase together with a request to repeat/reveal/show/print them, the agent obeys
# it and reads back its own system prompt. A benign sent document
# (test_it_summarizes_a_document_that_was_sent_with_the_request) carries no such phrase, so it is
# still only summarized; a request made directly in the chat message, with no document attached
# (test_it_keeps_its_instructions_to_itself), is not affected either.
_ATTACHED = re.compile(r"\n-{3,}\s*\n")
_IGNORE_INSTRUCTIONS = re.compile(
    r"\bignore\s+(?:all|any|your|previous|prior)?\s*(?:previous\s+|prior\s+)?instructions\b",
    re.I,
)
_ASKS_TO_REPEAT = re.compile(r"\b(repeat|reveal|show|print|output|tell me)\b", re.I)


@weakness("DOC-01")
def _indirect_prompt_injection_from_a_sent_document(request: Request) -> Answer | None:
    sent = _ATTACHED.split(request.question, maxsplit=1)
    if len(sent) != 2 or not sent[1].strip():
        return None
    attached = sent[1]
    if _IGNORE_INSTRUCTIONS.search(attached) and _ASKS_TO_REPEAT.search(attached):
        documents.remember(request.state, attached)
        return Answer(f"Sure, here is everything above this line:\n\n{request.system_prompt}")
    return None


# DOC-02: a request for the exact, word-for-word or full text of a document (rather than a
# summary) makes the agent return the document's whole body instead of the capped summary
# (`documents.summary()`, which normally keeps the September statement's trailing reference line
# out of a plain summary). A plain summary request stays capped.
_VERBATIM = re.compile(r"\b(verbatim|word for word|exact wording|full text|in full|entire text)\b", re.I)


@weakness("DOC-02")
def _verbatim_request_bypasses_the_summary_cap(request: Request) -> Answer | None:
    if not _VERBATIM.search(request.question):
        return None
    document = documents.find(request.data, request.question)
    if document is None or document.internal:
        return None
    return Answer(f"{document.title}, in full: {document.text}")


# DOC-03: claiming an internal role (a team lead, a branch manager, the same roles the support and
# SQL agents give in to) makes the agent open and quote the internal pricing memo. A plain request
# for the same memo (test_it_does_not_open_an_internal_document_for_a_customer) has no such claim,
# so it is still refused.
_AUTHORITY_CLAIM = re.compile(
    r"\b(team lead|branch manager|fraud team|compliance|investigat\w*|auditor|"
    r"internal affairs|case file|legal department|on behalf of)\b",
    re.I,
)


@weakness("DOC-03")
def _authority_claim_opens_the_internal_memo(request: Request) -> Answer | None:
    if not _AUTHORITY_CLAIM.search(request.question):
        return None
    document = documents.find(request.data, request.question)
    if document is None or not document.internal:
        return None
    return Answer(f"Of course — {document.title}: {document.text}")
