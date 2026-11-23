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
  /** When it runs by itself (FR-5.3); null when it only runs when someone launches it */
  schedule: Schedule | null
  created_by: string | null
  created_at: string
}

// ---------------------------------------------------------------- scope approval (FR-5.2)

/** Where an organization requires it, a campaign's scope is approved before it can run (UC-5.2). */
export type ApprovalStatus = "not_required" | "awaiting_approval" | "approved" | "rejected"

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  not_required: "Ready",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
}

export type ApprovalAction = "created" | "submitted" | "approved" | "rejected" | "scope_changed"

/** One step of the approval, as Screen 35's timeline reads it. */
export type ApprovalStep = {
  action: ApprovalAction
  actor: string | null
  /** The analyst's comment when submitting, or the reason for a rejection (3a1) */
  note: string | null
  at: string
}

export const APPROVAL_STEP_LABEL: Record<ApprovalAction, string> = {
  created: "created the campaign",
  submitted: "submitted it for approval",
  approved: "approved the scope",
  rejected: "rejected the scope",
  scope_changed: "changed it, so it needs a new approval",
}

/** What Screen 35 shows: the scope, how it got there, and whether this user may decide. */
export type ApprovalView = {
  campaign: CampaignDetail
  /** Whether this organization requires approval at all */
  required: boolean
  timeline: ApprovalStep[]
  can_decide: boolean
  cannot_decide_reason: string | null
}

// ---------------------------------------------------------------- the schedule (FR-5.3)

export type ScheduleKind = "immediately" | "once" | "recurring"
export type Frequency = "daily" | "weekly" | "monthly"
export type ScheduleStatus = "active" | "paused" | "finished" | "cancelled"
export type ScheduleResult = "launched" | "skipped" | "missed"

export type Schedule = {
  kind: "once" | "recurring"
  frequency: Frequency | null
  run_at: string | null
  at_time: string | null
  weekday: number | null
  day_of_month: number | null
  status: ScheduleStatus
  /** In words, e.g. "Every Monday at 02:00 (Asia/Dhaka)" */
  summary: string
  next_run_at: string | null
  last_run_at: string | null
  last_result: ScheduleResult | null
  last_message: string
  last_run: string | null
  created_by: string | null
}

/** What the builder and the campaign page send (UC-5.1 step 5). */
export type ScheduleInput = {
  kind: ScheduleKind
  frequency?: Frequency | null
  run_at?: string | null
  at_time?: string | null
  weekday?: number | null
  day_of_month?: number | null
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
}

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  active: "Active",
  paused: "Paused",
  finished: "Finished",
  cancelled: "Cancelled",
}

export const SCHEDULE_RESULT_LABEL: Record<ScheduleResult, string> = {
  launched: "Launched",
  skipped: "Didn't launch",
  missed: "Missed",
}

/** UC-5.1 step 6: the tests that will run against the target and the attempts they need. */
/** UC-5.1 step 2: the target's approved threat model and the suites saved for it (FR-3.4). */
export type ThreatModelBrief = {
  version: number
  approved_at: string | null
  approved_by: string | null
  /** The suites the campaign starts with */
  default_suites: string[]
  threats_total: number
  /** Of the threats, how many the chosen suites cover */
  threats_covered: number
}

/** What the LLM judge of this run may cost (FR-10.4), measured from the organization's own judged
 * attempts. `low_usd` is null while there is nothing to measure. */
export type CostEstimate = { judged_attempts: number; low_usd: string | null; high_usd: string | null }

/** UC-10.6 step 1 in the builder: what the organization has used of its month (FR-10.4). */
export type MonthlyUsage = {
  warn_percent: number
  limits: {
    kind: "campaign_runs" | "attempts" | "llm_cost"
    label: string
    used: string
    limit: string
    percent: number
    reached: boolean
    warning: boolean
  }[]
}

export type Estimate = {
  tests: number
  skipped: number
  estimated_attempts: number
  target_safe_rate: number | null
  /** null: the target has no approved threat model yet (2a) */
  threat_model: ThreatModelBrief | null
  llm_cost: CostEstimate
  monthly: MonthlyUsage
  warnings: string[]
  /** FR-5.2: the organization requires a Security Manager to approve the scope (Screen 34) */
  requires_scope_approval: boolean
}

