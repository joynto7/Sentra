import type { Severity } from "@/components/sentra/severity-badge"
import { apiFetch } from "@/lib/api"
import type { FindingStatus } from "@/lib/findings"

/** The band of a risk score: the highest severity among the findings it counts (FR-7.2). */
export type RiskBand = "critical" | "high" | "medium" | "low" | "none"

export type SeverityCounts = Record<Severity, number>

/** Why a target has no risk score: it was never tested, or it isn't verified (UC-7.2). */
export type NotScoredReason = "" | "no_campaign_run" | "ownership_not_verified"

export type TargetRiskRow = {
  id: string
  name: string
  type: string
  environment: string
  target_status: string
  owner: string
  score: number | null
  band: RiskBand | null
  calculated_at: string | null
  last_run_at: string | null
  open_total: number
  open_by_severity: SeverityCounts
  awaiting_confirmation: number
  not_scored_reason: NotScoredReason
}

export type ScoreHistoryItem = {
  score: number
  band: RiskBand
  trigger: string
  calculated_at: string
  counted: number
}

export type TargetRisk = {
  target: { id: string; name: string; target_status: string }
  score: number | null
  band: RiskBand | null
  calculated_at: string | null
  trigger: string | null
  last_run_at: string | null
  counted: number
  counted_by_severity: SeverityCounts
  counted_codes: string[]
  factors: Record<string, unknown>
  awaiting_confirmation: number
  open_total: number
  open_by_severity: SeverityCounts
  not_scored_reason: NotScoredReason
  history: ScoreHistoryItem[]
}

/** One row of "Critical and high findings" (Screen 42), the most serious open finding first. */
export type TopFinding = {
  code: string
  title: string
  severity: Severity
  status: FindingStatus
  target: { id: string; name: string }
  reproducibility: string | null // None until FR-7.1 has rated the finding
  provisional: boolean
  last_seen_at: string
}

export type RiskDashboard = {
  period_days: number
  last_run_at: string | null
  open_by_severity: SeverityCounts
  open_total: number
  awaiting_triage: number
  awaiting_remediation: number
  fixed_and_verified: number
  by_status: Record<string, number>
  targets: TargetRiskRow[]
  top_findings: { total: number; items: TopFinding[] }
  /** FR-7.4: the trends of the period and the OWASP categories (Screen 42). */
  by_category: CategoryRow[]
  trends: Trends
  category: string | null
  /** True while a category is chosen: the finding counts follow it, the risk scores don't. */
  category_filtered: boolean
}

export const BAND_LABEL: Record<RiskBand, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No counted findings",
}

/** The severities the counts show, the most serious first. */
export const COUNTED: Severity[] = ["critical", "high", "medium", "low"]

/** What the pages say instead of a score (Screens 16, 20 and 42). */
export function notScoredText(reason: NotScoredReason): string {
  if (reason === "ownership_not_verified") return "Not scored — ownership not verified yet"
  return "Not scored — no campaign run yet"
}

/** FR-7.1 with its factors (NFR-4.2): why a finding has the severity it has (Screen 39). */
export type FindingSeverity = {
  code: string
  severity: Severity
  calculated_severity: Severity | null
  adjusted: boolean
  provisional: boolean
  rated_at: string | null
  reproducibility: string | null
  test_severity: Severity | null
  factors: {
    impact?: { level: number; label: string; consequence: string; component: string; sentence: string }
    exploitability?: { level: number; tries: number; needs_credentials: boolean; sentences: string[] }
    reproducibility?: { value: string; successes: number; attempts: number; repetitions: number; sentence: string }
    likelihood?: { level: number }
    severity?: string
    provisional?: boolean
  }
}

export const getFindingSeverity = (code: string, signal?: AbortSignal) =>
  apiFetch<FindingSeverity>(`/v1/findings/${encodeURIComponent(code)}/severity`, { signal })

/** UC-7.3: the dashboard for the chosen target and period (Screen 42). */
export function getRiskDashboard(params?: URLSearchParams, signal?: AbortSignal) {
  const query = params?.toString()
  return apiFetch<RiskDashboard>(`/v1/risk/dashboard${query ? `?${query}` : ""}`, { signal })
}

export function getTargetRisk(targetId: string, signal?: AbortSignal) {
  return apiFetch<TargetRisk>(`/v1/targets/${targetId}/risk`, { signal })
}

/** The period filter of the risk dashboard (UC-7.3 step 4). */
export const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 12 months" },
]

/** The statuses of the finding lifecycle, as "Findings by status" groups them (Screen 42). */
export const OPEN_STATUSES = ["new", "requires_confirmation", "confirmed", "reopened"] as const
export const CLOSED_STATUSES = ["fixed_and_verified", "false_positive", "merged"] as const

/**
 * The rules behind a severity and a score, from the code itself: the dialog "How is the risk score
 * calculated?" shows them, so no page repeats them (FR-7.1, FR-7.2; NFR-4.2).
 */
export type RiskMethod = {
  severity: {
    impact: { level: number; label: string; consequence: string; sentence: string }[]
    exploitability: { level: number; sentence: string }[]
    reproducibility: { from: string; changes: number }[]
    matrix: { impact: number; likelihood: Severity[] }[]
  }
  bands: { band: RiskBand; severity: Severity; from: number; to: number }[]
}

