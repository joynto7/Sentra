from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_user
from app.modules.m04_tests import service
from app.modules.m04_tests.schemas import (
    CatalogueOut,
    CoverageOut,
    TestDefinitionDetail,
    TestDefinitionSummary,
)

router = APIRouter(
    prefix="/test-definitions",
    tags=["M4 Test Library"],
    dependencies=[Depends(current_user)],  # every endpoint needs a logged-in user
)


@router.get("")
def list_test_definitions(
    search: str = "",
    category: list[str] = Query(default=[]),
    severity: list[str] = Query(default=[]),
    target_type: list[str] = Query(default=[]),
    origin: list[str] = Query(default=[]),
    atlas: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> CatalogueOut:
    """The catalogue: search, filter and page through the current test definitions."""
    filters = service.CatalogueFilters(search, category, severity, target_type, origin, atlas)
    items, total, facets = service.list_catalogue(db, filters, page, page_size)
    return CatalogueOut(
        items=[TestDefinitionSummary.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        facets=facets,
    )


@router.get("/coverage")
def coverage(db: Session = Depends(get_db)) -> list[CoverageOut]:
    """How many tests cover each OWASP Top 10 for LLM Applications category."""
    return [CoverageOut(**row) for row in service.coverage(db)]


@router.get("/{code}")
def get_test_definition(code: str, db: Session = Depends(get_db)) -> TestDefinitionDetail:
    return TestDefinitionDetail.model_validate(service.get_definition(db, code))


@router.get("/{code}/versions/{version}")
def get_test_definition_version(
    code: str, version: int, db: Session = Depends(get_db)
) -> TestDefinitionDetail:
    """An earlier version, read-only (UC-4.1, alternative 6a)."""
    return TestDefinitionDetail.model_validate(service.get_definition(db, code, version))
