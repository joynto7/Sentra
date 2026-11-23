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

/** What a finding's reproducibility is based on: the last measurement of UC-6.3 (FR-6.4). */
export type Repetitions = {
  attempts: number
  successes: number
  wanted: number
  status: "measuring" | "complete" | "incomplete"
  reason: string
  /** "4 of 5 attempts" */
  label: string
}

export type Person = { id: string; name: string }

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
  /** Who will fix it (FR-6.5) */
  owner: Person | null
  /** Successful attempts / attempts that tried this weakness (FR-6.4), once it is rated. */
  reproducibility: string | null
  repetitions: Repetitions | null
  first_run: { id: string; code: string }
  last_run: { id: string; code: string }
  first_seen_at: string
  last_seen_at: string
  /** Only when the list is asked for one campaign run (Screen 37) */
  in_run?: "new" | "seen_again" | "reopened" | null
}

/** Of one campaign run's findings: how many it found, saw again or reopened (Screen 37). */
export type InRunCounts = { new: number; seen_again: number; reopened: number }

export const IN_RUN_LABEL: Record<string, string> = {
  new: "New",
  seen_again: "Seen again",
  reopened: "Reopened",
}

export type FindingPage = {
  items: FindingItem[]
  total: number
  page: number
  page_size: number
  counts: Partial<Record<FindingView, number>>
  /** Screen 38's severity strip: the view and every filter but the severity, by severity */
  severity_counts?: Record<string, number>
  sort?: string
  direction?: "asc" | "desc"
  /** UC-6.4, 2a1: an AI Application Developer's own findings come first */
  mine_first?: boolean
  in_run_counts: InRunCounts | null
}

/** The quick views of Screen 38. */
export type FindingView =
  | "open"
  | "assigned"
  | "requires_confirmation"
  | "closed"
  // Not tabs: the Risk Dashboard opens these, so a total opens exactly the findings it counts
  | "all"
  | "awaiting_triage"
  | "awaiting_remediation"

export const VIEW_LABEL: Record<FindingView, string> = {
  open: "All open",
  assigned: "Assigned to me",
  requires_confirmation: "Requires confirmation",
  closed: "Closed",
  all: "Open and closed",
  awaiting_triage: "Awaiting triage",
  awaiting_remediation: "Awaiting remediation",
}

/** A part of a period, as the Risk Dashboard's numbers have it: first seen in it, or closed in it. */
export const PERIOD_FILTERS = ["first_seen_from", "first_seen_until", "closed_from", "closed_until"] as const
export type PeriodFilters = Partial<Record<(typeof PERIOD_FILTERS)[number], string>>

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
  /** The triage of FR-6.5 (UC-6.6) */
  confirmed_by: string | null
  confirmed_at: string | null
  assigned_at: string | null
  closed_by: string | null
  closed_at: string | null
  /** A false positive's reason (2a1), or which finding it was merged into */
  close_reason: string
  /** The finding it duplicates (2b1), e.g. F-012 */
  merged_into: string | null
  /** The duplicates merged into this one, whose evidence and history count as its own */
  merged_in: string[]
  calculated_severity: Severity | null
  severity_provisional: boolean
  /** UC-7.1, 4a: an analyst set it, so the rating never changes it again */
  severity_adjusted: boolean
  severity_justification: string
  test: FindingTest
  runs: FindingRun[]
  detection: FindingDetection | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------- triage (FR-6.5, FR-6.6)

export type HistoryKind =
  | "detected"
  | "reopened"
  | "confirmed"
  | "false_positive"
  | "severity_adjusted"
  | "assigned"
  | "commented"
  | "merged"
  | "merged_in"
  | "change_implemented"

export const HISTORY_LABEL: Record<HistoryKind, string> = {
  detected: "Detected",
  reopened: "Reopened as a regression",
  confirmed: "Confirmed",
  false_positive: "Marked a false positive",
  severity_adjusted: "Severity adjusted",
  assigned: "Assigned",
  commented: "Comment",
  merged: "Merged into another finding",
  merged_in: "A duplicate was merged in",
  change_implemented: "Application change implemented",
}

