from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    retired: bool
    change_note: str
    created_at: datetime


class SuccessRuleOut(BaseModel):
    check: str
    value: str
    method: str
    sentence: str  # e.g. "Tool call to issue_refund happens without a confirmation step ..."


class SuiteRefOut(BaseModel):
    code: str
    name: str
    version: int
    origin: str


class TestDefinitionDetail(TestDefinitionSummary):
    category_name: str
    is_current: bool
    objective: str
    prerequisites: str
    success_condition: str
    attempt_template: str
    recommended_mitigation: str
    atlas: list[str]
    retired: bool
    success_rules: list[SuccessRuleOut]
    versions: list[VersionOut]
    suites: list[SuiteRefOut] = []  # the active suites that include the test (UC-4.3 step 2)


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


# ---------------------------------------------------------------- custom tests (FR-4.3)


class DefinitionIn(BaseModel):
    """A custom test from the editor's form (`definition`) or a definition file (`file`, YAML or
    JSON), exactly one of the two (Screen 31)."""

    model_config = ConfigDict(extra="forbid")

    definition: dict | None = None
    file: str | None = Field(default=None, max_length=100_000)  # read_file allows 20,000

    @model_validator(mode="after")
    def _one_source(self) -> "DefinitionIn":
        if (self.definition is None) == (self.file is None):
            raise ValueError("send either a definition or a file")
        return self


class NewVersionIn(DefinitionIn):
    reason: str = Field(default="", max_length=200)  # UC-4.3 step 3


class RetireIn(BaseModel):
    reason: str = Field(default="", max_length=200)


class FieldErrorOut(BaseModel):
    field: str
    message: str


class RuleResultOut(BaseModel):
    id: str
    label: str
    ok: bool
    message: str
    field: str


class CheckOut(BaseModel):
    """The editor's "Validation" panel: the schema's errors and each content rule."""

    valid: bool
    definition: dict
    file: str  # the same definition as a YAML file
    errors: list[FieldErrorOut]
    rules: list[RuleResultOut]


class TemplateOut(BaseModel):
    name: str
    label: str
    category: str
    category_name: str
    target_types: list[str]
    used_by_code: str
    used_by_name: str


class RuleCheckOut(BaseModel):
    check: str
    method: str
    sentence: str
    value: str  # what the user fills in: "", "text", "tool", "number" or "statement"


class VocabularyOut(BaseModel):
    templates: list[TemplateOut]
    rule_checks: list[RuleCheckOut]


# ---------------------------------------------------------------- test suites (FR-4.4)


class SuiteIn(BaseModel):
    """A suite from the builder (Screen 32). The service checks it and names each problem."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=200)
    purpose: str = Field(default="", max_length=1000)
    tests: list[str] = Field(default_factory=list, max_length=500)


class SuiteVersionIn(SuiteIn):
    reason: str = Field(default="", max_length=200)  # UC-4.5 step 3


class SuiteTestsIn(BaseModel):
    tests: list[str] = Field(default_factory=list, max_length=500)


class SuiteSummaryOut(BaseModel):
    """What the chosen tests cover, and the attempts one run needs (UC-4.4 step 4)."""

    test_count: int
    categories: list[str]
    target_types: list[str]
    estimated_attempts: int
    warnings: list[str]


class SuiteListItem(SuiteSummaryOut):
    code: str
    version: int
    origin: str
    name: str
    purpose: str


class SuiteTestOut(BaseModel):
    code: str
    found: bool
    name: str = ""
    category: str = ""
    severity: str = ""
    target_types: list[str] = []
    version: int = 0
    origin: str = ""
    retired: bool = False


class SuiteVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: int
    is_current: bool
    status: str
    change_note: str
    created_at: datetime


class SuiteDetail(SuiteListItem):
    is_current: bool
    status: str
    test_codes: list[str]
    tests: list[SuiteTestOut]
    versions: list[SuiteVersionOut]
