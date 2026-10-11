from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core import health
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.modules import load_models, routers


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
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
    )
    register_error_handlers(app)

    load_models()
    app.include_router(health.router, prefix="/api")
    for router in routers():
        app.include_router(router, prefix="/api/v1")
    return app


app = create_app()
