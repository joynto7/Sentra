import { apiFetch } from "@/lib/api"

/** What an integration may do with a key (UC-9.6 step 2). None of them touches members, roles or
 * other keys, so a leaked key can never take over the organization. */
export type ApiKeyScope =
  | "run_security_gate"
  | "read_gate_results"
  | "read_findings"
  | "read_reports"
  | "launch_campaigns"

/** active, expiring (within two weeks), expired or revoked. */
export type ApiKeyState = "active" | "expiring" | "expired" | "revoked"

export type TargetRef = { id: string; name: string }

export type ApiKey = {
  id: string
  name: string
  purpose: string
  /** The first characters of the key; the key itself is shown once and never stored (NFR-3.1). */
  prefix: string
  scopes: ApiKeyScope[]
  scope_labels: string[]
  targets: TargetRef[]
  created_by: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  revoked_by: string | null
  last_used_at: string | null
  state: ApiKeyState
}

export type ScopeOption = {
  value: ApiKeyScope
  label: string
  /** Whether an endpoint accepts it today; otherwise `waiting_for` says what it needs. */
  available: boolean
  waiting_for: string | null
}

export type ApiKeyList = { rows: ApiKey[]; scopes: ScopeOption[]; targets: TargetRef[] }

/** The one answer that holds the key itself (UC-9.6 step 4). */
export type ApiKeyCreated = ApiKey & { key: string }

export type NewApiKey = {
  name: string
  purpose: string
  scopes: ApiKeyScope[]
  target_ids: string[]
  expires_at: string
}

const base = "/v1/api-keys"

export const listApiKeys = (signal?: AbortSignal) => apiFetch<ApiKeyList>(base, { signal })

export const createApiKey = (data: NewApiKey) =>
  apiFetch<ApiKeyCreated>(base, { method: "POST", body: JSON.stringify(data) })

export const revokeApiKey = (id: string) =>
  apiFetch<ApiKey>(`${base}/${id}/revoke`, { method: "POST" })

export const STATE_LABEL: Record<ApiKeyState, string> = {
  active: "Active",
  expiring: "Expires soon",
  expired: "Expired",
  revoked: "Revoked",
}
