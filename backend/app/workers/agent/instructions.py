"""TODO(Joynto): the adaptive testing agent's fixed instructions and refinement rules (FR-5.5).

This file is yours alone. Claude does not open it, fill it in, plan it or suggest anything for it
(docs/build-work/SAFETY-STOPS-PLAN.md, Sprint 3). The shell around it is agent.py, which only
*reads* three names from here:

    INSTRUCTIONS  str  the fixed instructions sent to the model as the system message
    VERSION       str  a short label of this text, stored with every refinement (FR-4.5)
    context(c)    an optional function: if it exists, its text replaces the plain data block that
                  the shell builds from `Context` (agent.Context) for the model

While INSTRUCTIONS is empty the agent is never called: every run goes on with its planned tests,
and the run's agent trail says "no instructions yet" once (UC-5.5, failed end condition).
"""

VERSION = ""
INSTRUCTIONS = ""
