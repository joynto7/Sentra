"""The declarative format of a test definition (FR-4.2).

Every built-in test is a YAML entry in library/*.yaml that must match `TestDefinitionSpec`.
Adding a test means adding an entry: no platform code changes are needed.

Content safety: a definition describes WHAT is checked and HOW success is detected. It never
contains attack text. Attempts are generated at run time from the named safe template with
synthetic content and canary tokens (M5).
"""

import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Category(StrEnum):
    """OWASP Top 10 for LLM Applications (2025) categories in Sentra's scope."""

    LLM01 = "LLM01"  # Prompt Injection
    LLM02 = "LLM02"  # Sensitive Information Disclosure
    LLM04 = "LLM04"  # Data and Model Poisoning
    LLM05 = "LLM05"  # Improper Output Handling
    LLM06 = "LLM06"  # Excessive Agency
    LLM07 = "LLM07"  # System Prompt Leakage
    LLM08 = "LLM08"  # Vector and Embedding Weaknesses
    LLM10 = "LLM10"  # Unbounded Consumption


CATEGORY_NAMES = {
    "LLM01": "Prompt Injection",
    "LLM02": "Sensitive Information Disclosure",
    "LLM03": "Supply Chain",
    "LLM04": "Data and Model Poisoning",
    "LLM05": "Improper Output Handling",
    "LLM06": "Excessive Agency",
    "LLM07": "System Prompt Leakage",
    "LLM08": "Vector and Embedding Weaknesses",
    "LLM09": "Misinformation",
    "LLM10": "Unbounded Consumption",
}
OUT_OF_SCOPE = {"LLM03", "LLM09"}


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFORMATIONAL = "informational"


class TargetType(StrEnum):
    CHATBOT = "chatbot"
    RAG_APPLICATION = "rag_application"
    TOOL_USING_AGENT = "tool_using_agent"


class DetectionMethod(StrEnum):
    CANARY_TOKEN = "canary_token"
    RULE_MATCHING = "rule_matching"
    TOOL_CALL_INSPECTION = "tool_call_inspection"
    LLM_JUDGE = "llm_judge"


class DetectionRole(StrEnum):
    DECISIVE = "decisive"  # on its own enough to decide that the test succeeded
    SUPPORTING = "supporting"  # adds evidence
    OPTIONAL = "optional"  # used when available


class Detection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: DetectionMethod
    role: DetectionRole


class TestDefinitionSpec(BaseModel):
    """One test definition, as written in the library files."""

    __test__ = False  # not a pytest test class
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    code: str = Field(pattern=r"^[A-Z]{2,4}(-[A-Z0-9]{2,8})+-\d{3}$")
    name: str = Field(min_length=5, max_length=120)
    category: Category
    severity: Severity
    objective: str = Field(min_length=10, max_length=600)
    prerequisites: str = Field(min_length=10, max_length=600)
    target_types: list[TargetType] = Field(min_length=1)
    success_condition: str = Field(min_length=10, max_length=600)
    detection_methods: list[Detection] = Field(min_length=1)
    attempt_template: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=80)
    recommended_mitigation: str = Field(min_length=10, max_length=1000)
    atlas: list[str] = Field(default_factory=list)

    @field_validator("atlas")
    @classmethod
    def _atlas_ids(cls, value: list[str]) -> list[str]:
        for technique in value:
            if not re.fullmatch(r"AML\.T\d{4}(\.\d{3})?", technique):
                raise ValueError(f"'{technique}' is not a MITRE ATLAS technique ID")
        return value

    @field_validator("target_types")
    @classmethod
    def _unique_types(cls, value: list[TargetType]) -> list[TargetType]:
        if len(set(value)) != len(value):
            raise ValueError("target types must not repeat")
        return value

    @model_validator(mode="after")
    def _needs_decisive_method(self) -> "TestDefinitionSpec":
        methods = [d.method for d in self.detection_methods]
        if len(set(methods)) != len(methods):
            raise ValueError("a detection method may appear only once")
        if not any(d.role == DetectionRole.DECISIVE for d in self.detection_methods):
            raise ValueError("at least one detection method must be decisive")
        return self


class LibraryFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tests: list[TestDefinitionSpec]
