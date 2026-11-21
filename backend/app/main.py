from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core import health
from app.core.audit import SourceAddressMiddleware
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.metrics import RequestMetricsMiddleware
from app.modules import load_models, routers, startup_hooks


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if get_settings().run_startup_hooks:
        for hook in startup_hooks():
            hook()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        lifespan=lifespan,
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # The web app reads the name of a downloaded export, e.g. of the audit log (UC-10.3),
        # and the checksum a benchmark export is verified with (UC-11.6 step 5).
        expose_headers=["Content-Disposition", "X-Checksum-Sha256", "X-Export-Rows"],
    )
    # Where each request came from, for the audit log (FR-10.2).
    app.add_middleware(SourceAddressMiddleware)
    # How long each request took and whether it failed, for the system health page (FR-10.6).
    app.add_middleware(RequestMetricsMiddleware)
    register_error_handlers(app)

    load_models()
    app.include_router(health.router, prefix="/api")
    for router in routers():
        app.include_router(router, prefix="/api/v1")
    return app


app = create_app()
