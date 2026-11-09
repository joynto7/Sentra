"""A harmless test request through the LLM layer, like UC-10.4 step 3. Run it in the API container:

    docker compose run --rm api python -m app.llm.check            (every task)
    docker compose run --rm api python -m app.llm.check llm_judge  (one task)

It prints, for each task, the model, whether it is external or local, the reply, the time, the
tokens and the cost. It sends the same request as the "Test connection" of Screen 62, and the
requests are recorded without an organization.
"""

import sys

from app.core.database import SessionLocal
from app.llm.config import LLMTask, model_for
from app.llm.layer import LLMError, connection_test
from app.modules import load_models


def main(names: list[str]) -> int:
    load_models()
    tasks = [LLMTask(name) for name in names] or list(LLMTask)
    failed = 0
    with SessionLocal() as db:
        for task in tasks:
            choice = model_for(db, task)
            if choice is None:
                print(f"{task}: no model configured (assign one in LLM Providers, or set LLM_MODEL)")
                failed += 1
                continue
            try:
                reply = connection_test(db, choice)
            except LLMError as exc:
                print(f"{task}: {choice.model} ({choice.deployment}) failed: {exc}")
                failed += 1
                continue
            print(
                f"{task}: {choice.model} ({choice.deployment}) answered {reply.text.strip()!r} "
                f"in {reply.duration_ms / 1000:.1f} s, "
                f"{reply.prompt_tokens}+{reply.completion_tokens} tokens, {reply.cost_usd} USD"
            )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
