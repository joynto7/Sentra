import { apiFetch } from "@/lib/api"

export type TargetType = "chatbot" | "rag_application" | "tool_using_agent"
export type Environment = "staging" | "production"
export type TargetStatus = "unverified" | "verified" | "archived"
export type RequestFormat = "openai_chat" | "custom_json"
export type CredentialType = "api_key" | "bearer_token" | "custom_header"
/** How Sentra authenticates; "none" means the target needs no credentials. */
export type AuthMode = CredentialType | "none"

export type StoredCredential = {
  name: string
  credential_type: CredentialType
  masked_value: string
  saved_at: string
}

export type ConnectionSummaryOut = {
  status: CheckStatus
  finished_at: string | null
  status_code: number | null
  duration_ms: number | null
}

export type Target = {
  id: string
  name: string
  type: TargetType
  endpoint_url: string
  endpoint_host: string
  environment: Environment
  max_request_rate: number
  request_format: RequestFormat
  request_template: string | null
  reply_path: string
  tool_calls_path: string | null
  status: TargetStatus
  owner: { id: string; name: string } | null
  credentials: StoredCredential[]
  created_at: string
  updated_at: string
  /** Sentra's own lab target: Sentra places its ownership token itself (FR-11.1). */
  is_lab: boolean
  verified_at: string | null
  verified_by: { id: string; name: string } | null
  verification_method: VerificationMethod | null
  last_connection_test: ConnectionSummaryOut | null
  profile_status: ProfileStatus | null
  /** When it was retired and by whom (FR-2.6; UC-2.6) */
  archived_at: string | null
  archived_by: { id: string; name: string } | null
  /** Only on one target, not in the list: the run that keeps the endpoint and credentials fixed */
  active_run: ActiveRun | null
}

/** The campaign run that is going on, while which the endpoint and credentials stay put. */
export type ActiveRun = { id: string; code: string; number: number; campaign: string | null }

/** Screen 16's Sentra Shield column: the state of the gateway in front of a target (FR-8.3, M8). */
export type ShieldState = "active" | "not_reporting" | "pending" | "not_in_path" | "not_connected"

export const SHIELD_LABEL: Record<ShieldState, string> = {
  active: "Active",
  not_reporting: "Not reporting",
  pending: "Waiting for the gateway",
  not_in_path: "Not in the traffic path",
  not_connected: "Not connected",
}

/** A row of the targets page: the target and its Sentra Shield state. */
export type TargetListItem = Target & { shield: { status: ShieldState; label: string } }

export type TargetList = {
  items: TargetListItem[]
  total: number
  page: number
  page_size: number
  counts: { active: number; archived: number }
}

export type CredentialInput = { credential_type: CredentialType; name: string; value: string }

/** A check Sentra runs against a target: it starts as running and ends as passed or failed. */
export type CheckStatus = "running" | "passed" | "failed"
export type VerificationMethod = "dns_txt_record" | "well_known_file" | "lab"

/** One connection test and its result (FR-2.4, UC-2.2). */
export type ConnectionTest = {
  id: string
  status: CheckStatus
  created_at: string
  finished_at: string | null
  status_code: number | null
  duration_ms: number | null
  reply_path: string | null
  /** The target's reply, masked. Shown as plain text, never as active content (NFR-3.6). */
  reply_excerpt: string | null
  error_kind: string | null
  error_message: string | null
  /** The part of the answer that didn't match the configured format (UC-2.2, 4a). */
  unreadable_excerpt: string | null
}

/** One ownership check: where Sentra looked and what it found (UC-2.3, 4a and 4b). */
export type OwnershipCheck = {
  id: string
  method: VerificationMethod
  trigger: string
  status: CheckStatus
  created_at: string
  finished_at: string | null
  checked_location: string
  found: string | null
  message: string | null
  checked_by: string | null
}

export type Verification = {
  status: TargetStatus
  token: string
  is_lab: boolean
  /** An IP address has no DNS records, so only the file can be used. */
  ip_endpoint: boolean
  dns: { type: string; name: string; value: string } | null
  file: { url: string; content: string }
  verified_at: string | null
  verified_by: string | null
  method: VerificationMethod | null
  recent_checks: OwnershipCheck[]
}