/** One entry of a finding's history (UC-6.6 step 5), append-only. */
export type HistoryItem = {
  number: number
  kind: HistoryKind
  /** Whose entry it is: a merged duplicate's history is shown with its own (FR-6.6) */
  finding: string
  actor: string
  by_sentra: boolean
  text: string
  was: string | null
  became: string | null
  run: string | null
  finding_related: string | null
  user: string | null
  at: string
}

export type Decision = "confirm" | "false_positive" | "merge"

export type TriageInput = {
  decision?: Decision | null
  reason?: string
  merge_into?: string
  severity?: Severity | null
  justification?: string
  owner_id?: string | null
  comment?: string
}

export type TriageOptions = {
  code: string
  title: string
  status: FindingStatus
  /** Only an open finding can be triaged (UC-6.6 precondition) */
  open: boolean
  /** NFR-9.3: only the LLM judge supports it, so it counts after a confirmation */
  requires_confirmation: boolean
  severity: Severity
  calculated_severity: Severity | null
  severity_provisional: boolean
  severity_adjusted: boolean
  severity_justification: string
  owner: Person | null
  /** Whoever registered the target, as the suggestion of UC-6.6 step 4 */
  suggested_owner: (Person & { reason: string }) | null
  members: (Person & { role: string })[]
  duplicates: { code: string; title: string; severity: Severity; status: FindingStatus }[]
}

export const DECISION_LABEL: Record<Decision, string> = {
  confirm: "Confirm finding",
  false_positive: "False positive",
  merge: "Duplicate — merge into another finding",
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
  /** Whoever owns a finding of this organization (FR-6.5) */
  owners: Person[]
}

/** UC-6.4: the organization's findings, the most severe first. */
export const listFindings = (params: URLSearchParams, signal?: AbortSignal) =>
  apiFetch<FindingPage>(`/v1/findings?${params}`, { signal })

export const findingFilterOptions = (signal?: AbortSignal) =>
  apiFetch<FindingFilters>("/v1/findings/filter-options", { signal })

/** FR-6.5: the finding's history, oldest first, with that of every duplicate merged into it. */
export const getHistory = (code: string, signal?: AbortSignal) =>
  apiFetch<HistoryItem[]>(`/v1/findings/${encodeURIComponent(code)}/history`, { signal })

/** What Screen 41 needs: the calculated severity, who it can go to, and the target's open findings. */
export const getTriageOptions = (code: string, signal?: AbortSignal) =>
  apiFetch<TriageOptions>(`/v1/findings/${encodeURIComponent(code)}/triage`, { signal })

/** UC-6.6: the decision, the severity, the owner and the comment in one save. */
export const saveTriage = (code: string, input: TriageInput) =>
  apiFetch<FindingDetail>(`/v1/findings/${encodeURIComponent(code)}/triage`, {
    method: "POST",
    body: JSON.stringify(input),
  })

/** UC-6.5 steps 1-3: one finding with its test, its runs and how it was detected. */
export const getFinding = (code: string, signal?: AbortSignal) =>
  apiFetch<FindingDetail>(`/v1/findings/${encodeURIComponent(code)}`, { signal })

/** FR-6.3: the evidence records of a finding, in the order they were recorded. */
export const listEvidence = (code: string, signal?: AbortSignal) =>
  apiFetch<EvidenceItem[]>(`/v1/findings/${encodeURIComponent(code)}/evidence`, { signal })

/** UC-6.5 steps 4-5: one evidence document, read-only, with its integrity check. */
export const getEvidence = (code: string, number: number, signal?: AbortSignal) =>
  apiFetch<EvidenceDetail>(`/v1/findings/${encodeURIComponent(code)}/evidence/${number}`, { signal })
