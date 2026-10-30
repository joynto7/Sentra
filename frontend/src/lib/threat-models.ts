import { apiFetch } from "@/lib/api"
import type { TargetType } from "@/lib/targets"

/** Threat models (Module 3): API calls and shared labels for Screens 25-28. */

export type ComponentKind = "model" | "system_prompt" | "knowledge_source" | "tool" | "output"
export type ThreatSource = "baseline" | "ai_suggested" | "analyst"
export type JobStatus = "queued" | "running" | "done" | "failed"

export type FrameworkRef = { code: string; name: string | null; in_scope: boolean }

export type ThreatComponent = { kind: ComponentKind; name: string; note: string; threats: number }

export type Threat = {
  number: number
  title: string
  component_kind: ComponentKind
  component_name: string
  owasp: FrameworkRef[]
  atlas: FrameworkRef | null
  likelihood: number
  impact: number
  risk: number
  source: ThreatSource
  rationale: string | null
  rated_by: string | null
  edited_by: string | null
  change_reason: string | null
  removed: boolean
  removal_reason: string | null
}

export type VersionSummary = {
  version: number
  status: "draft" | "approved"
  origin: "generated" | "edited" | "restored"
  ai_generated: boolean
  created_at: string
  created_by: string | null
  approved_at: string | null
  approved_by: string | null
  threat_count: number
  runs: number
}

export type VersionDetail = VersionSummary & {
  based_on_version: number | null
  profile_version: number | null
  trigger: "profile_review" | "requested" | null
  model: string | null
  suggested: number
  dropped: number
  baseline_only: string | null
  components: ThreatComponent[]
  threats: Threat[]
}

export type GenerationJob = {
  id: string
  status: JobStatus
  trigger: "profile_review" | "requested"
  requested_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  version: number | null
  message: string | null
}

export type ModelTarget = {
  id: string
  name: string
  type: TargetType
  environment: "staging" | "production"
  host: string
  status: "unverified" | "verified" | "archived"
}

export type ThreatModelPage = {
  target: ModelTarget
  blocker: string | null
  blocker_code: "not_verified" | "profile_not_reviewed" | "target_archived" | null
  job: GenerationJob | null
  versions: VersionSummary[]
  current: VersionDetail | null
}

export type ThreatModelRow = {
  target: ModelTarget
  profile_reviewed: boolean
  latest: VersionSummary | null
  approved: VersionSummary | null
  job: GenerationJob | null
  blocker: string | null
  blocker_code: ThreatModelPage["blocker_code"]
  without_test: number | null
}

export type ThreatModelList = {
  rows: ThreatModelRow[]
  drafts_to_review: number
  approved: number
  without_threat_model: number
}

/** A threat as the analyst left it (UC-3.2 step 3); only what differs is a change. */
export type ThreatEdit = {
  number: number
  title: string
  owasp: string[]
  atlas: string | null
  likelihood: number
  impact: number
  reason: string
}

export type ThreatNew = {
  title: string
  component_kind: ComponentKind
  component_name: string
  owasp: string[]
  atlas: string | null
  likelihood: number
  impact: number
  reason: string
}

export type VersionInput = {
  base_version: number
  edit: ThreatEdit[]
  add: ThreatNew[]
  remove: { number: number; reason: string }[]
  restore: number[]
}

export type ComparedThreat = {
  number: number
  title: string
  component_name: string
  owasp: string[]
  atlas: string | null
  likelihood: number
  impact: number
  reason: string | null
}

export type VersionComparison = {
  base: VersionSummary
  compare: VersionSummary
  added: ComparedThreat[]
  removed: ComparedThreat[]
  changed: {
    number: number
    title: string
    component_name: string
    changes: { field: string; before: string; after: string }[]
    reason: string | null
  }[]
  identical: boolean
  base_runs: RunRef[]
  compare_runs: RunRef[]
}

/** A campaign run that used a version (Screen 28). Empty until FR-5.4 (M5) records them. */
export type RunRef = { id: string; code: string; started_at: string | null }

/** A threat a test suite addresses (Screen 27). */
export type ThreatRef = { number: number; title: string; risk: number }

export type SuiteRecommendation = {
  code: string
  name: string
  purpose: string
  version: number
  origin: "built_in" | "custom"
  /** Tests of the suite that apply to this target's type */
  tests: number
  attempts: number
  threats: ThreatRef[]
  top_risk: number
  /** It addresses at least one threat of the approved version */
  recommended: boolean
  /** In the saved selection, or else in Sentra's proposal */
  selected: boolean
}

export type GapAcceptance = {
  reason: string
  accepted_by: string | null
  accepted_at: string
  version: number
}

/** A threat that no available test covers (UC-3.3 step 3). */
export type ThreatGap = {
  number: number
  title: string
  component_name: string
  owasp: FrameworkRef[]
  risk: number
  /** Only LLM03 or LLM09, which lie outside application testing */
  out_of_scope: boolean
  accepted: GapAcceptance | null
}

export type SuiteSelection = {
  version: number
  suites: string[]
  uncovered: number[]
  saved_by: string | null
  saved_at: string
  /** Saved for the version that is approved now */
  current: boolean
}

export type Recommendations = {
  target: ModelTarget
  version: VersionSummary
  threats_total: number
  threats_covered: number
  suites: SuiteRecommendation[]
  gaps: ThreatGap[]
  selection: SuiteSelection | null
}

const base = "/v1/threat-models"
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const listThreatModels = (signal?: AbortSignal) => apiFetch<ThreatModelList>(base, { signal })
export const getThreatModel = (targetId: string, version?: number | null, signal?: AbortSignal) =>
  apiFetch<ThreatModelPage>(`${base}/${targetId}${version ? `?version=${version}` : ""}`, { signal })
