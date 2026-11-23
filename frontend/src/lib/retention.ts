import { apiFetch } from "@/lib/api"

/** One of the three kinds of data on Screen 60 (UC-10.7 step 1). */
export type RetentionKind = {
  days: number
  minimum: number
  maximum: number
  items: number
  bytes: number
}

/** What the last clean-up did (UC-10.8 step 6). */
export type RetentionRun = {
  started_at: string
  finished_at: string | null
  evidence_deleted: number
  evidence_bytes: number
  attempts_deleted: number
  reports_deleted: number
  postponed: number
  failures: number
}

export type Retention = {
  evidence: RetentionKind
  campaign: RetentionKind
  reports: RetentionKind
  /** The organization has never set its own periods, so the platform's defaults apply. */
  using_defaults: boolean
  changed_by: string | null
  changed_at: string | null
  /** When the daily clean-up runs, as the page writes it, e.g. "01:00 UTC" */
  clean_up_at: string
  last_run: RetentionRun | null
  /** Not covered by any of the three periods (NFR-8.3) */
  audit_log_days: number
}

export type Periods = {
  evidence_days: number
  campaign_days: number
  report_days: number
}

/** Step 4: what the next clean-up would delete with periods nobody has saved yet. */
export type RetentionPreview = {
  evidence_items: number
  evidence_bytes: number
  attempts: number
  reports: number
  postponed: number
  /** 4a: the open findings whose evidence is among it. Their summaries are kept. */
  open_findings: string[]
}

/** The three kinds in the order Screen 60 shows them, with the words the page uses. */
export const KINDS = [
  {
    key: "evidence" as const,
    field: "evidence_days" as const,
    label: "Evidence",
    about: "The attempts, replies and documents that prove a finding.",
  },
  {
    key: "campaign" as const,
    field: "campaign_days" as const,
    label: "Campaign data",
    about: "The attempts of a campaign run and what each detection method found.",
  },
  {
    key: "reports" as const,
    field: "report_days" as const,
    label: "Reports",
    about: "The generated report files. Their findings stay in Sentra.",
  },
]

export const getRetention = (signal?: AbortSignal) =>
  apiFetch<Retention>("/v1/admin/retention", { signal })

export const previewRetention = (periods: Periods, signal?: AbortSignal) =>
  apiFetch<RetentionPreview>(
    `/v1/admin/retention/preview?${new URLSearchParams(
      Object.fromEntries(Object.entries(periods).map(([key, value]) => [key, String(value)])),
    )}`,
    { signal },
  )

/** UC-10.7 steps 3-6, confirmed with the password (NFR-3.5). Nothing is deleted by saving. */
export const saveRetention = (periods: Periods, password: string) =>
  apiFetch<Retention>("/v1/admin/retention", {
    method: "PUT",
    body: JSON.stringify({ ...periods, password }),
  })

/** How much is stored, as the page says it: "12.4 GB", "5.2 MB", "0 bytes". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} byte${bytes === 1 ? "" : "s"}`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Counts are read often on this page, so they always carry their thousands separators. */
export const formatCount = (count: number) => count.toLocaleString("en-GB")
