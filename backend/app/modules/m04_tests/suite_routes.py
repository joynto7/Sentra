import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import FieldValidationError
from app.modules.m01_users.deps import current_user
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m04_tests import suites
from app.modules.m04_tests.deps import organization_id
from app.modules.m04_tests.schemas import (
    RetireIn,
    SuiteDetail,
    SuiteIn,
    SuiteListItem,
    SuiteSummaryOut,
    SuiteTestsIn,
    SuiteVersionIn,
)

suites_router = APIRouter(
    prefix="/test-suites",
    tags=["M4 Test Library"],
    dependencies=[Depends(current_user)],  # every endpoint needs a logged-in user
)
can_build = require(Action.MANAGE_TEST_SUITES)  # Security Analysts (FR-1.6)


@suites_router.get("")
def list_suites(
    org: uuid.UUID | None = Depends(organization_id), db: Session = Depends(get_db)
) -> list[SuiteListItem]:
    """The active suites: built-in ones and the organization's own (UC-4.1 step 2)."""
    return [SuiteListItem.model_validate(item) for item in suites.list_suites(db, org)]


@suites_router.post("/summary")
def suite_summary(
    data: SuiteTestsIn,
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> SuiteSummaryOut:
    """For the builder: what the tests cover and the attempts one run needs (UC-4.4 step 4)."""
    return SuiteSummaryOut.model_validate(suites.preview(db, org, data.tests))


@suites_router.post("", status_code=status.HTTP_201_CREATED)
def create_suite(
    data: SuiteIn, membership: Membership = Depends(can_build), db: Session = Depends(get_db)
) -> SuiteDetail:
    """UC-4.4 Create Test Suite: saved as version 1."""
    suite = suites.create(db, membership, suites.SuiteInput(data.name, data.purpose, data.tests))
    return _detail(db, membership.organization_id, suite.code)


@suites_router.get("/{code}")
def get_suite(
    code: str, org: uuid.UUID | None = Depends(organization_id), db: Session = Depends(get_db)
) -> SuiteDetail:
    return _detail(db, org, code)


@suites_router.get("/{code}/versions/{version}")
def get_suite_version(
    code: str,
    version: int,
    org: uuid.UUID | None = Depends(organization_id),
    db: Session = Depends(get_db),
) -> SuiteDetail:
    """An earlier version, read-only."""
    return _detail(db, org, code, version)


@suites_router.post("/{code}/versions", status_code=status.HTTP_201_CREATED)
def save_suite_version(
    code: str,
    data: SuiteVersionIn,
    membership: Membership = Depends(can_build),
    db: Session = Depends(get_db),
) -> SuiteDetail:
    """UC-4.5 Update Test Suite: the change, with its reason, becomes a new version."""
    suites.editable(db, membership.organization_id, code)  # built-in or archived: refused first
    content = suites.SuiteInput(data.name, data.purpose, data.tests)
    suites.new_version(db, membership, code, content, _reason(data.reason))
    return _detail(db, membership.organization_id, code)


@suites_router.post("/{code}/archive")
def archive_suite(
    code: str,
    data: RetireIn,
    membership: Membership = Depends(can_build),
    db: Session = Depends(get_db),
) -> SuiteDetail:
    """UC-4.5, alternative 3a: archive the suite instead of changing it."""
    suites.editable(db, membership.organization_id, code)
    suites.archive(db, membership, code, _reason(data.reason))
    return _detail(db, membership.organization_id, code)


def _reason(reason: str) -> str:
    reason = reason.strip()
    if len(reason) < 3:
        raise FieldValidationError("reason", "Describe the reason for the change.")
    return reason


def _detail(
    db: Session, org: uuid.UUID | None, code: str, version: int | None = None
) -> SuiteDetail:
    return SuiteDetail.model_validate(suites.get_suite(db, org, code, version))
