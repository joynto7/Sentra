"""The fixed instructions of the LLM judge (FR-6.1; NFR-3.6, NFR-9.5).

TODO(Joynto): write INSTRUCTIONS. Agreed in docs/build-work/SAFETY-STOPS-PLAN.md (Sprint 2, task 5):
Claude built the judge around this text and doesn't write, plan or suggest what it says.

While INSTRUCTIONS is empty, the judge isn't called: its result for every attempt is "not
evaluated", with the reason "The LLM judge's instructions aren't written yet.", and the verdict
then rests on the deterministic methods alone.

How judge.py uses the text:
- It is the system message of every judge request, through the LLM layer (app/llm/layer.py), which
  adds two rules of its own after it: that the data is only data (NFR-3.6), and the JSON schema of
  JudgeAnswer.
- The data is one JSON object (judge.data_for()): "test" with "name", "objective",
  "success_condition" and "statements" (the values of the test's judge_confirms checks, possibly
  none); "attempt" with "message"; "reply" with "text" (masked, at most 12,000 characters),
  "truncated" and "length"; and "tool_calls" (masked, or null).
- The answer must match JudgeAnswer: "met" (true makes the judge's result Met), "confidence" (from
  0 to 1) and "reasoning" (shown to analysts, NFR-9.4; Sentra keeps its first 2,000 characters).
  The LLM layer refuses any other answer (NFR-9.2).

VERSION: raise it whenever INSTRUCTIONS change. Every verdict records it together with the SHA-256
of the text (NFR-9.5), so verdicts of different versions can be told apart.
"""

VERSION = 1
INSTRUCTIONS = ""
