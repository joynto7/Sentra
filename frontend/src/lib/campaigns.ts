import { API_URL, apiFetch } from "@/lib/api"

/** Types and API calls for campaigns (M5, FR-5.1). */

export type CampaignTarget = {
  id: string
  name: string
  type: string
  environment: string
  status: string
  max_request_rate: number
}

export type CampaignItem = {
  code: string
  name: string
  target: CampaignTarget | null
  suite_count: number
  attempt_budget: number
  request_rate: number
  approval_status: string
  created_by: string | null
  created_at: string
}

/** UC-5.1 step 6: the tests that will run against the target and the attempts they need. */
export type Estimate = {
  tests: number
  skipped: number
  estimated_attempts: number
  target_safe_rate: number | null
  threat_model: boolean
  warnings: string[]
}

export type CampaignDetail = CampaignItem & {
  adaptive_agent: boolean
  repetitions: number
  window_start: string | null
  window_end: string | null
  time_zone: string
  suites: { code: string; found: boolean; name: string; version: number; test_count: number }[]
  estimate: Estimate
}

export type CampaignInput = {
  name: string
  target_id: string | null
  suites: string[]
  adaptive_agent: boolean
  attempt_budget: number | null
  request_rate: number | null
  repetitions: number | null
  window_start: string | null
  window_end: string | null
  time_zone: string
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) })

export const listCampaigns = (params?: URLSearchParams) =>
  apiFetch<CampaignItem[]>(`/v1/campaigns${params?.size ? `?${params}` : ""}`)
export const getCampaign = (code: string) => apiFetch<CampaignDetail>(`/v1/campaigns/${encodeURIComponent(code)}`)
export const estimateCampaign = (input: { target_id: string | null; suites: string[]; attempt_budget: number | null }) =>
  apiFetch<Estimate>("/v1/campaigns/estimate", post(input))
export const createCampaign = (input: CampaignInput) => apiFetch<CampaignDetail>("/v1/campaigns", post(input))

export type RunStatus = "queued" | "running" | "paused" | "completed" | "stopped" | "cancelled"

/** One run of a campaign (FR-5.4). The runs pages themselves come with UC-5.6 (Screen 36). */
export type RunItem = {
  id: string
  code: string
  number: number
  status: RunStatus
  end_reason: string | null
  trigger: string
  launched_by: string | null
  ended_by: string | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  attempts_sent: number
  attempt_budget: number
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  stopped: "Stopped",
  cancelled: "Cancelled",
}

/** A run with the campaign and target it belongs to, for the lists that cross campaigns. */
export type RunOverviewItem = RunItem & {
  campaign: { code: string; name: string } | null
  target: { id: string; name: string; type: string } | null
}

/** A test of the run: planned with its attempts, or skipped with the reason (UC-5.4 step 2). */
export type RunTest = {
  code: string
  version: number
  name: string
  suites: string[]
  template: string | null
  status: "planned" | "skipped"
  reason: string | null
  attempts: number
}

/** UC-5.6 step 5: what the run did, once it has ended. */
export type RunSummary = {
  attempts: Record<AttemptStatus, number>
  skipped_tests: { code: string; name: string; reason: string }[]
  cost_usd: number
}

export type RunDetail = RunItem & {
  campaign: { code: string; name: string }
  target: { id: string; name: string; type: string }
  status_message: string
  paused_by: string | null
  paused_at: string | null
  /** "user" or "automatic": Sentra pauses a run itself when it can't reach the target. */
  pause_kind: string | null
  wake_at: string | null
  window_ends_at: string | null
  /** UC-5.6, 1a1: how many runs wait for a worker before this one. */
  queue_position: number | null
  request_rate: number
  attempts_planned: number
  attempts_replied: number
  attempts_failed: number
  cost_usd: number
  settings: Record<string, string | number | boolean | null>
  versions: Record<string, unknown>
  tests: RunTest[]
  summary: RunSummary | null
  extension_errors: { extension: string; error: string }[]
  /** Where the monitor starts to follow the live events, so it doesn't replay the whole run. */
  last_event_id: string | null
}

