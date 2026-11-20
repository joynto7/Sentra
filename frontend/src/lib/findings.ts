import type { Severity } from "@/components/sentra/severity-badge"
import { apiFetch } from "@/lib/api"

/** The lifecycle of a finding (FR-6.2, report Figure 2.6). */
export type FindingStatus =
  | "new"
  | "requires_confirmation"
  | "confirmed"
  | "false_positive"
  | "merged"
  | "fixed_and_verified"
  | "reopened"

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  new: "New",
  requires_confirmation: "Requires confirmation",
  confirmed: "Confirmed",
  false_positive: "False positive",
  merged: "Merged",
  fixed_and_verified: "Fixed and verified",
  reopened: "Reopened",
}

export type FindingItem = {
  code: string
  title: string
  severity: Severity
  status: FindingStatus
  category: string
  category_name: string
  target: { id: string; name: string }
  component: { kind: string; name: string; label: string }
  evidence_count: number
  /** Successful attempts / attempts that tried this weakness (FR-6.4), once it is rated. */
  reproducibility: string | null
  first_run: { id: string; code: string }
  last_run: { id: string; code: string }
  first_seen_at: string
  last_seen_at: string
}

export type FindingPage = {
  items: FindingItem[]
  total: number
  page: number
  page_size: number
  counts: { open: number; requires_confirmation: number; closed: number }
}

/** The quick views of Screen 38; "Assigned to me" comes with the triage of FR-6.5. */
export type FindingView = "open" | "requires_confirmation" | "closed"

export const VIEW_LABEL: Record<FindingView, string> = {
  open: "All open",
  requires_confirmation: "Requires confirmation",
  closed: "Closed",
}

/** The version of the test that found it: what it checks, and how to fix what it finds. */
export type FindingTest = {
  code: string
  version: number
  name: string
  objective: string
  success_condition: string
  recommended_mitigation: string
}

export type FindingRun = {
  id: string
  code: string
  attempts: number
  first_seen_at: string
  /** It was found in this run (UC-6.2 step 2); in a later one it was seen again (2a). */
  new: boolean
}

export type DetectionMethodResult = {
  method: string
  method_label: string
  role: string
  outcome: string
  confidence: string | null
}

export type FindingDetection = {
  attempt_no: number
  run: { id: string; code: string }
  outcome: string
  decided_by: string | null
  /** NFR-9.3: only the LLM judge supported it, so an analyst has to confirm it. */
  requires_confirmation: boolean
  disagreement: boolean
  summary: string
  methods: DetectionMethodResult[]
}

export type FindingDetail = FindingItem & {
  description: string
  atlas: string[]
  test: FindingTest
  runs: FindingRun[]
  detection: FindingDetection | null
  created_at: string
  updated_at: string
}

export type EvidenceItem = {
  number: number
  /** "attempt", or "judge_verdict": the LLM judge's later answer to the same attempt. */
  kind: string
  attempt_no: number
  run: { id: string; code: string }
  recorded_at: string
  checksum: string
  size: number
  stored_in: string
}

/** NFR-2.4: whether what is stored is exactly what was recorded. */
export type Integrity = { status: "unchanged" | "modified" | "missing"; checksum: string; computed: string | null }

export type EvidenceDetail = EvidenceItem & {
  integrity: Integrity
  /** The masked document; the target's own text is plain text only (NFR-3.6). */
  content: EvidenceDocument | null
}

export type EvidenceCheck = {
  check: string
  value: string
  sentence: string
  result: string
  detail: string
  slot?: string
  tool?: string
}

export type EvidenceResult = {
  method: string
  role: string
  outcome: string
  summary: string
  checks: EvidenceCheck[]
  duration_ms: number | null
  evaluated_at: string | null
  confidence?: string | null
  reasoning?: string | null
  model?: string | null
  deployment?: string | null
  instructions_version?: string | null
  tries?: number
}

export type EvidenceDocument = {
  format: string
  kind: string
  recorded_at: string
  finding: string
  campaign_run: string
  test: { code: string; version: number; name: string; success_condition?: string }
  attempt: {
    number: number
    template?: string
    variant?: number
    conversation?: string
    sent_at?: string | null
    message?: string
  }
  reply?: {
    received_at: string | null
    status_code: number | null
    duration_ms: number | null
    text: string
    length: number | null
    truncated: boolean
  }
  tool_calls?: unknown
  detection: {
    verdict: {
      outcome: string
      decided_by: string | null
      requires_confirmation: boolean
      disagreement: boolean
      summary: string
    }
    results: EvidenceResult[]
  }
}

export type FindingFilters = {
  targets: { id: string; name: string }[]
  runs: { id: string; code: string }[]
  categories: { code: string; name: string }[]
}

/** UC-6.4: the organization's findings, the most severe first. */
export const listFindings = (params: URLSearchParams, signal?: AbortSignal) =>
  apiFetch<FindingPage>(`/v1/findings?${params}`, { signal })

export const findingFilterOptions = (signal?: AbortSignal) =>
  apiFetch<FindingFilters>("/v1/findings/filter-options", { signal })

/** UC-6.5 steps 1-3: one finding with its test, its runs and how it was detected. */
export const getFinding = (code: string, signal?: AbortSignal) =>
  apiFetch<FindingDetail>(`/v1/findings/${encodeURIComponent(code)}`, { signal })

/** FR-6.3: the evidence records of a finding, in the order they were recorded. */
export const listEvidence = (code: string, signal?: AbortSignal) =>
  apiFetch<EvidenceItem[]>(`/v1/findings/${encodeURIComponent(code)}/evidence`, { signal })

/** UC-6.5 steps 4-5: one evidence document, read-only, with its integrity check. */
export const getEvidence = (code: string, number: number, signal?: AbortSignal) =>
  apiFetch<EvidenceDetail>(`/v1/findings/${encodeURIComponent(code)}/evidence/${number}`, { signal })
