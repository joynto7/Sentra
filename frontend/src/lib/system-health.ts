import { apiFetch } from "@/lib/api"

/** Screen 63: how every component of Sentra is doing (FR-10.6, UC-10.9). Operational data only —
 * never an organization's content (NFR-3.3). */
export type ComponentStatus = "operational" | "warning" | "alert" | "unknown"

export type HealthComponent = {
  key: string
  label: string
  status: ComponentStatus
  /** What the card says about it, e.g. "p95 220 ms · p50 90 ms" */
  lines: string[]
}

export type Alert = {
  id: string
  component: string
  component_label: string
  kind: string
  summary: string
  /** What it means for the people using Sentra */
  effect: string
  opened_at: string
  last_seen_at: string
  /** How often the Monitoring component saw the same cause again */
  repeats: number
  closed_at: string | null
  closed_automatically: boolean
}

export type Thresholds = {
  queue_length: number
  error_rate_percent: number
  worker_load_percent: number
  storage_percent: number
  gateway_silence_minutes: number
  /** Set by a Platform Administrator, instead of the platform's defaults */
  custom: boolean
  updated_at: string | null
  set_by: string | null
}

export type SystemHealth = {
  status: ComponentStatus
  headline: string
  components: HealthComponent[]
  open_alerts: Alert[]
  history: Alert[]
  thresholds: Thresholds
  /** Empty when the operator has configured none (UC-10.9 step 5) */
  grafana_url: string
  logs_url: string
  notice: string
}

export type NewThresholds = {
  queue_length: number
  error_rate_percent: number
  worker_load_percent: number
  storage_percent: number
  gateway_silence_minutes: number
}

const URL = "/v1/admin/platform/health"

export const systemHealth = (signal?: AbortSignal) => apiFetch<SystemHealth>(URL, { signal })

/** UC-10.9 step 3: what the Monitoring component measures against, from the next tick on. */
export const setThresholds = (data: NewThresholds) =>
  apiFetch<SystemHealth>(`${URL}/thresholds`, { method: "PUT", body: JSON.stringify(data) })

/** "Operational", "Warning", "Alert", "Unknown" — the status in words, never colour alone. */
export const STATUS_LABEL: Record<ComponentStatus, string> = {
  operational: "Operational",
  warning: "Warning",
  alert: "Alert",
  unknown: "Unknown",
}

/** The closed alerts with repeats of the same cause combined, as the history shows them
 * ("LLM provider timeouts × 14 · closed automatically"). */
export function combined(history: Alert[]): { alert: Alert; times: number }[] {
  const byCause = new Map<string, { alert: Alert; times: number }>()
  for (const alert of history) {
    const key = `${alert.component}:${alert.kind}`
    const seen = byCause.get(key)
    if (seen) {
      seen.times += alert.repeats
      if (alert.closed_at && seen.alert.closed_at && alert.closed_at > seen.alert.closed_at) seen.alert = alert
    } else {
      byCause.set(key, { alert, times: alert.repeats })
    }
  }
  return [...byCause.values()]
}
