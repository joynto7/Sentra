/**
 * Device-local drafts of the two integration dialogs, limited to what is safe to keep in a browser.
 *
 * What is never kept, by construction: the password of the key dialog, the key itself, the
 * signing secret, and the webhook's address (an address can carry a token in its path or query).
 * `sanitize*` copies an allow-list of fields out of whatever was stored, so a draft that was
 * tampered with, or written by an older version, cannot bring anything else back.
 */

export type KeyDraft = { name: string; purpose: string; scopes: string[]; target_ids: string[]; expires: string }
export type WebhookDraft = { name: string; events: string[] }

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [])
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "")

export function sanitizeKeyDraft(raw: unknown): KeyDraft | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return { name: text(r.name, 80), purpose: text(r.purpose, 300), scopes: strings(r.scopes), target_ids: strings(r.target_ids), expires: text(r.expires, 10) }
}

export function sanitizeWebhookDraft(raw: unknown): WebhookDraft | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return { name: text(r.name, 120), events: strings(r.events) }
}

export const integrationDraftKey = (kind: "api-key" | "webhook", userId: string, organizationId: string) =>
  `sentra:integration-draft:v1:${kind}:${userId}:${organizationId}`

export type StoredDraft<T> = { value: T; savedAt: string }

export function readIntegrationDraft<T>(key: string, sanitize: (raw: unknown) => T | null): StoredDraft<T> | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as { value?: unknown; savedAt?: unknown } | null
    const value = sanitize(parsed?.value)
    return value && typeof parsed?.savedAt === "string" ? { value, savedAt: parsed.savedAt } : null
  } catch {
    return null
  }
}

/** The time it was kept, or null when the browser refused (blocked or full storage): never reported as saved. */
export function writeIntegrationDraft<T>(key: string, value: T): string | null {
  try {
    const savedAt = new Date().toISOString()
    window.localStorage.setItem(key, JSON.stringify({ value, savedAt }))
    return savedAt
  } catch {
    return null
  }
}

export function clearIntegrationDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* nothing was kept, nothing to remove */
  }
}

/** A draft with nothing in it is not worth keeping or offering. */
export const keyDraftIsEmpty = (d: KeyDraft) => !d.name.trim() && !d.purpose.trim() && d.scopes.length === 0 && d.target_ids.length === 0
export const webhookDraftIsEmpty = (d: WebhookDraft) => !d.name.trim() && d.events.length === 0
