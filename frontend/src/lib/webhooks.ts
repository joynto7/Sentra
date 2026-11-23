import { apiFetch } from "@/lib/api"

/** inactive (its test event is not confirmed yet), active, paused, or disabled by Sentra (6a1). */
export type WebhookStatus = "inactive" | "active" | "paused" | "disabled"

/** One event on its way to one webhook ("Recent deliveries" of Screen 57). */
export type WebhookDelivery = {
  id: string
  event: string
  /** The summary that was sent: an event, a line of text and a link. Never evidence or secrets. */
  payload: Record<string, unknown>
  attempts: number
  status_code: number | null
  duration_ms: number | null
  error: string | null
  delivered_at: string | null
  created_at: string
}

export type Webhook = {
  id: string
  name: string
  url: string
  events: string[]
  status: WebhookStatus
  verified_at: string | null
  secret_created_at: string
  /** The secret has been in use for over a year; only a hint, nothing is enforced. */
  secret_is_old: boolean
  failures: number
  disabled_at: string | null
  created_at: string
  created_by: string | null
  last_delivery: WebhookDelivery | null
}

export type EventOption = { key: string; label: string }
export type WebhookList = { webhooks: Webhook[]; events: EventOption[] }
export type WebhookCreated = { webhook: Webhook; secret: string }
export type WebhookSecret = { secret: string; webhook: Webhook }
/** What the receiving system answered to the test event (UC-9.7 step 4 and 4a1). */
export type WebhookTest = {
  ok: boolean
  message: string
  webhook: Webhook
  delivery: WebhookDelivery
}

const URL = "/v1/webhooks"

export const listWebhooks = () => apiFetch<WebhookList>(URL)

export const addWebhook = (data: { name: string; url: string; events: string[] }) =>
  apiFetch<WebhookCreated>(URL, { method: "POST", body: JSON.stringify(data) })

export const testWebhook = (id: string) =>
  apiFetch<WebhookTest>(`${URL}/${id}/test`, { method: "POST" })

export const changeWebhook = (
  id: string,
  data: { name?: string; url?: string; events?: string[]; status?: WebhookStatus },
) => apiFetch<Webhook>(`${URL}/${id}`, { method: "PATCH", body: JSON.stringify(data) })

export const rotateWebhookSecret = (id: string) =>
  apiFetch<WebhookSecret>(`${URL}/${id}/secret`, { method: "POST" })

export const removeWebhook = (id: string) => apiFetch<void>(`${URL}/${id}`, { method: "DELETE" })

export const webhookDeliveries = (id: string) =>
  apiFetch<WebhookDelivery[]>(`${URL}/${id}/deliveries`)

/** What each state means on the page, in the words of UC-9.7. */
export const STATUS_LABELS: Record<WebhookStatus, string> = {
  inactive: "Not confirmed",
  active: "Active",
  paused: "Paused",
  disabled: "Disabled after repeated failures",
}

/** How a delivery went, for the status chip of a row. */
export const deliveryState = (delivery: WebhookDelivery): "ok" | "failed" | "trying" => {
  if (delivery.delivered_at) return "ok"
  return delivery.error && delivery.attempts >= 4 ? "failed" : "trying"
}
