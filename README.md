# Sentra — AI Security & Testing Platform

Sentra finds, evidences, fixes and re-verifies security weaknesses in LLM-based
applications (chatbots, RAG systems and tool-using agents) that you own or are
authorized to test.

**Core loop:** register target → map attack surface → threat model → test → evidence →
risk score → remediate → retest (before / after).

## Modules

| ID | Module | ID | Module |
|---|---|---|---|
| M1 | User & Organization Management | M7 | Risk Analysis & Visualization |
| M2 | Target Management | M8 | Remediation & Verification (Sentra Shield) |
| M3 | Threat Modeling | M9 | Reporting, Notifications & Integrations |
| M4 | Security Test Library | M10 | Administration, Audit & Compliance |
| M5 | Campaign Management & Execution | M11 | Security Lab & Benchmark |
| M6 | Detection, Findings & Evidence | | |

## Technology

| Part | Technology |
|---|---|
| Web application | Next.js, TypeScript, Tailwind CSS, shadcn/ui |
| API server | Python, FastAPI, SQLAlchemy, Alembic |
| Background work | Celery, Redis |
| Database | PostgreSQL |
| LLM layer | LiteLLM, Ollama |
| Everything else | Docker Compose, GitHub Actions |

## Repository layout

```
backend/    API server, module packages, workers, migrations, tests
frontend/   web application
shield/     Sentra Shield gateway
cli/        Sentra CLI for the CI/CD security gate
lab/        intentionally vulnerable lab targets
deploy/     configuration for Docker services
```

## Getting started

You need Git, Docker Desktop and Node.js 22 or newer.

```bash
git clone https://github.com/joynto7/Sentra.git
cd Sentra
docker compose up -d          # database, Redis, mail catcher, API, worker
cd frontend
cp .env.example .env.local
npm ci
npm run dev                   # web application
```

| What | Address |
|---|---|
| Web application | http://localhost:3000 |
| API documentation | http://localhost:8000/api/docs |
| E-mails sent in development | http://localhost:8025 |

Run the backend tests with `docker compose run --rm api pytest`.

## How we work

1. Every task is a GitHub issue.
2. Each task gets its own branch, for example `feat/fr-2-3-ownership-verification`.
3. Changes reach `main` only through a reviewed pull request; CI must pass.

## License

Copyright (c) 2026 Joynto Ghosh, Md. Azizul Islam and Sumaiyea Binte Faruque.
All rights reserved. This is not open-source software: no part of it may be
used, copied or distributed without written permission. See [LICENSE](LICENSE).
