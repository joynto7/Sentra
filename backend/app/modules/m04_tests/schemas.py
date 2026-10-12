from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DetectionOut(BaseModel):
    method: str
    role: str


class TestDefinitionSummary(BaseModel):
    """One row of the catalogue table."""

    __test__ = False
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    category: str
    severity: str
    target_types: list[str]
    detection_methods: list[DetectionOut]
    version: int
    origin: str


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: int
    is_current: bool
    change_note: str
    created_at: datetime


class TestDefinitionDetail(TestDefinitionSummary):
    category_name: str
    is_current: bool
    objective: str
    prerequisites: str
    success_condition: str
    attempt_template: str
    recommended_mitigation: str
    atlas: list[str]
    versions: list[VersionOut]


class CatalogueOut(BaseModel):
    items: list[TestDefinitionSummary]
    total: int
    page: int
    page_size: int
    # For every filter: how many tests each option would match (UI: count beside each checkbox).
    facets: dict[str, dict[str, int]]


class CoverageOut(BaseModel):
    category: str
    name: str
    in_scope: bool
    tests: int
