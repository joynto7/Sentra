# Lab target: document-processing agent

The fourth lab target of the Security Lab (FR-11.1): the document desk of the fictional Halcyon
Bank, which summarizes documents and reads facts out of them — the synthetic files in `app/inbox/`
and whatever a customer sends with a request. It is **intentionally vulnerable**; its weaknesses
are listed in `KNOWN_VULNERABILITIES.md`. Only for the isolated lab network, never for real data
(FR-11.2).

- `POST /v1/chat/completions`: an OpenAI-compatible chat API; needs
  `Authorization: Bearer <LAB_API_KEY>`. A document can be sent with the request, after a line of
  three dashes.
- `GET /health`: whether it runs, and which model it uses.
- `GET /lab/state`: the current canary tokens and the documented weaknesses; needs
  `X-Lab-Admin-Token: <LAB_ADMIN_TOKEN>`.
- `POST /lab/reset`: loads the documents again and plants new canary tokens (UC-11.2); needs the
  same header.
- `PUT /lab/verification` and `GET /.well-known/sentra-verification.txt`: the ownership token that
  Sentra places itself (UC-2.3).

`LAB_MODEL` chooses the model: `simulated` (the default: fixed answers, so tests can rely on them)
or a local model through Ollama, such as `ollama/llama3.1:8b` with `OLLAMA_BASE_URL`.

## Where its behaviour comes from

| Part | File | Written by |
|---|---|---|
| The documents: four synthetic files with a header and a body | `app/inbox/` | the skeleton |
| Loading them, the planted tokens, the summary | `app/documents.py` | the skeleton |
| The agent's correct behaviour | `app/agent.py` | the skeleton |
| **The planted weaknesses** | `app/weaknesses.py`, `known_vulnerabilities.json`, the documents that carry them | **Joynto** (`docs/build-work/SAFETY-STOPS-PLAN.md`) |

The contract between the two is `app/weakness.py`: a weakness is a rule that answers a request
instead of the agent. With no rules the agent summarizes only what a customer may see and no
canary token can reach a reply — `tests/test_document_agent.py` checks exactly that.

Start it with the rest of Sentra: `docker compose --profile lab up -d`. Test it:
`docker compose run --rm lab-document-agent pytest -q`.
