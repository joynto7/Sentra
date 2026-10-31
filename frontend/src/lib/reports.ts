import { API_URL, apiFetch } from "@/lib/api"

/** UC-9.1 step 1: for whom the report is written. */
export type ReportType = "executive" | "technical"
/** Step 2: what it covers. */
export type ReportScope = "organization" | "target" | "campaign_run"
export type ReportFormat = "pdf" | "json"
/** generating, ready, empty (5a1: no results in the scope) or failed. */
export type ReportStatus = "generating" | "ready" | "empty" | "failed"
/** UC-9.2 step 2: when the next report is produced. */
export type Frequency = "after_each_run" | "weekly" | "monthly"
export type ScheduleStatus = "active" | "paused"

export const TYPE_LABEL: Record<ReportType, string> = {
  executive: "Executive",
  technical: "Technical",
}

export const TYPE_DESCRIPTION: Record<ReportType, string> = {
  executive: "Risk summary, trends and what to do first, in plain language.",
  technical: "Every finding with its evidence, reproducibility and remediation status.",
}

export const STATUS_LABEL: Record<ReportStatus, string> = {
  generating: "Generating",
  ready: "Ready",
  empty: "No results",
  failed: "Failed",
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  after_each_run: "After every campaign run",
  weekly: "Weekly",
  monthly: "Monthly, on the 1st",
}

export type Report = {
  id: string
  code: string
  title: string
  type: ReportType
  scope: ReportScope
  target: string | null
  campaign_run: string | null
  category: string | null
  period_from: string | null
  period_to: string | null
  format: ReportFormat
  status: ReportStatus
  message: string | null
  summary: { findings?: number; unconfirmed?: number }
  /** SHA-256 of the file, shown beside the download. */
  checksum: string | null
  size_bytes: number | null
  requested_by: string | null
  schedule: string | null
  created_at: string
  finished_at: string | null
}

/** A member who may receive a scheduled report; the address is what Screen 53 matches a typed
 * one against (UC-9.2, 3a1). A schedule's own recipients carry the name only. */
export type Recipient = { id: string; name: string; email?: string | null }

export type Schedule = {
  id: string
  name: string
  type: ReportType
  scope: ReportScope
  target: string | null
  category: string | null
  period_days: number | null
  format: ReportFormat
  frequency: Frequency
  status: ScheduleStatus
  recipients: Recipient[]
  created_by: string | null
  created_at: string
  next_run_at: string | null
  last_run_at: string | null
}

export type ReportList = {
  rows: Report[]
  schedules: Schedule[]
  members: Recipient[]
}

export type ScopeOptions = {
  targets: { id: string; name: string }[]
  campaign_runs: { id: string; code: string; target_id: string }[]
}

export type ReportRequest = {
  type: ReportType
  scope: ReportScope
  format: ReportFormat
  target_id?: string | null
  campaign_run_id?: string | null
  period_days?: number | null
  category?: string | null
}

export type ScheduleRequest = ReportRequest & {
  name: string
  frequency: Frequency
  recipient_ids: string[]
}

const base = "/v1/reports"

export const listReports = (signal?: AbortSignal) => apiFetch<ReportList>(base, { signal })

export const getReport = (code: string, signal?: AbortSignal) =>
  apiFetch<Report>(`${base}/${encodeURIComponent(code)}`, { signal })

/** UC-9.1 steps 1-4: a worker writes it; the page follows the report's own status. */
export const generateReport = (data: ReportRequest) =>
  apiFetch<Report>(base, { method: "POST", body: JSON.stringify(data) })

export const scopeOptions = (signal?: AbortSignal) =>
  apiFetch<ScopeOptions>(`${base}/_filters/options`, { signal })

export const createSchedule = (data: ScheduleRequest) =>
  apiFetch<Schedule>(`${base}/schedules`, {
    method: "POST",
    body: JSON.stringify(data),
  })

export const changeSchedule = (
  id: string,
  data: Partial<{
    name: string
    recipient_ids: string[]
    frequency: Frequency
    status: ScheduleStatus
  }>,
) =>
  apiFetch<Schedule>(`${base}/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })

export const deleteSchedule = (id: string) =>
  apiFetch<null>(`${base}/schedules/${id}`, { method: "DELETE" })

export const runSchedule = (id: string) =>
  apiFetch<Report>(`${base}/schedules/${id}/run`, { method: "POST" })

/** The download goes straight to the API, so the file never passes through the page's state. */
export const downloadUrl = (code: string) =>
  `${API_URL}${base}/${encodeURIComponent(code)}/download`