/** Where a profile entry comes from (UC-2.4 step 6 and 3a). */
export type ProfileSource = "discovered" | "manual" | "unknown"
/** "not_mapped": the target has no profile yet; it is mapped after its ownership check. */
export type ProfileStatus = "not_mapped" | "mapping" | "ready" | "partial" | "failed" | "reviewed"

export type ProfileEntry = { key: string; label: string; value: string; source: ProfileSource; note: string }
export type ProfileTool = { name: string; parameters: string; side_effect: string; source: ProfileSource }
export type ProfileKnowledge = { name: string; description: string; access: string; source: ProfileSource }

export type TargetProfile = {
  status: ProfileStatus
  version: number
  mapped_at: string | null
  discovery_requests: number
  /** Why the mapping stopped early, for example signs of overload (UC-2.4, 2a). */
  stop_reason: string | null
  entries: ProfileEntry[]
  tools: ProfileTool[]
  knowledge_sources: ProfileKnowledge[]
  reviewed_at: string | null
  reviewed_by: string | null
}

/** What the review saves (UC-2.4 steps 5 and 6). */
export type ProfilePayload = {
  entries: Record<string, { value: string }>
  tools: { name: string; parameters: string; side_effect: string }[]
  knowledge_sources: { name: string; description: string; access: string }[]
}

export const TYPE_LABEL: Record<TargetType, string> = {
  chatbot: "Chatbot",
  rag_application: "RAG application",
  tool_using_agent: "Tool-using agent",
}

export const TYPE_DESCRIPTION: Record<TargetType, string> = {
  chatbot: "Answers users in a conversation",
  rag_application: "Answers from your documents or knowledge base",
  tool_using_agent: "Calls tools or APIs to take actions",
}

export const ENVIRONMENT_LABEL: Record<Environment, string> = { staging: "Staging", production: "Production" }

export const AUTH_LABEL: Record<AuthMode, string> = {
  api_key: "API key in a header",
  bearer_token: "Bearer token",
  custom_header: "Custom headers",
  none: "No credentials needed",
}

export const MAX_RATE = 600
export const PLACEHOLDERS = ["message", "session_id"]
export const OPENAI_REPLY_PATH = "$.choices[0].message.content"
export const EXAMPLE_TEMPLATE = '{"session": "{{session_id}}", "input": "{{message}}"}'

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g
const PATH = /^\$(?:\.[A-Za-z_][\w-]*|\[\d+\]|\[['"][^'"]+['"]\])+$/
const HEADER = /^[A-Za-z0-9-]{1,100}$/
const RESERVED = new Set(["host", "content-length", "content-type", "transfer-encoding", "connection"])

// The same checks as the API (FR-2.1), so most mistakes show up before anything is sent.
export function nameProblem(name: string): string | undefined {
  const clean = name.trim()
  if (!clean) return "Enter a name."
  if (clean.length > 120) return "Use at most 120 characters."
}

export function urlProblem(url: string): string | undefined {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error()
    if (parsed.username || parsed.password) {
      return "Don't put a user name or password in the URL. Add them as credentials."
    }
  } catch {
    return "Enter a URL that starts with https:// or http://."
  }
}

export function rateProblem(rate: string): string | undefined {
  const n = Number(rate)
  if (!rate.trim() || !Number.isInteger(n) || n < 1 || n > MAX_RATE) {
    return `Enter a rate between 1 and ${MAX_RATE} requests per minute.`
  }
}

export function templateProblem(template: string): string | undefined {
  const text = template.trim()
  if (!text) return "Describe the request body, with {{message}} where Sentra's message goes."
  const names = [...text.matchAll(PLACEHOLDER)].map((m) => m[1])
  const unknown = names.find((n) => !PLACEHOLDERS.includes(n))
  if (unknown) return `Unknown placeholder {{${unknown}}}. Use {{message}} or {{session_id}}.`
  if (!names.includes("message")) return "Add {{message}} where Sentra's message goes."
  let body: unknown
  try {
    body = JSON.parse(text.replace(PLACEHOLDER, "x"))
  } catch {
    return 'The template must be valid JSON, with placeholders in quotes: "{{message}}".'
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return 'The template must be a JSON object, such as {"input": "{{message}}"}.'
  }
}