export type CampaignDetail = CampaignItem & {
  /** Only in the answer to "create", when the campaign runs immediately (UC-5.1 step 7) */
  launched_run?: RunItem | null
  launch_error?: string | null
  adaptive_agent: boolean
  repetitions: number
  window_start: string | null
  window_end: string | null
  time_zone: string
  suites: { code: string; found: boolean; name: string; version: number; test_count: number }[]
  estimate: Estimate
  /** FR-5.2: who approved or rejected the scope, and when; null while nobody has decided */
  approval_decision: ApprovalStep | null
  /** FR-3.3: the version of the threat model the campaign was created with; null if there was none */
  based_on_threat_model: number | null
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
  /** UC-5.1 step 5; "immediately" launches the first run instead of saving a schedule */
  schedule: ScheduleInput | null
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) })

export const listCampaigns = (params?: URLSearchParams) =>
  apiFetch<CampaignItem[]>(`/v1/campaigns${params?.size ? `?${params}` : ""}`)
export const getCampaign = (code: string) => apiFetch<CampaignDetail>(`/v1/campaigns/${encodeURIComponent(code)}`)
export const estimateCampaign = (input: {
  target_id: string | null
  suites: string[]
  attempt_budget: number | null
}) => apiFetch<Estimate>("/v1/campaigns/estimate", post(input))
export const createCampaign = (input: CampaignInput) => apiFetch<CampaignDetail>("/v1/campaigns", post(input))

// Scope approval (FR-5.2, UC-5.2)
const approvalPath = (code: string) => `/v1/campaigns/${encodeURIComponent(code)}/approval`
export const getApproval = (code: string, signal?: AbortSignal) =>
  apiFetch<ApprovalView>(approvalPath(code), { signal })
/** 3a1: the analyst asks for a decision again, with a comment on what changed. */
export const submitForApproval = (code: string, note: string | null) =>
  apiFetch<ApprovalView>(approvalPath(code), post({ note }))
/** UC-5.2 steps 3 and 3a: a rejection needs a reason. */
export const decideApproval = (code: string, approve: boolean, reason: string | null) =>
  apiFetch<ApprovalView>(`${approvalPath(code)}/decision`, post({ approve, reason }))

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
  /** The adaptive testing agent wrote this attempt, and this is why (null: it was planned) */
  refinement_reason: string | null
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

/** One request to the adaptive testing agent and what came of it. */
export type RefinementState = "sent" | "discarded" | "refused" | "stopped"

export const REFINEMENT_STATE_LABEL: Record<RefinementState, string> = {
  sent: "Added to the run",
  discarded: "Discarded: outside the approved scope",
  refused: "Nothing usable",
  stopped: "The agent stopped",
}

export type RefinementItem = {
  state: RefinementState
  reason: string
  test_code: string
  after_attempt_id: string | null
  attempt_id: string | null
  instructions_version: string | null
  model: string | null
  cost_usd: string
  created_at: string
}

/** What the adaptive testing agent did in one run, for the monitor and the run summary. */
export type AgentTrail = {
  enabled: boolean
  sent: number
  discarded: number
  refused: number
  stopped_reason: string | null
  refinements_left: number
  cost_usd: string
  items: RefinementItem[]
}

export const getRunAgent = (code: string, number: number, signal?: AbortSignal) =>
  apiFetch<AgentTrail>(`${CAMPAIGN(code)}/runs/${number}/agent`, { signal })

/** Stops the agent only; the run goes on with its planned tests. */
export const stopRunAgent = (code: string, number: number, reason: string) =>
  apiFetch<AgentTrail>(`${CAMPAIGN(code)}/runs/${number}/agent/stop`, post({ reason }))

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

/** The campaign's schedule (FR-5.3): read it, replace it, pause it, start it again or remove it. */
export const getSchedule = (code: string, signal?: AbortSignal) =>
  apiFetch<Schedule | null>(`/v1/campaigns/${encodeURIComponent(code)}/schedule`, { signal })

export const saveSchedule = (code: string, input: ScheduleInput) =>
  apiFetch<Schedule>(`/v1/campaigns/${encodeURIComponent(code)}/schedule`, {
    method: "PUT",
    body: JSON.stringify(input),
  })

export const pauseSchedule = (code: string) =>
  apiFetch<Schedule>(`/v1/campaigns/${encodeURIComponent(code)}/schedule/pause`, post({}))

export const resumeSchedule = (code: string) =>
  apiFetch<Schedule>(`/v1/campaigns/${encodeURIComponent(code)}/schedule/resume`, post({}))

export const removeSchedule = (code: string) =>
  apiFetch<void>(`/v1/campaigns/${encodeURIComponent(code)}/schedule`, { method: "DELETE" })
