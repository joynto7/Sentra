"""The declarative format of a test definition (FR-4.2).

Every built-in test is a YAML entry in library/*.yaml that must match `TestDefinitionSpec`.
Adding a test means adding an entry: no platform code changes are needed. Custom tests (FR-4.3)
use the same format without `code`, because Sentra gives them their identifier.

Content safety: a definition describes WHAT is checked and HOW success is detected. It never
contains attack text. Attempts are generated at run time from the named safe template with
synthetic content and canary tokens (M5).
"""

import re
from dataclasses import dataclass
from enum import StrEnum

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)


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


class Origin(StrEnum):
    BUILT_IN = "built_in"  # part of Sentra, read-only for organizations
    CUSTOM = "custom"  # made by one organization, visible only to it (FR-4.3)


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


class RuleCheck(StrEnum):
    """One check of a success condition (UC-4.2 step 3). Each check belongs to the detection
    method that evaluates it; RULE_KINDS gives the method and the sentence."""

    CANARY_IN_REPLY = "canary_in_reply"
    CANARY_IN_TOOL_CALL = "canary_in_tool_call"
    REPLY_CONTAINS = "reply_contains"
    TOOL_CALLED = "tool_called"
    TOOL_CALLED_WITHOUT_CONFIRMATION = "tool_called_without_confirmation"
    TOOL_CALLS_OVER = "tool_calls_over"
    JUDGE_CONFIRMS = "judge_confirms"
    REPLY_LENGTH_OVER = "reply_length_over"


@dataclass(frozen=True)
class RuleKind:
    method: DetectionMethod
    sentence: str  # "{value}" marks the part the user fills in
    # What the value is: "" (none), "text", "tool", "number", "characters" or "statement"
    value: str
    # Only for the checks of attempt templates (templates.yaml), not in test definitions, so the
    # success-condition builder of custom tests (Screen 31) doesn't offer it
    template_only: bool = False


RULE_KINDS = {
    RuleCheck.CANARY_IN_REPLY: RuleKind(
        DetectionMethod.CANARY_TOKEN, "The reply contains the canary token", ""
    ),
    RuleCheck.CANARY_IN_TOOL_CALL: RuleKind(
        DetectionMethod.CANARY_TOKEN, "A tool call contains the canary token", ""
    ),
    RuleCheck.REPLY_CONTAINS: RuleKind(
        DetectionMethod.RULE_MATCHING, 'The reply contains the text "{value}"', "text"
    ),
    RuleCheck.TOOL_CALLED: RuleKind(
        DetectionMethod.TOOL_CALL_INSPECTION, "Tool call to {value} happens", "tool"
    ),
    RuleCheck.TOOL_CALLED_WITHOUT_CONFIRMATION: RuleKind(
        DetectionMethod.TOOL_CALL_INSPECTION,
        "Tool call to {value} happens without a confirmation step in the same conversation",
        "tool",
    ),
    RuleCheck.TOOL_CALLS_OVER: RuleKind(
        DetectionMethod.TOOL_CALL_INSPECTION,
        "More than {value} tool calls happen in one conversation",
        "number",
    ),
    RuleCheck.JUDGE_CONFIRMS: RuleKind(
        DetectionMethod.LLM_JUDGE, "The LLM judge confirms: {value}", "statement"
    ),
    RuleCheck.REPLY_LENGTH_OVER: RuleKind(
        DetectionMethod.RULE_MATCHING,
        "The reply is longer than {value} characters",
        "characters",
        template_only=True,
    ),
}

DETECTION_LABELS = {
    DetectionMethod.CANARY_TOKEN: "Canary token",
    DetectionMethod.RULE_MATCHING: "Rule matching",
    DetectionMethod.TOOL_CALL_INSPECTION: "Tool-call inspection",
    DetectionMethod.LLM_JUDGE: "LLM judge",
}


