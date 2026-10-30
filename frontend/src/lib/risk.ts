import type { Severity } from "@/components/sentra/severity-badge"
import { apiFetch } from "@/lib/api"

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

export function getRiskDashboard(params?: URLSearchParams, signal?: AbortSignal) {
  const query = params?.toString()
  return apiFetch<RiskDashboard>(`/v1/risk/dashboard${query ? `?${query}` : ""}`, { signal })
}

export function getTargetRisk(targetId: string, signal?: AbortSignal) {
  return apiFetch<TargetRisk>(`/v1/targets/${targetId}/risk`, { signal })
}
