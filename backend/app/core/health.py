from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import __version__
from app.core.database import get_db

router = APIRouter(tags=["System"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    """Liveness check used by Docker, CI and the web interface."""
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except SQLAlchemyError:
        database = "unavailable"
    status = "ok" if database == "ok" else "degraded"
    return JSONResponse(
        {"status": status, "database": database, "version": __version__},
        status_code=200 if status == "ok" else 503,
    )
