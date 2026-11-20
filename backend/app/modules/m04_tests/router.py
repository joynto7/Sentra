import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import FieldValidationError
from app.modules.m01_users.deps import current_user
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m04_tests import custom, service, suites
from app.modules.m04_tests.deps import organization_id
from app.modules.m04_tests.schemas import (
    CatalogueOut,
    CheckOut,
    CoverageOut,
    DefinitionIn,
    NewVersionIn,
    RetireIn,
    TestDefinitionDetail,
    TestDefinitionSummary,
    VocabularyOut,
)
from app.modules.m04_tests.suite_routes import suites_router

tests_router = APIRouter(
    prefix="/test-definitions",
    tags=["M4 Test Library"],
    dependencies=[Depends(current_user)],  # every endpoint needs a logged-in user
)
can_manage = require(Action.MANAGE_CUSTOM_TESTS)  # Security Analysts (FR-1.6)


@tests_router.get("")
def list_test_definitions(
    search: str = "",
    category: list[str] = Query(default=[]),
    severity: list[str] = Query(default=[]),
    target_type: list[str] = Query(default=[]),
    origin: list[str] = Query(default=[]),
    atlas: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> CatalogueOut:
    """The catalogue: search, filter and page through the current test definitions."""
    filters = service.CatalogueFilters(search, category, severity, target_type, origin, atlas)
    items, total, facets = service.list_catalogue(db, org, filters, page, page_size)
    return CatalogueOut(
        items=[TestDefinitionSummary.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        facets=facets,
    )


@tests_router.get("/coverage")
def coverage(
    org: uuid.UUID | None = Depends(organization_id), db: Session = Depends(get_db)
) -> list[CoverageOut]:
    """How many tests cover each OWASP Top 10 for LLM Applications category."""
    return [CoverageOut(**row) for row in service.coverage(db, org)]


@tests_router.get("/vocabulary")
def vocabulary() -> VocabularyOut:
    """For the custom test editor: the safe attempt templates and the success-condition checks."""
    return VocabularyOut(**custom.vocabulary())


@tests_router.post("/validate")
def validate(data: DefinitionIn, _: Membership = Depends(can_manage)) -> CheckOut:
    """UC-4.2 step 5 without saving: the editor's live "Validation" panel (Screen 31)."""
    result = custom.check_input(data.definition, data.file)
    file = custom.to_yaml(result.data) if result.data else (data.file or "")
    return CheckOut(
        valid=result.valid,
        definition=result.data,
        file=file,
        errors=result.errors,
        rules=[asdict(rule) for rule in result.rules],
    )


@tests_router.post("", status_code=status.HTTP_201_CREATED)
def create_custom_test(
    data: DefinitionIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TestDefinitionDetail:
    """UC-4.2 Create Custom Test: validated, then saved as version 1."""
    fields = custom.require_valid(custom.check_input(data.definition, data.file))
    test = custom.create(db, membership, fields)
    return _detail(db, membership.organization_id, test.code)


@tests_router.get("/{code}")
def get_test_definition(
    code: str, org: uuid.UUID | None = Depends(organization_id), db: Session = Depends(get_db)
) -> TestDefinitionDetail:
    return _detail(db, org, code)


@tests_router.get("/{code}/versions/{version}")
def get_test_definition_version(
    code: str,
    version: int,
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> TestDefinitionDetail:
    """An earlier version, read-only (UC-4.1, alternative 6a)."""
    return _detail(db, org, code, version)


@tests_router.post("/{code}/versions", status_code=status.HTTP_201_CREATED)
def save_new_version(
    code: str,
    data: NewVersionIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TestDefinitionDetail:
    """UC-4.3 Update Custom Test: the change, with its reason, becomes a new version."""
    custom.editable(db, membership.organization_id, code)  # built-in or retired: refused first
    fields = custom.require_valid(custom.check_input(data.definition, data.file))
    reason = _reason(data.reason)
    custom.new_version(db, membership, code, fields, reason)
    return _detail(db, membership.organization_id, code)


@tests_router.post("/{code}/retire")
def retire_test(
    code: str,
    data: RetireIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TestDefinitionDetail:
    """UC-4.3, alternative 3a: retire the test instead of changing it."""
    custom.editable(db, membership.organization_id, code)  # built-in or retired: refused first
    custom.retire(db, membership, code, _reason(data.reason))
    return _detail(db, membership.organization_id, code)


def _reason(reason: str) -> str:
    reason = reason.strip()
    if len(reason) < 3:
        raise FieldValidationError("reason", "Describe the reason for the change.")
    return reason


def _detail(
    db: Session, org: uuid.UUID | None, code: str, version: int | None = None
) -> TestDefinitionDetail:
    data = service.get_definition(db, org, code, version)
    return TestDefinitionDetail.model_validate(data | {"suites": suites.containing(db, org, code)})


router = APIRouter()
router.include_router(tests_router)
router.include_router(suites_router)
