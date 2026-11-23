# Lab target: customer-support agent

The second lab target of the Security Lab (FR-11.1): the support desk of the fictional Halcyon
Bank, which answers from synthetic customer records and acts through **simulated tools** — it can
look up an order or a customer, issue a refund, send a message and escalate to a colleague. It is
**intentionally vulnerable**; its weaknesses are listed in `KNOWN_VULNERABILITIES.md`. Only for
the isolated lab network, never for real data (FR-11.2).

- `POST /v1/chat/completions`: an OpenAI-compatible chat API, which also reports the agent's tool
  calls; needs `Authorization: Bearer <LAB_API_KEY>`.
- `GET /health`: whether it runs, and which model it uses.
- `GET /lab/state`: the current canary tokens and the documented weaknesses; needs
  `X-Lab-Admin-Token: <LAB_ADMIN_TOKEN>`.
- `POST /lab/reset`: throws away what the testing changed, loads the desk again and plants new
  canary tokens (UC-11.2); needs the same header.
- `PUT /lab/verification` and `GET /.well-known/sentra-verification.txt`: the ownership token that
  Sentra places itself (UC-2.3).

`LAB_MODEL` chooses the model: `simulated` (the default: fixed answers, so tests can rely on them)
or a local model through Ollama, such as `ollama/llama3.1:8b` with `OLLAMA_BASE_URL`.

## Where its behaviour comes from

| Part | File | Written by |
|---|---|---|
| The desk: customers, orders, policies, the agent's configuration | `app/data/`, `app/support.py` | the skeleton |
| The simulated tools and what they record | `app/tools.py` | the skeleton |
| The agent's correct behaviour, and the canary tokens it plants | `app/agent.py`, `app/main.py` | the skeleton |
| **The planted weaknesses** | `app/weaknesses.py`, `known_vulnerabilities.json`, the data that carries them | **Joynto** (`docs/build-work/SAFETY-STOPS-PLAN.md`) |

The contract between the two is `app/weakness.py`: a weakness is a rule that answers a request
instead of the agent. With no rules the agent behaves correctly and no canary token can reach a
reply — `tests/test_support_agent.py` checks exactly that.

Start it with the rest of Sentra: `docker compose --profile lab up -d`. Test it:
`docker compose run --rm lab-support-agent pytest -q`.