export type AttemptStatus = "planned" | "sending" | "replied" | "failed" | "interrupted" | "not_sent"

export type AttemptItem = {
  attempt_no: number
  test_code: string
  suite_code: string | null
  template: string
  variant: number
  status: AttemptStatus
  input: string
  sent_at: string | null
  finished_at: string | null
  status_code: number | null
  duration_ms: number | null
  reply: string | null
  reply_length: number | null
  error_kind: string | null
  error_message: string | null
}

export const ATTEMPT_STATUS_LABEL: Record<AttemptStatus, string> = {
  planned: "Planned",
  sending: "On its way",
  replied: "Replied",
  failed: "Failed",
  interrupted: "Interrupted",
  not_sent: "Not sent",
}

/** Why a run ended (UC-5.6 step 5), in the words the monitor shows. */
export const END_REASON_LABEL: Record<string, string> = {
  tests_finished: "Every planned attempt was sent",
  budget_used: "The attempt budget was used up",
  time_window_ended: "The time window ended",
  nothing_to_run: "Nothing to run",
  stopped_by_user: "Stopped by a user",
  target_overloaded: "The target reported that it is overloaded",
  target_errors: "The target answered with errors",
  target_unavailable: "The target could not be reached",
  usage_limit_reached: "A monthly limit was reached",
  internal_error: "Sentra could not go on",
  ownership_not_verified: "The target's ownership is not verified",
  queue_unavailable: "Sentra's workers could not be reached",
}

export const RUNNING_STATUSES: RunStatus[] = ["queued", "running", "paused"]

const CAMPAIGN = (code: string) => `/v1/campaigns/${encodeURIComponent(code)}`

export const listRuns = (code: string, signal?: AbortSignal) =>
  apiFetch<RunItem[]>(`${CAMPAIGN(code)}/runs`, { signal })

/** The organization's runs, newest first (Screen 33's "Campaign runs", Screen 20's card). */
export const listOrganizationRuns = (params?: URLSearchParams, signal?: AbortSignal) =>
  apiFetch<RunOverviewItem[]>(`/v1/campaigns/runs${params?.size ? `?${params}` : ""}`, { signal })

export const getRun = (code: string, number: number, signal?: AbortSignal) =>
  apiFetch<RunDetail>(`${CAMPAIGN(code)}/runs/${number}`, { signal })

/** UC-5.3: the API answers at once with the new run; the workers then execute it. */
export const launchRun = (code: string) => apiFetch<RunDetail>(`${CAMPAIGN(code)}/runs`, { method: "POST" })

export const pauseRun = (code: string, number: number) =>
  apiFetch<RunDetail>(`${CAMPAIGN(code)}/runs/${number}/pause`, { method: "POST" })

export const resumeRun = (code: string, number: number) =>
  apiFetch<RunDetail>(`${CAMPAIGN(code)}/runs/${number}/resume`, { method: "POST" })

export const stopRun = (code: string, number: number, reason: string) =>
  apiFetch<RunDetail>(`${CAMPAIGN(code)}/runs/${number}/stop`, post({ reason }))

export const listAttempts = (code: string, number: number, params: URLSearchParams, signal?: AbortSignal) =>
  apiFetch<{ items: AttemptItem[]; total: number; page: number; page_size: number }>(
    `${CAMPAIGN(code)}/runs/${number}/attempts?${params}`,
    { signal },
  )

/** Where the monitor follows the live events (UC-5.6 step 3), as Server-Sent Events. */
export const runEventsUrl = (code: string, number: number, after: string | null) =>
  `${API_URL}${CAMPAIGN(code)}/runs/${number}/events${after ? `?after=${encodeURIComponent(after)}` : ""}`

export const formatCount = (value: number) => value.toLocaleString("en-US")

/** "02:00–05:00 (Asia/Dhaka)", or "Any time" without a window. */
export function windowText(start: string | null, end: string | null, timeZone: string): string {
  return start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)} (${timeZone})` : "Any time"
}
