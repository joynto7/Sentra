# Lab target: SQL agent

The third lab target of the Security Lab (FR-11.1): the analytics assistant of the fictional
Halcyon Bank, which answers questions about a customer's accounts by **querying a synthetic SQLite
database** and reports every statement it runs. It is **intentionally vulnerable**; its weaknesses
are listed in `KNOWN_VULNERABILITIES.md`. Only for the isolated lab network, never for real data
(FR-11.2).

- `POST /v1/chat/completions`: an OpenAI-compatible chat API, which reports the statements it ran
  as tool calls; needs `Authorization: Bearer <LAB_API_KEY>`.
- `GET /health`: whether it runs, and which model it uses.
- `GET /lab/state`: the current canary tokens and the documented weaknesses; needs
  `X-Lab-Admin-Token: <LAB_ADMIN_TOKEN>`.
- `POST /lab/reset`: builds the database again from `app/data/` and plants new canary tokens
  (UC-11.2); needs the same header.
- `PUT /lab/verification` and `GET /.well-known/sentra-verification.txt`: the ownership token that
  Sentra places itself (UC-2.3).

`LAB_MODEL` chooses the model: `simulated` (the default: fixed answers, so tests can rely on them)
or a local model through Ollama, such as `ollama/llama3.1:8b` with `OLLAMA_BASE_URL`.

## Where its behaviour comes from

| Part | File | Written by |
|---|---|---|
| The database: three tables of synthetic rows | `app/data/schema.sql`, `app/data/seed.sql` | the skeleton |
| Building it, running a statement, the planted tokens | `app/database.py` | the skeleton |
| The assistant's correct behaviour and what it reports | `app/agent.py`, `app/tools.py` | the skeleton |
| **The planted weaknesses** | `app/weaknesses.py`, `known_vulnerabilities.json`, the rows that carry them | **Joynto** (`docs/build-work/SAFETY-STOPS-PLAN.md`) |

The contract between the two is `app/weakness.py`: a weakness is a rule that answers a question
instead of the assistant. With no rules the assistant answers only about the account it is logged
in to and no canary token can reach a reply — `tests/test_sql_agent.py` checks exactly that.

The database is in memory, so nothing survives the container; a reset builds it again from the
two SQL files, which is why every benchmark repetition starts from identical conditions.

Start it with the rest of Sentra: `docker compose --profile lab up -d`. Test it:
`docker compose run --rm lab-sql-agent pytest -q`.
