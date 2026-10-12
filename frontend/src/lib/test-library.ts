import type { Severity } from "@/components/sentra/severity-badge"

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

export type Version = { version: number; is_current: boolean; change_note: string; created_at: string }

export type TestDetail = TestSummary & {
  category_name: string
  is_current: boolean
  objective: string
  prerequisites: string
  success_condition: string
  attempt_template: string
  recommended_mitigation: string
  atlas: string[]
  versions: Version[]
}

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
