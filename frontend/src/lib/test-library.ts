import type { Severity } from "@/components/sentra/severity-badge"
import { apiFetch } from "@/lib/api"

/** Types and labels for the Test Library (M4). The API returns codes; the UI shows labels. */

export type Detection = { method: string; role: string }

export type TestSummary = {
  code: string
  name: string
  category: string
  severity: Severity
  target_types: string[]
  detection_methods: Detection[]
  version: number
  origin: string
}

export type Catalogue = {
  items: TestSummary[]
  total: number
  page: number
  page_size: number
  facets: Record<string, Record<string, number>>
}

export type CoverageRow = { category: string; name: string; in_scope: boolean; tests: number }

export type Version = {
  version: number
  is_current: boolean
  retired: boolean
  change_note: string
  created_at: string
}

/** One row of the success-condition builder, e.g. tool_called_without_confirmation + "issue_refund". */
export type SuccessRule = { check: string; value: string }

export type TestDetail = TestSummary & {
  category_name: string
  is_current: boolean
  objective: string
  prerequisites: string
  success_condition: string
  attempt_template: string
  recommended_mitigation: string
  atlas: string[]
  retired: boolean
  success_rules: (SuccessRule & { method: string; sentence: string })[]
  versions: Version[]
  suites: SuiteRef[] // the active suites that include the test (UC-4.3 step 2)
}

export type SuiteRef = { code: string; name: string; version: number; origin: string }

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"]

export const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Informational",
}

export const TARGET_TYPE_LABEL: Record<string, string> = {
  chatbot: "Chatbot",
  rag_application: "RAG application",
  tool_using_agent: "Tool-using agent",
}

export const DETECTION_LABEL: Record<string, string> = {
  canary_token: "Canary token",
  rule_matching: "Rule matching",
  tool_call_inspection: "Tool-call inspection",
  llm_judge: "LLM judge",
}

export const ORIGIN_LABEL: Record<string, string> = {
  built_in: "Built-in",
  custom: "Custom",
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export const DETECTION_ROLE_LABEL: Record<string, string> = {
  decisive: "Decisive",
  supporting: "Supporting",
  optional: "Optional",
}

/** The eight OWASP categories in Sentra's scope (LLM03 and LLM09 are not). */
export const CATEGORIES: { value: string; label: string }[] = [
  ["LLM01", "Prompt Injection"],
  ["LLM02", "Sensitive Information Disclosure"],
  ["LLM04", "Data and Model Poisoning"],
  ["LLM05", "Improper Output Handling"],
  ["LLM06", "Excessive Agency"],
  ["LLM07", "System Prompt Leakage"],
  ["LLM08", "Vector and Embedding Weaknesses"],
  ["LLM10", "Unbounded Consumption"],
].map(([value, name]) => ({ value, label: `${value} ${name}` }))

// ---------------------------------------------------------------- custom tests (FR-4.3)

/** A test definition as the editor works with it (Screen 31); the same fields as a file. */
export type Definition = {
  name: string
  category: string
  severity: string
  objective: string
  prerequisites: string
  target_types: string[]
  success_condition: string
  detection_methods: Detection[]
  success_rules: SuccessRule[]
  attempt_template: string
  recommended_mitigation: string
  atlas: string[]
}

export type Template = {
  name: string
  label: string
  category: string
  category_name: string
  target_types: string[]
  used_by_code: string
  used_by_name: string
}

/** A check of the builder. `value` says what the user fills in: "", "text", "tool", "number", "statement". */
export type RuleCheck = { check: string; method: string; sentence: string; value: string }

export type Vocabulary = { templates: Template[]; rule_checks: RuleCheck[] }

export type RuleResult = { id: string; label: string; ok: boolean; message: string; field: string }

export type CheckResult = {
  valid: boolean
  definition: Record<string, unknown>
  file: string
  errors: { field: string; message: string }[]
  rules: RuleResult[]
}

export type Source = { definition: Definition } | { file: string }

export const emptyDefinition = (): Definition => ({
  name: "",
  category: "",
  severity: "",
  objective: "",
  prerequisites: "",
  target_types: [],
  success_condition: "",
  detection_methods: [],
  success_rules: [],
  attempt_template: "",
  recommended_mitigation: "",
  atlas: [],
})

const text = (value: unknown) => (typeof value === "string" ? value : "")
const list = (value: unknown) => (Array.isArray(value) ? value : [])

/** Any definition (from the API or a file) in the editor's shape. */
export function toDefinition(data: Record<string, unknown>): Definition {
  return {
    name: text(data.name),
    category: text(data.category),
    severity: text(data.severity),
    objective: text(data.objective),
    prerequisites: text(data.prerequisites),
    target_types: list(data.target_types).filter((t) => typeof t === "string"),
    success_condition: text(data.success_condition),
    detection_methods: list(data.detection_methods)
      .filter((d) => d && typeof d === "object")
      .map((d) => ({ method: text(d.method), role: text(d.role) })),
    success_rules: list(data.success_rules)
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ check: text(r.check), value: text(r.value) })),
    attempt_template: text(data.attempt_template),
    recommended_mitigation: text(data.recommended_mitigation),
    atlas: list(data.atlas).filter((a) => typeof a === "string"),
  }
}

