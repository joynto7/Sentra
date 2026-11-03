import { apiFetch } from "@/lib/api"
import type { Severity } from "@/components/sentra/severity-badge"
import type { Environment } from "@/lib/targets"

/** Whether the pipeline may start this gate at all (UC-9.4). */
export type GateStatus = "active" | "paused"

/**
 * What one call of the gate decided (UC-9.5). `error` is a failure for the pipeline: the gate
 * never says "pass" without a completed run (quality requirement 2).
 */
export type GateVerdict = "running" | "passed" | "failed" | "error"

export const VERDICT_LABEL: Record<GateVerdict, string> = {
  running: "Running",
  passed: "Pass",
  failed: "Fail",
  error: "Not checked",
}

/** The sentence under each verdict, so the result is readable as text and not as a colour. */
export const VERDICT_MEANING: Record<GateVerdict, string> = {
  running: "The campaign run is still going on.",
  passed: "A completed run brought no finding the policy fails on.",
  failed: "New findings break the gate policy, so the release is blocked.",
  error: "Sentra could not check this release, so the gate fails.",
}

export type GateFinding = {
  code: string
  title: string
  severity: Severity
  test: string
  component: string
  /** "new", or "reopened" for a finding that was fixed and came back (FR-6.6) */
  why: string
}

/**
 * The scope approval of the gate's campaign (UC-9.4, 3a). Until an organization requires one,
 * none is needed; while one is awaited the pipeline cannot start a run.
 */
export type ApprovalStatus = "not_required" | "awaiting_approval" | "approved" | "rejected"

export const APPROVAL_WORDS: Record<ApprovalStatus, string> = {
  not_required: "Not required in this organization",
  awaiting_approval: "Waiting for a Security Manager, so the pipeline cannot run the gate yet",
  approved: "Approved once, so the pipeline runs the gate without asking again",
  rejected: "Rejected, so the gate cannot be run",
}

export type GateRun = {
  gate: string
  number: number
  verdict: GateVerdict
  /** What it decided, in one sentence (NFR-4.2) */
  message: string | null
  run_code: string | null
  run_status: string | null
  build_ref: string | null
  build_commit: string | null
  build_url: string | null
  /** The last accepted run its findings were measured against (UC-9.5 step 4) */
  compared_with: string | null
  new_findings: GateFinding[]
  breaking: GateFinding[]
  /** The policy this release was judged by, which a later change never rewrites (UC-9.4, 2) */
  policy_words: string
  started_by: string | null
  started_at: string
  finished_at: string | null
}

/** A suite each gate run sends, with the version a run fixes (UC-9.4 step 1, FR-4.5). */
export type GateSuite = {
  code: string
  found: boolean
  name: string
  version: number
  test_count: number
}

export type Gate = {
  code: string
  name: string
  status: GateStatus
  target_id: string
  target_name: string
  target_environment: Environment
  campaign_code: string
  campaign_name: string
  /** What each gate run sends (UC-9.4 step 1) */
  suites: GateSuite[]
  attempt_budget: number
  approval_status: ApprovalStatus
  /** The severities a new finding may not have (UC-9.4 step 2) */
  fail_on: Severity[]
  fail_on_reopened: boolean
  /** The policy in the words of the use case */
  policy_words: string
  baseline_run_code: string | null
  baseline_at: string | null
  created_by: string | null
  created_at: string
  runs: GateRun[]
}

export type GateCampaign = {
  code: string
  name: string
  target_id: string
  target_name: string
  target_environment: Environment
  suite_count: number
  attempt_budget: number
  approval_status: ApprovalStatus
}

export type GateList = {
  rows: Gate[]
  /** The campaigns that have no gate yet: one gate per campaign (UC-9.4 step 1) */
  campaigns: GateCampaign[]
}

export type NewGate = {
  name: string
  campaign_code: string
  fail_on: Severity[]
  fail_on_reopened: boolean
}

export type GateChange = {
  name?: string
  fail_on?: Severity[]
  fail_on_reopened?: boolean
  status?: GateStatus
}

const base = "/v1/gates"

/** Screen 55: the organization's gates with their policies and their last releases. */
export const listGates = (signal?: AbortSignal) => apiFetch<GateList>(base, { signal })

export const getGate = (code: string, signal?: AbortSignal) =>
  apiFetch<Gate>(`${base}/${encodeURIComponent(code)}`, { signal })

/** UC-9.4 steps 1-3 (a Security Analyst). */
export const createGate = (gate: NewGate) =>
  apiFetch<Gate>(base, { method: "POST", body: JSON.stringify(gate) })

export const changeGate = (code: string, changes: GateChange) =>
  apiFetch<Gate>(`${base}/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  })

/** The whole release history of one gate (UC-9.5 step 6). */
export const listGateRuns = (code: string, signal?: AbortSignal) =>
  apiFetch<GateRun[]>(`${base}/${encodeURIComponent(code)}/runs`, { signal })

/** What the pipeline step looks like, for the snippet a person copies (UC-9.4 step 4). */
export const pipelineCommand = (code: string) =>
  `sentra gate run --gate ${code} --wait --timeout 30m`
