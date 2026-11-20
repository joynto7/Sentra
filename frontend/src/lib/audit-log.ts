import { apiDownload, apiFetch } from "@/lib/api"

/** Whose log: the organization's own (Organization Administrators) or the platform's
 * (Platform Administrators, UC-10.3 1a). */
export type AuditScope = "organization" | "platform"

export type AuditActor = {
  /** "user", "sentra" (an automatic action), "api_key" (FR-9.5) or "person" (no account yet) */
  type: string
  id: string | null
  name: string
}

export type AuditItem = { type: string; id: string | null; label: string }

export type AuditEntry = {
  id: string
  seq: number
  occurred_at: string
  actor: AuditActor
  action: string
  summary: string
  item: AuditItem | null
  source_address: string | null
}

export type AuditEntryDetail = AuditEntry & {
  details: Record<string, unknown>
  prev_hash: string
  entry_hash: string
  /** The stored hash matches the entry's content (NFR-8.3). */
  hash_matches: boolean
}

export type Integrity = {
  verified: boolean
  checked_at: string
  entries: number
  broken_seq: number | null
}

export type AuditPage = {
  items: AuditEntry[]
  total: number
  page: number
  page_size: number
  integrity: Integrity | null
  retention: string
}

export type AuditFilterOptions = {
  actors: { id: string; name: string }[]
  groups: { key: string; label: string }[]
  item_types: string[]
}

/** The filters of UC-10.3 step 2, as they appear in the page's address. */
export type AuditQuery = {
  period: string
  actor: string
  group: string
  item: string
  q: string
  page: number
}

export const PAGE_SIZE = 50

export const PERIODS = [
  { value: "24h", label: "Last 24 hours", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "365d", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: 0 },
] as const

export const DEFAULT_PERIOD = "7d"

/** The query of a page address; unknown values fall back to the defaults. */
export function readQuery(params: Record<string, string | string[] | undefined>): AuditQuery {
  const one = (key: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ""
  }
  const period = PERIODS.some((p) => p.value === one("period")) ? one("period") : DEFAULT_PERIOD
  const page = Math.max(1, Number.parseInt(one("page"), 10) || 1)
  return { period, actor: one("actor"), group: one("group"), item: one("item"), q: one("q").slice(0, 200), page }
}

/** The page address for a query: only what differs from the defaults. */
export function queryString(query: AuditQuery, entry?: string | null): string {
  const params = new URLSearchParams()
  if (query.period !== DEFAULT_PERIOD) params.set("period", query.period)
  if (query.actor) params.set("actor", query.actor)
  if (query.group) params.set("group", query.group)
  if (query.item) params.set("item", query.item)
  if (query.q) params.set("q", query.q)
  if (query.page > 1) params.set("page", String(query.page))
  if (entry) params.set("entry", entry)
  const text = params.toString()
  return text ? `?${text}` : ""
}

function base(scope: AuditScope): string {
  return scope === "platform" ? "/v1/admin/platform/audit-log" : "/v1/admin/audit-log"
}

/** The API's filter values for a query: the period becomes its start time. */
function apiFilters(query: AuditQuery, now = new Date()): Record<string, string> {
  const days = PERIODS.find((p) => p.value === query.period)?.days ?? 0
  const filters: Record<string, string> = {}
  if (days) filters.start = new Date(now.getTime() - days * 86_400_000).toISOString()
  if (query.actor) filters.actor_id = query.actor
  if (query.group) filters.group = query.group
  if (query.item) filters.item_type = query.item
  if (query.q.trim()) filters.search = query.q.trim()
  return filters
}

export function listEntries(scope: AuditScope, query: AuditQuery) {
  const params = new URLSearchParams({ ...apiFilters(query), page: String(query.page), page_size: String(PAGE_SIZE) })
  return apiFetch<AuditPage>(`${base(scope)}?${params}`)
}

export function filterOptions(scope: AuditScope) {
  return apiFetch<AuditFilterOptions>(`${base(scope)}/filters`)
}

export function getEntry(scope: AuditScope, id: string) {
  return apiFetch<AuditEntryDetail>(`${base(scope)}/${id}`)
}

/** A full check of the hash chain now (NFR-8.3). */
export function checkIntegrity(scope: AuditScope) {
  return apiFetch<Integrity>(`${base(scope)}/integrity`, { method: "POST" })
}