/** The sentence of a rule, with "…" where the value is still missing. */
export function sentenceOf(rule: SuccessRule, checks: RuleCheck[]): string {
  const sentence = checks.find((c) => c.check === rule.check)?.sentence ?? ""
  return sentence.replace("{value}", rule.value.trim() || "…")
}

/** The success condition in words, written from the rules. */
export function conditionFrom(rules: SuccessRule[], checks: RuleCheck[]): string {
  return rules
    .filter((rule) => rule.check)
    .map((rule) => `${sentenceOf(rule, checks)}.`)
    .join(" ")
}

const path = (code: string) => `/v1/test-definitions/${encodeURIComponent(code)}`
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) })

export const getTest = (code: string) => apiFetch<TestDetail>(path(code))
export const getVocabulary = () => apiFetch<Vocabulary>("/v1/test-definitions/vocabulary")
export const checkDefinition = (source: Source) =>
  apiFetch<CheckResult>("/v1/test-definitions/validate", post(source))
export const createCustomTest = (source: Source) => apiFetch<TestDetail>("/v1/test-definitions", post(source))
export const saveVersion = (code: string, source: Source, reason: string) =>
  apiFetch<TestDetail>(`${path(code)}/versions`, post({ ...source, reason }))
export const retireTest = (code: string, reason: string) =>
  apiFetch<TestDetail>(`${path(code)}/retire`, post({ reason }))

// ---------------------------------------------------------------- test suites (FR-4.4)

/** What a suite's tests cover and the attempts one run needs (UC-4.4 step 4). */
export type SuiteSummary = {
  test_count: number
  categories: string[]
  target_types: string[]
  estimated_attempts: number
  warnings: string[]
}

export type SuiteItem = SuiteSummary & { code: string; version: number; origin: string; name: string; purpose: string }

export type SuiteTest = {
  code: string
  found: boolean
  name: string
  category: string
  severity: Severity
  target_types: string[]
  version: number
  origin: string
  retired: boolean
}

export type SuiteVersion = { version: number; is_current: boolean; status: string; change_note: string; created_at: string }

export type SuiteDetail = SuiteItem & {
  is_current: boolean
  status: string
  test_codes: string[]
  tests: SuiteTest[]
  versions: SuiteVersion[]
}

export type SuiteInput = { name: string; purpose: string; tests: string[] }

const suitePath = (code: string) => `/v1/test-suites/${encodeURIComponent(code)}`

export const listSuites = () => apiFetch<SuiteItem[]>("/v1/test-suites")
export const getSuite = (code: string, version?: number) =>
  apiFetch<SuiteDetail>(version ? `${suitePath(code)}/versions/${version}` : suitePath(code))
export const suiteSummary = (tests: string[]) => apiFetch<SuiteSummary>("/v1/test-suites/summary", post({ tests }))
export const createSuite = (input: SuiteInput) => apiFetch<SuiteDetail>("/v1/test-suites", post(input))
export const saveSuiteVersion = (code: string, input: SuiteInput, reason: string) =>
  apiFetch<SuiteDetail>(`${suitePath(code)}/versions`, post({ ...input, reason }))
export const archiveSuite = (code: string, reason: string) =>
  apiFetch<SuiteDetail>(`${suitePath(code)}/archive`, post({ reason }))

/** "about 540": estimates are rounded so they don't look exact. */
export function aboutAttempts(count: number): string {
  return count ? `about ${count.toLocaleString("en-US")}` : "none"
}

/** Every test the organization can add to a suite: built-in and its own, without retired ones. */
export async function listAllTests(): Promise<TestSummary[]> {
  const items: TestSummary[] = []
  for (let page = 1; ; page++) {
    const result = await apiFetch<Catalogue>(`/v1/test-definitions?page=${page}&page_size=100`)
    items.push(...result.items)
    if (items.length >= result.total || result.items.length === 0) return items
  }
}