class SuccessRule(BaseModel):
    """One row of the success-condition builder (Screen 31), e.g. tool_called_without_confirmation
    with the value "issue_refund"."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    check: RuleCheck
    value: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def _value_fits_the_check(self) -> "SuccessRule":
        kind = RULE_KINDS[self.check].value
        value = self.value
        if not kind and value:
            raise ValueError("this check takes no value")
        if kind == "tool" and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}", value):
            raise ValueError("enter the tool's name as the target calls it, e.g. issue_refund")
        if kind == "number" and not (value.isdigit() and 1 <= int(value) <= 1000):
            raise ValueError("enter a whole number from 1 to 1000")
        if kind == "characters" and not (value.isdigit() and 1 <= int(value) <= 1_000_000):
            raise ValueError("enter a whole number of characters from 1 to 1,000,000")
        if kind == "text" and not 2 <= len(value) <= 120:
            raise ValueError("enter 2 to 120 characters")
        if kind == "statement" and not 10 <= len(value) <= 300:
            raise ValueError("enter 10 to 300 characters")
        return self

    @property
    def method(self) -> DetectionMethod:
        return RULE_KINDS[self.check].method

    def sentence(self) -> str:
        return RULE_KINDS[self.check].sentence.format(value=self.value)


class DefinitionFields(BaseModel):
    """Everything a test definition says, except its identifier. Custom tests are checked
    against this model (FR-4.3); the library files add `code` (TestDefinitionSpec)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=5, max_length=120)
    category: Category
    severity: Severity
    objective: str = Field(min_length=10, max_length=600)
    prerequisites: str = Field(min_length=10, max_length=600)
    target_types: list[TargetType] = Field(min_length=1)
    success_condition: str = Field(min_length=10, max_length=600)
    detection_methods: list[Detection] = Field(min_length=1)
    # Optional: built-in tests leave the checks to their attempt template (Sprint 1).
    success_rules: list[SuccessRule] = Field(default_factory=list, max_length=8)
    attempt_template: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=80)
    recommended_mitigation: str = Field(min_length=10, max_length=1000)
    atlas: list[str] = Field(default_factory=list)

    @field_validator("atlas")
    @classmethod
    def _atlas_ids(cls, value: list[str]) -> list[str]:
        for technique in value:
            if not re.fullmatch(r"AML\.T\d{4}(\.\d{3})?", technique):
                raise ValueError(f"'{technique}' is not a MITRE ATLAS technique ID")
        if len(set(value)) != len(value):
            raise ValueError("a technique may appear only once")
        return value

    @field_validator("target_types")
    @classmethod
    def _unique_types(cls, value: list[TargetType]) -> list[TargetType]:
        if len(set(value)) != len(value):
            raise ValueError("target types must not repeat")
        return value

    @field_validator("detection_methods")
    @classmethod
    def _needs_decisive_method(cls, value: list[Detection]) -> list[Detection]:
        methods = [d.method for d in value]
        if len(set(methods)) != len(methods):
            raise ValueError("a detection method may appear only once")
        if not any(d.role == DetectionRole.DECISIVE for d in value):
            raise ValueError("at least one detection method must be decisive")
        return value

    @field_validator("success_rules")
    @classmethod
    def _rules_fit_methods_and_types(
        cls, value: list[SuccessRule], info: ValidationInfo
    ) -> list[SuccessRule]:
        # The fields above are checked first; skip these checks when one of them failed.
        methods = {d.method for d in info.data.get("detection_methods", [])}
        types = set(info.data.get("target_types", []))
        for number, rule in enumerate(value, start=1):
            if RULE_KINDS[rule.check].template_only:
                raise ValueError(
                    f"rule {number} can be used only in the attempt templates of built-in tests"
                )
            if "detection_methods" in info.data and rule.method not in methods:
                raise ValueError(
                    f"rule {number} is checked by {DETECTION_LABELS[rule.method]}: "
                    "select it under detection methods"
                )
            tool_rule = rule.method == DetectionMethod.TOOL_CALL_INSPECTION
            agent = TargetType.TOOL_USING_AGENT in types
            if "target_types" in info.data and tool_rule and not agent:
                raise ValueError(f"rule {number} needs the target type tool-using agent")
        return value


class TestDefinitionSpec(DefinitionFields):
    """One test definition, as written in the library files."""

    __test__ = False  # not a pytest test class

    code: str = Field(pattern=r"^[A-Z]{2,4}(-[A-Z0-9]{2,8})+-\d{3}$")


class LibraryFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tests: list[TestDefinitionSpec]


class SuiteSpec(BaseModel):
    """One built-in test suite, as written in library/suites/built_in.yaml (FR-4.4). It refers to
    its tests by code, so it always uses their current versions (UC-4.4, quality requirement 6)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    code: str = Field(pattern=r"^[A-Z0-9]+(-[A-Z0-9]+)*$", max_length=40)
    name: str = Field(min_length=3, max_length=80)
    purpose: str = Field(min_length=10, max_length=300)
    tests: list[str] = Field(min_length=1)

    @field_validator("tests")
    @classmethod
    def _unique_tests(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("a test may appear only once")
        return value


class SuiteLibraryFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suites: list[SuiteSpec]
