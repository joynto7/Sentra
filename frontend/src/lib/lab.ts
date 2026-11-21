import { apiFetch } from "@/lib/api"
import type { TargetType } from "@/lib/targets"

/** Screen 65: the Security Lab (FR-11.1, FR-11.2). Lab targets run in an isolated zone with
 * synthetic data and belong to one organization only (NFR-3.3). */
export type LabState = "deploying" | "ready" | "resetting" | "not_ready"

export type LabCard = {
  key: string
  name: string
  about: string
  /** The target type, as M2 names it */
  type: TargetType
  /** What the host needs for it (UC-11.1, 2a) */
  memory_mb: number
  minutes: number
  deployed: boolean
  target_id: string | null
  state: LabState | null
  /** "Deploying", "Ready", "Resetting" or "Not ready" */
  state_label: string
  /** The target's own status (UC-2.3) */
  status: string | null
  vulnerabilities: number
  categories: string[]
  canaries: number
  last_reset_at: string | null
  resets: number
  last_error: string | null
  /** The campaign run that is using it (UC-11.2, 1a) */
  active_run: string | null
}

export type Lab = { cards: LabCard[]; isolation: string }

export type KnownVulnerability = {
  id: string
  title: string
  /** The OWASP LLM category, e.g. "LLM01" */
  category: string
  description: string
}

const URL = "/lab"

export const securityLab = (signal?: AbortSignal) => apiFetch<Lab>(`/v1${URL}`, { signal })

/** UC-11.1: one action claims the lab target for the organization, verifies it and tests it. */
export const deployLabTarget = (key: string) =>
  apiFetch<LabCard>(`/v1${URL}/targets/${key}/deploy`, { method: "POST" })

/** UC-11.2: back to the original state, with new canary tokens. */
export const resetLabTarget = (targetId: string) =>
  apiFetch<LabCard>(`/v1${URL}/targets/${targetId}/reset`, { method: "POST" })

export const knownVulnerabilities = (targetId: string) =>
  apiFetch<KnownVulnerability[]>(`/v1${URL}/targets/${targetId}/vulnerabilities`)

/** "512 MB", "6 GB" — what the host needs, as the helper under Deploy says it. */
export const memory = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`)


// ---------------------------------------------------------------- benchmark runs (FR-11.3)

/** One testing strategy of a benchmark run (UC-11.3 step 2). */
export type Strategy = {
  /** "A", "B", … */
  key: string
  name: string
  suites: string[]
  adaptive_agent: boolean
}

export type BenchmarkStatus = "draft" | "running" | "paused" | "completed" | "stopped"

export type Repetition = {
  id: string
  target_id: string
  target_name: string
  strategy_key: string
  repetition: number
  /** Its place in the random interleaved order (UC-11.4 step 1) */
  order_no: number
  status: "planned" | "resetting" | "running" | "completed" | "incomplete"
  reason: string | null
  campaign_run_id: string | null
  started_at: string | null
  ended_at: string | null
  attempts_sent: number
  cost_usd: string
}

export type BenchmarkItem = {
  code: string
  name: string
  status: BenchmarkStatus
  status_message: string
  strategies: Strategy[]
  attempt_budget: number
  repetitions: number
  judge_every_attempt: boolean
  baseline_code: string | null
  lab_targets: string[]
  runs_total: number
  runs_done: number
  created_at: string
  started_at: string | null
  ended_at: string | null
}

export type BenchmarkDetail = BenchmarkItem & {
  estimate: {
    runs?: number
    attempts?: number
    llm_cost_low_usd?: string | null
    llm_cost_high_usd?: string | null
    minutes?: number
  }
  versions: {
    suites?: Record<string, { code: string; version: number }[]>
    tests?: { code: string; version: number }[]
    lab_targets?: { id: string; name: string; type: string }[]
    models?: Record<string, string>
  }
  order_seed: number | null
  repetition_rows: Repetition[]
}

export type BenchmarkEstimate = {
  runs: number
  attempts: number
  llm_cost_low_usd: string | null
  llm_cost_high_usd: string | null
  minutes: number
  /** The monthly limits this experiment would pass (UC-11.3, 5a1) */
  warnings: string[]
}

export type NewBenchmark = {
  name: string
  target_ids: string[]
  strategies: { key: string; name: string; suites: string[]; adaptive_agent: boolean }[]
  attempt_budget: number
  repetitions: number
  judge_every_attempt: boolean
  baseline_code?: string | null
}

const BENCHMARKS = "/v1/lab/benchmarks"

export const listBenchmarks = (signal?: AbortSignal) =>
  apiFetch<BenchmarkItem[]>(BENCHMARKS, { signal })

export const readBenchmark = (code: string, signal?: AbortSignal) =>
  apiFetch<BenchmarkDetail>(`${BENCHMARKS}/${code}`, { signal })

/** UC-11.3 step 5: what the experiment will send and cost, and the limits it would pass. */
export const estimateBenchmark = (data: NewBenchmark) =>
  apiFetch<BenchmarkEstimate>(`${BENCHMARKS}/estimate`, { method: "POST", body: JSON.stringify(data) })

export const saveBenchmark = (data: NewBenchmark) =>
  apiFetch<BenchmarkDetail>(BENCHMARKS, { method: "POST", body: JSON.stringify(data) })

export const startBenchmark = (code: string) =>
  apiFetch<BenchmarkDetail>(`${BENCHMARKS}/${code}/start`, { method: "POST" })

export const pauseBenchmark = (code: string) =>
  apiFetch<BenchmarkDetail>(`${BENCHMARKS}/${code}/pause`, { method: "POST" })

export const resumeBenchmark = (code: string) =>
  apiFetch<BenchmarkDetail>(`${BENCHMARKS}/${code}/resume`, { method: "POST" })

export const stopBenchmark = (code: string) =>
  apiFetch<BenchmarkDetail>(`${BENCHMARKS}/${code}/stop`, { method: "POST" })

export const BENCHMARK_STATUS_LABEL: Record<BenchmarkStatus, string> = {
  draft: "Draft",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  stopped: "Stopped",
}

export const REPETITION_LABEL: Record<Repetition["status"], string> = {
  planned: "Queued",
  resetting: "Resetting",
  running: "Running",
  completed: "Completed",
  incomplete: "Incomplete",
}

/** "about 9 hours", "about 25 minutes" — how long the experiment is expected to take. */
export function duration(minutes: number): string {
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`
  const hours = Math.round(minutes / 60)
  return `about ${hours} hour${hours === 1 ? "" : "s"}`
}

/** "$64–80", "$64.00" — the LLM cost range of an estimate. */
export function costRange(low: string | null, high: string | null): string {
  if (low === null || high === null) return "Not known yet"
  const left = Number(low)
  const right = Number(high)
  return `$${left.toFixed(2)}–${right.toFixed(2)}`
}
