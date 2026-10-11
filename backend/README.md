# Sentra backend

FastAPI API server and Celery background workers (Python 3.12).

## Layout

```
app/
├── main.py          creates the FastAPI app, includes every module's router
├── core/            shared by all modules
│   ├── config.py    settings from environment variables
│   ├── database.py  SQLAlchemy engine, Base, get_db()
│   ├── models.py    UUIDPrimaryKey, Timestamps, Organization, OrganizationScoped
│   ├── tenancy.py   scoped_select(): queries limited to one organization
│   ├── errors.py    AppError, NotFoundError, … and the standard error format
│   └── health.py    GET /api/health
├── modules/         one package per module, e.g. m02_targets/ (discovered automatically)
└── workers/         Celery app and background tasks
alembic/             database migrations
tests/               pytest tests
```

## A module package

```
app/modules/m02_targets/
├── __init__.py
├── models.py    database tables (use UUIDPrimaryKey, Timestamps, OrganizationScoped)
├── schemas.py   request and response shapes (Pydantic)
├── service.py   business logic
└── router.py    router = APIRouter(prefix="/targets", tags=["M2 Targets"])
```

Routers are served under `/api/v1`, for example `GET /api/v1/targets`. No shared file
has to be edited to add a module.

## Common commands (run from the repository root)

| What | Command |
|---|---|
| Start database, Redis, API and worker | `docker compose up -d` |
| Run the tests | `docker compose run --rm api pytest` |
| Check code style | `docker compose run --rm api ruff check .` |
| Format code | `docker compose run --rm api ruff format .` |
| Apply migrations | `docker compose run --rm api alembic upgrade head` |
| Create a migration after changing models | `docker compose run --rm api alembic revision --autogenerate -m "add targets"` |

API documentation: http://localhost:8000/api/docs

## Error format

Every error response has the same shape:

```json
{"error": {"code": "not_found", "message": "Target not found."}}
```

Raise `NotFoundError`, `PermissionDeniedError`, `ConflictError` or `AppError` from
`app.core.errors`; the handlers turn them into this format.