export const getRiskMethod = (signal?: AbortSignal) => apiFetch<RiskMethod>("/v1/risk/method", { signal })

// ---------------------------------------------------------------- trends (FR-7.4, UC-7.3 step 5)

export type TrendBucket = { starts_at: string; ends_at: string; new: number; closed: number }

export type ScorePoint = {
  at: string
  score: number
  band: RiskBand
  trigger: string
  /** The last calculation before the period: where the line starts. */
  before_period: boolean
}

export type ScoreSeries = {
  target: { id: string; name: string }
  score: number | null
  band: RiskBand | null
  points: ScorePoint[]
}

export type Trends = {
  buckets: TrendBucket[]
  scores: ScoreSeries[]
  /** New minus closed: below zero means fewer open findings than at the start of the period. */
  net_change: number
  category: string | null
}

// ------------------------------------------------- framework coverage (FR-7.4, UC-7.4; Screen 43)

/** What a cell of the coverage matrix says, in the order an analyst must see them. */
export type CoverageStatus = "gap" | "stale" | "tested" | "not_applicable" | "not_testable" | "out_of_scope"

/** The symbol beside the status, which never stands on its own (NFR-4.3). */
export const COVERAGE_SYMBOL: Record<CoverageStatus, string> = {
  tested: "✓",
  stale: "⚠",
  gap: "⚠",
  not_applicable: "—",
  not_testable: "—",
  out_of_scope: "⊘",
}

export type CategoryRow = {
  code: string
  name: string | null
  in_scope: boolean
  status: CoverageStatus
  label: string
  reason: string
  worst_target: string | null
  open_total: number
  open_by_severity: SeverityCounts
}

export type CoverageCell = {
  target_id: string
  target_name: string
  status: CoverageStatus
  label: string
  reason: string
  run: { code: string; ended_at: string } | null
  changed_at: string
  open_findings: number
  open_by_severity: SeverityCounts
}

export type CoverageRow = CategoryRow & { cells: CoverageCell[] }

export type Coverage = {
  framework: "owasp" | "atlas"
  targets: { id: string; name: string; type: string; environment: string; target_status: string }[]
  rows: CoverageRow[]
  by_status: Record<string, number>
  legend: { status: CoverageStatus; label: string }[]
}

export type CoverageDetail = {
  framework: "owasp" | "atlas"
  code: string
  name: string | null
  in_scope: boolean
  target: { id: string; name: string; type: string }
  cell: CoverageCell
  threat_model_version: number | null
  threats: { number: number; title: string; component: string; risk: number }[]
  accepted_gap: { threat: number; reason: string; accepted_at: string } | null
  /** The suites that cover this category for this target; empty is UC-7.4, 5a1. */
  suites: { code: string; name: string; tests: number; covering: number }[]
}

export function getCoverage(params: URLSearchParams, signal?: AbortSignal) {
  return apiFetch<Coverage>(`/v1/risk/coverage?${params}`, { signal })
}

export function getCoverageCell(code: string, params: URLSearchParams, signal?: AbortSignal) {
  return apiFetch<CoverageDetail>(`/v1/risk/coverage/${encodeURIComponent(code)}?${params}`, { signal })
}

// ------------------------------------------------------- attack paths (FR-7.3, UC-7.5; Screen 44)

export type PathNode = {
  id: string
  kind: string
  name: string
  label: string
  /** Its place in the application's pipeline, which is the column it is drawn in. */
  stage: number
  note: string
  in_profile: boolean
  entry: boolean
  impact: string
  findings: string[]
}

export type PathEdge = { from: string; to: string; why: string }

export type PathFinding = {
  code: string
  title: string
  severity: Severity
  status: FindingStatus
  category: string
  unconfirmed: boolean
  last_seen_at: string
  node_id: string
  component: { kind: string; name: string; label: string }
  in_profile: boolean
}

export type PathStep = {
  number: number
  sentence: string
  component: { kind: string; name: string; label: string }
  findings: PathFinding[]
}

export type AttackPath = {
  key: string
  code: string
  severity: Severity
  impact: string
  description: string
  has_unconfirmed: boolean
  node_ids: string[]
  finding_codes: string[]
  steps: PathStep[]
  reason?: string | null
  dismissed_by?: string | null
  dismissed_at?: string | null
}

export type AttackPaths = {
  target: { id: string; name: string; type: string; environment: string }
  blocker: { code: string; message: string } | null
  nodes: PathNode[]
  edges: PathEdge[]
  paths: AttackPath[]
  dismissed: AttackPath[]
  findings: PathFinding[]
  unconfirmed: number
  no_paths_reason: string
  profile_version: number | null
}

export const getAttackPaths = (targetId: string, signal?: AbortSignal) =>
  apiFetch<AttackPaths>(`/v1/targets/${targetId}/attack-paths`, { signal })

/** UC-7.5, 6a1: hide a path that an analyst considers implausible, with the reason. */
export const dismissAttackPath = (targetId: string, key: string, reason: string) =>
  apiFetch<AttackPaths>(`/v1/targets/${targetId}/attack-paths/${key}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })

export const restoreAttackPath = (targetId: string, key: string) =>
  apiFetch<AttackPaths>(`/v1/targets/${targetId}/attack-paths/${key}/dismiss`, { method: "DELETE" })