export function pathProblem(path: string, required: boolean): string | undefined {
  const text = path.trim()
  if (!text) return required ? "Enter where the reply is, for example $.output.text." : undefined
  if (!PATH.test(text)) return "Use a path such as $.output.text."
}

export function credentialProblems(mode: AuthMode, rows: CredentialInput[]): Record<string, string> {
  const errors: Record<string, string> = {}
  if (mode === "none") return errors
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    if (mode !== "bearer_token") {
      const name = row.name.trim()
      if (!HEADER.test(name)) errors[`credentials.${i}.name`] = "Use a header name with letters, digits and dashes, such as X-Api-Key."
      else if (RESERVED.has(name.toLowerCase())) errors[`credentials.${i}.name`] = "Sentra sets this header itself. Use another one."
      else if (seen.has(name.toLowerCase())) errors[`credentials.${i}.name`] = "Each header can be used only once."
      seen.add(name.toLowerCase())
    }
    if (!row.value.trim()) errors[`credentials.${i}.value`] = "Enter the secret."
    else if (/[\r\n\0]/.test(row.value)) errors[`credentials.${i}.value`] = "The value can't contain line breaks."
  })
  return errors
}

export function credentialsPayload(mode: AuthMode, rows: CredentialInput[]): CredentialInput[] {
  if (mode === "none") return []
  return rows.map((row) => ({ ...row, credential_type: mode, name: mode === "bearer_token" ? "Authorization" : row.name.trim() }))
}

/** One line describing a stored credential, never its value (FR-2.2). */
export function describeCredential(credential: StoredCredential): string {
  if (credential.credential_type === "bearer_token") return "Bearer token"
  if (credential.credential_type === "api_key") return `API key in header ${credential.name}`
  return `Header ${credential.name}`
}

export function listTargets(params: URLSearchParams, signal?: AbortSignal) {
  return apiFetch<TargetList>(`/v1/targets?${params}`, { signal })
}

export function getTarget(id: string) {
  return apiFetch<Target>(`/v1/targets/${id}`)
}

export function registerTarget(body: unknown) {
  return apiFetch<Target>("/v1/targets", { method: "POST", body: JSON.stringify(body) })
}

export function updateTarget(id: string, body: unknown) {
  return apiFetch<Target>(`/v1/targets/${id}`, { method: "PATCH", body: JSON.stringify(body) })
}

export function replaceCredentials(id: string, credentials: CredentialInput[]) {
  return apiFetch<Target>(`/v1/targets/${id}/credentials`, {
    method: "PUT",
    body: JSON.stringify({ credentials }),
  })
}

export function checkEndpoint(endpoint_url: string) {
  return apiFetch<{ endpoint_url: string }>("/v1/targets/check-endpoint", {
    method: "POST",
    body: JSON.stringify({ endpoint_url }),
  })
}

export const VERIFICATION_LABEL: Record<VerificationMethod, string> = {
  dns_txt_record: "DNS TXT record",
  well_known_file: "Well-known file",
  lab: "Placed by Sentra's lab",
}

export const SOURCE_LABEL: Record<ProfileSource, string> = {
  discovered: "Discovered",
  manual: "Added manually",
  unknown: "Unknown — please complete",
}

/** What a failed connection test offers next, besides testing again (UC-2.2, 3a, 3b and 4a). */
export const CONNECTION_FIX: Record<string, string> = {
  authentication: "Edit credentials",
  credentials: "Edit credentials",
  format: "Adjust the response format",
  network: "Edit the endpoint",
  http: "Edit the endpoint",
  address: "Edit the endpoint",
  redirect: "Edit the endpoint",
}

export function startConnectionTest(id: string) {
  return apiFetch<ConnectionTest>(`/v1/targets/${id}/connection-tests`, { method: "POST" })
}

export function listConnectionTests(id: string, signal?: AbortSignal) {
  return apiFetch<ConnectionTest[]>(`/v1/targets/${id}/connection-tests`, { signal })
}