/** UC-10.3 steps 4-6: the filtered entries with their hashes; the export is recorded itself. */
export function exportEntries(scope: AuditScope, query: AuditQuery, format: "csv" | "json") {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  return apiDownload(
    `${base(scope)}/export`,
    { method: "POST", body: JSON.stringify({ format, ...apiFilters(query) }) },
    `sentra-audit-log-${stamp}.${format}`,
  )
}

// ---------------------------------------------------------------- showing entries

const ITEM_TYPES: Record<string, string> = {
  account: "Account",
  api_key: "API key",
  campaign: "Campaign",
  campaign_run: "Campaign run",
  finding: "Finding",
  gate: "Security gate",
  invitation: "Invitation",
  member: "Member",
  organization: "Organization",
  policy: "Shield Policy",
  remediation: "Remediation",
  report: "Report",
  suite: "Test suite",
  target: "Target",
  threat_model: "Threat model",
  test: "Test definition",
  webhook: "Webhook",
}

/** "Target", "Test suite": the kind of an affected item, for people. */
export function itemTypeLabel(type: string): string {
  return ITEM_TYPES[type] ?? type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/** Where an entry's affected item can be opened (UC-10.3 step 3); null when it has no page. */
export function itemHref(scope: AuditScope, item: AuditItem): string | null {
  const id = item.id ? encodeURIComponent(item.id) : null
  const search = encodeURIComponent(item.label)
  if (scope === "platform") return item.type === "account" ? `/platform/accounts?q=${search}` : null
  switch (item.type) {
    case "target":
      return id && `/targets/${id}`
    case "threat_model": {
      // The label ends with the version, e.g. "Internal HR Helpdesk, version 2".
      const version = /version (\d+)$/.exec(item.label)?.[1]
      return id && `/threat-models/${id}${version ? `?version=${version}` : ""}`
    }
    case "test":
      return id && `/test-library/${id}`
    case "suite":
      return id && `/test-library/suites/${id}`
    case "member":
      return `/admin/members?q=${search}`
    case "invitation":
      return "/admin/members?tab=invitations"
    case "organization":
      return "/admin/security"
    default:
      return null
  }
}

const DAY_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const FULL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
})
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

/** "8 Oct, 10:36" in the list. */
export function shortTime(iso: string): string {
  return DAY_TIME.format(new Date(iso))
}

/** "6 Oct 2026, 16:20:37 CEST" in an entry's details: to the second, with the time zone. */
export function fullTime(iso: string): string {
  return FULL.format(new Date(iso))
}

/** "today 09:00" or "7 Oct, 09:00" for the last check of the hash chain. */
export function checkedAt(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? `today ${TIME.format(date)}` : DAY_TIME.format(date)
}

/** "sha256:9f3c41d2…7e0ba71e", short enough to read, with both ends to compare. */
export function shortHash(hash: string): string {
  return hash.length > 20 ? `sha256:${hash.slice(0, 8)}…${hash.slice(-8)}` : `sha256:${hash}`
}

/** The actor as the list names it: a person, Sentra itself or an API key. */
export function actorLabel(actor: AuditActor): string {
  return actor.type === "api_key" ? `API key: ${actor.name}` : actor.name
}

/** The before and after values of a change, e.g. a role (from `details`), as pairs. */
export function changes(details: Record<string, unknown>): { field: string; before: string; after: string }[] {
  const before = details.before
  const after = details.after
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return []
  const fields = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...fields].map((field) => ({
    field: humanize(field),
    before: show((before as Record<string, unknown>)[field]),
    after: show((after as Record<string, unknown>)[field]),
  }))
}

/** The other details of an entry as label and text, e.g. "Method: well-known file". */
export function otherDetails(details: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(details)
    .filter(([key]) => key !== "before" && key !== "after")
    .map(([key, value]) => ({ label: humanize(key), value: show(value) }))
}

// Names of the fields and values that the entries' details use, in words for people; any other
// name is shown with its underscores as spaces.
const NAMES: Record<string, string> = {
  chain_verified: "Hash chain verified",
  checked: "Checked at",
  dns_txt_record: "DNS TXT record",
  endpoint_url: "Endpoint URL",
  local_models_only: "Local models only",
  max_request_rate: "Maximum request rate",
  mfa_required: "Two-step verification required",
  rag_application: "RAG application",
  request_format: "Request format",
  tool_using_agent: "Tool-using agent",
  well_known_file: "Well-known file",
}

function humanize(key: string): string {
  return NAMES[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.map(show).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return typeof value === "string" && NAMES[value] ? NAMES[value] : String(value)
}
