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


// ---------------------------------------------------------------- the evaluation (FR-11.4)

/** One metric of one strategy: the mean over the repetitions that finished and their spread
 * (UC-11.5 step 6). `note` says why it has no value. */
export type Figure = {
  key: string
  label: string
  unit: "percent" | "count" | "minutes" | "usd" | "tokens"
  mean: number | null
  sd: number | null
  /** How many completed repetitions the figure rests on (6a1) */
  repetitions: number
  values: number[]
  note: string | null
}

/** What one repetition measured; the dot plot draws one dot per row. */
export type Measure = {
  id: string
  target_name: string
  repetition: number
  status: Repetition["status"]
  reason: string | null
  documented: number
  discovered: number
  findings: number
  false_positives: number
  unlabelled: number
  attempts: number
  successful: number
  minutes: number | null
  tokens: number
  cost_usd: string
}

export type StrategyMetrics = {
  key: string
  name: string
  suites: string[]
  adaptive_agent: boolean
  completed: number
  incomplete: number
  figures: Figure[]
  rows: Measure[]
}

/** How one detection compares with the analyst's blind labels (UC-11.5 step 5, NFR-9.5). */
export type Agreement = {
  key: "llm_judge" | "combined"
  label: string
  labelled: number
  unsure: number
  without_verdict: number
  true_positive: number
  false_positive: number
  true_negative: number
  false_negative: number
  /** Percentages, 0-100 */
  precision: number | null
  recall: number | null
  agreement: number | null
}

/** A lab target's list of documented weaknesses and the version measured against. */
export type Documented = {
  target_id: string
  target_name: string
  count: number
  version: number
  added_by_analyst: number
}

/** A finding of the run: the documented weakness it matched, or none (UC-11.5 step 2). */
export type Matched = {
  finding_id: string
  finding_number: number
  known_id: string | null
  category: string
  title: string
  component: string
  label: "false_positive" | "undocumented" | null
}

export type BenchmarkBaseline = {
  code: string
  name: string
  rows: {
    strategy_key: string
    strategy_name: string
    success_rate: number | null
    baseline_rate: number | null
    reduction: number | null
  }[]
  note: string
}

export type Evaluation = {
  code: string
  name: string
  status: BenchmarkStatus
  ended_at: string | null
  /** Every repetition has ended, which UC-11.5 needs before it can be read in full */
  ready: boolean
  judge_every_attempt: boolean
  documented: Documented[]
  strategies: StrategyMetrics[]
  agreement: Agreement[]
  unmatched: Matched[]
  sample_total: number
  sample_labelled: number
  incomplete: number
  /** Which labels are still missing (the failed end condition of UC-11.5) */
  missing: string[]
  baseline: BenchmarkBaseline | null
}

/** One attempt of the blind sample. Nothing here says what Sentra decided (NFR-9.5). */
export type ToLabel = {
  attempt_id: string
  place: number
  total: number
  labelled: number
  target_name: string
  category: string
  test_code: string
  objective: string
  message: string
  reply: string | null
  tool_calls: string | null
  note: string | null
  verdict: AttemptVerdict | null
  blind: string
}

export type AttemptVerdict = "successful" | "unsuccessful" | "unsure"
export type FindingVerdict = "false_positive" | "undocumented"

export const benchmarkEvaluation = (code: string, signal?: AbortSignal) =>
  apiFetch<Evaluation>(`${BENCHMARKS}/${code}/evaluation`, { signal })

export const unmatchedFindings = (code: string, signal?: AbortSignal) =>
  apiFetch<Matched[]>(`${BENCHMARKS}/${code}/findings`, { signal })

/** UC-11.5 step 2 and 2a1: a false positive, or a weakness the lab target's list doesn't name. */
export const labelFinding = (code: string, findingId: string, verdict: FindingVerdict, note?: string) =>
  apiFetch<Matched[]>(`${BENCHMARKS}/${code}/findings/${findingId}/label`, {
    method: "POST",
    body: JSON.stringify({ verdict, note: note || null }),
  })

/** UC-11.5 step 3: the next attempt to label, or the one at `place`. */
export const blindSample = (code: string, place?: number, signal?: AbortSignal) =>
  apiFetch<ToLabel | null>(
    `${BENCHMARKS}/${code}/sample${place ? `?place=${place}` : ""}`,
    { signal },
  )

export const labelAttempt = (code: string, attemptId: string, verdict: AttemptVerdict, note?: string) =>
  apiFetch<ToLabel | null>(`${BENCHMARKS}/${code}/sample/${attemptId}/label`, {
    method: "POST",
    body: JSON.stringify({ verdict, note: note || null }),
  })

export const ATTEMPT_VERDICT_LABEL: Record<AttemptVerdict, string> = {
  successful: "Successful",
  unsuccessful: "Unsuccessful",
  unsure: "Unsure",
}

export const FINDING_VERDICT_LABEL: Record<FindingVerdict, string> = {
  false_positive: "False positive",
  undocumented: "Real, undocumented vulnerability",
}

/** How a figure's numbers are written: the unit decides the scale, and the mean decides how many
 * decimals both it and its spread get, so "38% ± 4" and "$3.10 ± 0.40" read the same way. */
function shape(unit: Figure["unit"], mean: number) {
  if (unit === "usd") return { divide: 1, prefix: "$", suffix: "", decimals: 2 }
  if (unit === "minutes") return { divide: 1, prefix: "", suffix: " min", decimals: mean < 100 ? 1 : 0 }
  if (unit === "tokens") {
    if (mean >= 1_000_000) return { divide: 1_000_000, prefix: "", suffix: " M", decimals: 1 }
    if (mean >= 1_000) return { divide: 1_000, prefix: "", suffix: " k", decimals: 0 }
    return { divide: 1, prefix: "", suffix: "", decimals: 0 }
  }
  return { divide: 1, prefix: "", suffix: unit === "percent" ? "%" : "", decimals: mean < 10 ? 1 : 0 }
}

/** "38%", "$3.10", "0.4 M" — one value of a figure, in the figure's own unit. */
export function figureValue(figure: Figure, value: number, reference?: number): string {
  const { divide, prefix, suffix, decimals } = shape(figure.unit, reference ?? figure.mean ?? value)
  return `${prefix}${(value / divide).toFixed(decimals)}${suffix}`
}

/** "± 4", "± 0.40" — the spread, without the unit, in the same scale as the mean. A spread that
 * would round to zero gets another decimal rather than disappearing. */
export function figureSpread(figure: Figure): string {
  if (figure.sd === null || figure.mean === null) return ""
  const { divide, decimals } = shape(figure.unit, figure.mean)
  const scaled = figure.sd / divide
  let places = decimals
  while (places < 3 && Number(scaled.toFixed(places)) === 0 && scaled > 0) places += 1
  return `± ${scaled.toFixed(places)}`
}

/** "0.86" — precision and recall as the detection card shows them, on a scale of 0 to 1. */
export const share = (percent: number | null) => (percent === null ? "—" : (percent / 100).toFixed(2))