export const generateThreatModel = (targetId: string) =>
  apiFetch<GenerationJob>(`${base}/${targetId}/generate`, post())
export const saveThreatModelVersion = (targetId: string, input: VersionInput) =>
  apiFetch<ThreatModelPage>(`${base}/${targetId}/versions`, post(input))
export const approveThreatModel = (targetId: string, version: number) =>
  apiFetch<ThreatModelPage>(`${base}/${targetId}/versions/${version}/approve`, post())
export const compareVersions = (targetId: string, from: number, to: number, signal?: AbortSignal) =>
  apiFetch<VersionComparison>(`${base}/${targetId}/compare?base=${from}&compare=${to}`, { signal })
/** UC-3.4, 3a: an earlier version becomes the next draft, which someone approves again. */
export const restoreThreatModelVersion = (targetId: string, version: number) =>
  apiFetch<ThreatModelPage>(`${base}/${targetId}/versions/${version}/restore`, post())
export const getRecommendations = (targetId: string, signal?: AbortSignal) =>
  apiFetch<Recommendations>(`${base}/${targetId}/recommendations`, { signal })
/** UC-3.3 steps 5-6: the suites that new campaigns of this target start with. */
export const saveSuiteSelection = (targetId: string, version: number, suites: string[]) =>
  apiFetch<Recommendations>(`${base}/${targetId}/selection`, {
    method: "PUT",
    body: JSON.stringify({ version, suites }),
  })
/** UC-3.3, 3a1: why a threat that no test covers is accepted for now. */
export const acceptThreatGap = (targetId: string, version: number, threat: number, reason: string) =>
  apiFetch<Recommendations>(`${base}/${targetId}/gaps`, post({ version, threat, reason }))

/** The OWASP Top 10 for LLM Applications (2025). Threats may name all ten (FR-3.2); no test of
 * the library covers LLM03 and LLM09, which lie outside application testing. */
export const OWASP_CATEGORIES: { code: string; name: string; inScope: boolean }[] = [
  { code: "LLM01", name: "Prompt Injection", inScope: true },
  { code: "LLM02", name: "Sensitive Information Disclosure", inScope: true },
  { code: "LLM03", name: "Supply Chain", inScope: false },
  { code: "LLM04", name: "Data and Model Poisoning", inScope: true },
  { code: "LLM05", name: "Improper Output Handling", inScope: true },
  { code: "LLM06", name: "Excessive Agency", inScope: true },
  { code: "LLM07", name: "System Prompt Leakage", inScope: true },
  { code: "LLM08", name: "Vector and Embedding Weaknesses", inScope: true },
  { code: "LLM09", name: "Misinformation", inScope: false },
  { code: "LLM10", name: "Unbounded Consumption", inScope: true },
]

/** The MITRE ATLAS techniques Sentra names (the same list as the API's frameworks.py). Any other
 * well-formed technique ID can be typed in. */
export const ATLAS_TECHNIQUES: { code: string; name: string }[] = [
  { code: "AML.T0029", name: "Denial of AI Service" },
  { code: "AML.T0034", name: "Cost Harvesting" },
  { code: "AML.T0051", name: "LLM Prompt Injection" },
  { code: "AML.T0051.000", name: "LLM Prompt Injection: Direct" },
  { code: "AML.T0051.001", name: "LLM Prompt Injection: Indirect" },
  { code: "AML.T0053", name: "AI Agent Tool Invocation" },
  { code: "AML.T0054", name: "LLM Jailbreak" },
  { code: "AML.T0056", name: "Extract LLM System Prompt" },
  { code: "AML.T0057", name: "LLM Data Leakage" },
  { code: "AML.T0070", name: "RAG Poisoning" },
]
export const ATLAS_PATTERN = /^AML\.T\d{4}(\.\d{3})?$/

export const KIND_LABEL: Record<ComponentKind, string> = {
  model: "Model",
  system_prompt: "System prompt",
  knowledge_source: "Knowledge source",
  tool: "Tool",
  output: "Output",
}
export const KIND_GROUP: Record<ComponentKind, string> = {
  model: "Model",
  system_prompt: "System prompt",
  knowledge_source: "Knowledge sources",
  tool: "Tools",
  output: "Outputs",
}
export const KIND_ORDER: ComponentKind[] = ["model", "system_prompt", "knowledge_source", "tool", "output"]

export const SOURCE_LABEL: Record<ThreatSource, string> = {
  baseline: "Baseline rule",
  ai_suggested: "AI-suggested",
  analyst: "Added by a person",
}

export const RATINGS = [1, 2, 3, 4, 5]
export const RATING_LABEL: Record<number, string> = {
  1: "1 · very low",
  2: "2 · low",
  3: "3 · medium",
  4: "4 · high",
  5: "5 · very high",
}

/** "the RAG application" in "Threat model for the RAG application at …". */
export const TYPE_PHRASE: Record<TargetType, string> = {
  chatbot: "the chatbot",
  rag_application: "the RAG application",
  tool_using_agent: "the tool-using agent",
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })

/** "3 Oct 2026" */
export const longDate = (iso: string) => DAY.format(new Date(iso))
/** "3 Oct" in the current year, else "3 Oct 2025" */
export const shortDate = (iso: string) => {
  const date = new Date(iso)
  return date.getFullYear() === new Date().getFullYear() ? SHORT.format(date) : DAY.format(date)
}

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The job the page waits for: queued or running. */
export const jobActive = (job: GenerationJob | null | undefined) =>
  Boolean(job && (job.status === "queued" || job.status === "running"))
