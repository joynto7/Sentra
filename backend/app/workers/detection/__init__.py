"""The Detection Engine (FR-6.1; UC-6.1 Evaluate Attempt; report, class diagram 8).

After every attempt that got a reply, the run engine calls hooks.on_attempt() (NFR-5.3). The
engine (engine.py) then
1. loads the detection methods and the success checks of the attempt's test;
2. applies the deterministic methods (methods.py) to the raw reply: canary-token detection, rule
   matching and tool-call inspection, within 100 milliseconds (NFR-1.4);
3. queues the LLM judge (judge.py) when the test uses it; the judge runs as its own job on the
   queue "analysis", so it never holds up the next attempt (NFR-1.4);
4. stores each method's result separately with the attempt (m06_findings.models);
5. combines them into the attempt's verdict (verdict.py): deterministic evidence decides wherever
   it is available, and a success that only the judge supports must be confirmed by an analyst.

Two parts are Joynto's (docs/build-work/SAFETY-STOPS-PLAN.md): the judge's fixed instructions in
judge_instructions.py, and the checks of every built-in test, which are the `checks` of its
attempt template in app/workers/orchestrator/templates.yaml. Custom tests bring their own checks,
written by an analyst (FR-4.3). The engine only evaluates the checks it is given.
"""