export function getConnectionTest(id: string, testId: string, signal?: AbortSignal) {
  return apiFetch<ConnectionTest>(`/v1/targets/${id}/connection-tests/${testId}`, { signal })
}

export function getVerification(id: string, signal?: AbortSignal) {
  return apiFetch<Verification>(`/v1/targets/${id}/verification`, { signal })
}

export function startOwnershipCheck(id: string, method: VerificationMethod) {
  return apiFetch<OwnershipCheck>(`/v1/targets/${id}/verification/checks`, {
    method: "POST",
    body: JSON.stringify({ method }),
  })
}

export function getOwnershipCheck(id: string, checkId: string, signal?: AbortSignal) {
  return apiFetch<OwnershipCheck>(`/v1/targets/${id}/verification/checks/${checkId}`, { signal })
}

export function getProfile(id: string, signal?: AbortSignal) {
  return apiFetch<TargetProfile>(`/v1/targets/${id}/profile`, { signal })
}

export function startProfileMapping(id: string) {
  return apiFetch<TargetProfile>(`/v1/targets/${id}/profile/mapping`, { method: "POST" })
}

export function saveProfile(id: string, body: ProfilePayload) {
  return apiFetch<TargetProfile>(`/v1/targets/${id}/profile`, { method: "PUT", body: JSON.stringify(body) })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** Date and time, as a check or a run is shown: "8 Oct 2026, 09:42". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}


// ---------------------------------------------------------------- the lifecycle (FR-2.6)

/** What a campaign scheduled against the target would lose when it is archived (UC-2.6 step 2). */
export type ScheduleToCancel = {
  id: string
  campaign: string
  name: string
  schedule: string
  next_run_at: string | null
  created_by: string | null
}

export type ArchiveConsequences = {
  target: { id: string; name: string; status: TargetStatus }
  /** Why it can't be archived now (UC-2.6, 2a1); empty when nothing is running */
  running: string
  schedules: ScheduleToCancel[]
  credentials: string[]
  runs_kept: number
  findings_kept: number
}

export type HistoryKind =
  | "registration"
  | "verification"
  | "configuration"
  | "profile"
  | "campaign_run"
  | "retest"
  | "shield_policy"

export type HistoryEvent = {
  at: string
  kind: HistoryKind
  action: string
  summary: string
  actor: string
  by_sentra: boolean
  details: Record<string, unknown>
  run: { id: string; code: string; number: number; campaign: string | null } | null
  /** UC-2.7, 5a1: the details were deleted at the end of their retention period */
  details_deleted: boolean
}

export type HistoryScore = {
  at: string
  score: number
  band: string
  trigger: string
  open_by_severity: Record<string, number>
  open_total: number
}

export type TargetHistory = {
  target: { id: string; name: string; status: TargetStatus }
  period_days: number
  kinds: HistoryKind[]
  /** 2a1: without a campaign run the page suggests creating one */
  has_runs: boolean
  events: HistoryEvent[]
  scores: HistoryScore[]
}

export const HISTORY_KIND_LABEL: Record<HistoryKind, string> = {
  registration: "Registration",
  verification: "Verification",
  configuration: "Configuration",
  profile: "Profile",
  campaign_run: "Campaign runs",
  retest: "Retests",
  shield_policy: "Shield Policy",
}

export const HISTORY_PERIODS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 3 months" },
  { days: 180, label: "Last 6 months" },
  { days: 365, label: "Last year" },
  { days: 3650, label: "Everything" },
]

export function getTargetHistory(id: string, periodDays: number, kind: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ period_days: String(periodDays) })
  if (kind) params.set("kind", kind)
  return apiFetch<TargetHistory>(`/v1/targets/${id}/history?${params}`, { signal })
}

export function getArchiveConsequences(id: string, signal?: AbortSignal) {
  return apiFetch<ArchiveConsequences>(`/v1/targets/${id}/archive`, { signal })
}

export function archiveTarget(id: string, password: string) {
  return apiFetch<Target>(`/v1/targets/${id}/archive`, {
    method: "POST",
    body: JSON.stringify({ password }),
  })
}

export function restoreTarget(id: string) {
  return apiFetch<Target>(`/v1/targets/${id}/restore`, { method: "POST" })
}
