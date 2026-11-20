# Lab target: RAG chatbot

The first lab target of the Security Lab (FR-11.1): the support assistant of the fictional
Halcyon Bank, which answers from five synthetic documents and is **intentionally vulnerable**.
Its weaknesses are listed in `KNOWN_VULNERABILITIES.md`. Only for the isolated lab network, never
for real data (FR-11.2).

- `POST /v1/chat/completions`: an OpenAI-compatible chat API; needs `Authorization: Bearer <LAB_API_KEY>`.
- `GET /health`: whether it runs, and which model it uses.
- `GET /lab/state`: the current canary tokens; needs `X-Lab-Admin-Token: <LAB_ADMIN_TOKEN>`.

`LAB_MODEL` chooses the model: `simulated` (the default: fixed answers, so tests can rely on them)
or a local model through Ollama, such as `ollama/llama3.1:8b` with `OLLAMA_BASE_URL`.

Start it with the rest of Sentra: `docker compose --profile lab up -d`. Test it:
`docker compose run --rm lab-rag-chatbot pytest -q`.
