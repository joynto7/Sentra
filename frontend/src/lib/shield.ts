import { apiFetch } from "@/lib/api"

/** Where a gateway sits in the traffic (UC-8.1 step 1). */
export type GatewayPosition = "in_front" | "before_model"

/** What Sentra knows about a gateway (UC-8.1 steps 4-6, FR-10.6). */
export type GatewayStatus = "pending" | "not_in_path" | "active" | "not_reporting" | "revoked"

export type Gateway = {
  id: string
  target_id: string
  target_name: string
  target_environment: string
  position: GatewayPosition
  position_label: string
  status: GatewayStatus
  status_label: string
  credential_prefix: string
  gateway_version: string | null
  /** What the gateway adds to a request, as it measures itself (NFR-1.5, median of its window). */
  added_latency_ms: number | null
  requests_seen: number
  requests_blocked: number
  requests_changed: number
  retrieval_sightings: Record<string, number>
  /** The policy version the gateway says it is enforcing. */
  policy_version: number
  /** The version Sentra says is active for this target, and since when. */
  active_policy_version: number | null
  active_policy_since: string | null
  in_traffic_path: boolean
  connected_at: string | null
  last_contact_at: string | null
  created_at: string
}

export type TargetRef = { id: string; name: string }

export type GatewayList = {
  rows: Gateway[]
  targets_without_gateway: TargetRef[]
  heartbeat_seconds: number
}

/** UC-8.1 step 2: the one answer that carries the gateway credential. */
export type GatewaySecret = { gateway: Gateway; credential: string }

/** Step 5: what the harmless test request has proved so far (5a1 when it never arrives). */
export type GatewayCheck = {
  gateway: Gateway
  seen: boolean
  waiting: boolean
  message: string | null
}

export type PolicyRule = {
  id: string
  kind: "text_guardrail" | "tool_approval" | "retrieval_report" | "system_prompt"
  label: string
  title: string
  /** What the gateway does with it, in one line. */
  says: string
  note: string | null
  finding: string | null
  fix: number | null
}

export type PolicyState = "scheduled" | "pending" | "active" | "superseded" | "rolled_back" | "failed"

export type PolicyVersion = {
  version: number
  state: PolicyState
  state_label: string
  source: "remediation" | "rollback" | "disabled"
  rule_count: number
  carried_over: number
  rules: PolicyRule[]
  trigger_finding: string | null
  trigger_version: number | null
  based_on_version: number | null
  approved_by: string | null
  deployed_by: string | null
  deploy_at: string | null
  offered_at: string | null
  confirmed_at: string | null
  failure_reason: string | null
  /** Why this version was rolled back to, or the policy switched off (UC-8.8). */
  reason: string | null
  rolled_back_from: number | null
  /** For a version a later rollback removed: the sentence written about it then. */
  rolled_back_reason: string | null
  rule_counts: { label: string; count: number }[]
  remediations: PolicyIncluded[]
  created_at: string
}

/** A remediation a version carries, as the pages name one: the finding and its proposal version. */
export type PolicyIncluded = {
  finding: string
  finding_title: string | null
  version: number
  fixes: number[]
}

/** An approved fix that is not in the policy yet, and what it would become in it. */
export type DeployableFix = {
  fix: number
  kind: string
  title: string
  becomes: string | null
  needs_terms: boolean
  reason: string | null
}

export type Deployable = {
  finding: string
  finding_title: string
  version: number
  fixes: DeployableFix[]
}

export type PolicyPage = {
  target_id: string
  target_name: string
  gateway: Gateway | null
  active: PolicyVersion | null
  waiting: PolicyVersion | null
  versions: PolicyVersion[]
  deployable: Deployable[]
}

/** The terms a guardrail matches, which a person writes (UC-8.4 step 1). */
export type GuardrailTerms = {
  fix: number
  applies_to: "input" | "output"
  action: "block" | "mask"
  terms: string[]
  message: string | null
}

export type DeployPayload = {
  finding_code: string
  version?: number | null
  guardrails: GuardrailTerms[]
  at?: string | null
}

export type DeployResult = {
  policy: PolicyVersion
  /** 6a: the fixes that stay the developer's work, with the reason. */
  open_in_application: { fix: number; title: string; reason: string }[]
}

/** What a rollback would do, before anybody confirms it (UC-8.8 step 2). */
export type RollbackConsequences = {
  from_version: number
  to_version: number | null
  disables: boolean
  rules_now: number
  rules_after: number
  rules_removed: number
  remediations_stopping: PolicyIncluded[]
  findings_reopening: string[]
  /** 4a: a gateway that isn't reporting applies the rollback when it comes back. */
  gateway_reachable: boolean
  window_seconds: number
}

export type RollbackResult = { policy: PolicyVersion; consequences: RollbackConsequences }

const base = "/v1/shield"

export const listGateways = (signal?: AbortSignal) => apiFetch<GatewayList>(base, { signal })

export const registerGateway = (targetId: string, position: GatewayPosition) =>
  apiFetch<GatewaySecret>(`${base}/targets/${targetId}`, {
    method: "POST",
    body: JSON.stringify({ position }),
  })

export const revokeGateway = (targetId: string) =>
  apiFetch<Gateway>(`${base}/targets/${targetId}/revoke`, { method: "POST" })

/** Step 5: send the harmless test request through the target's traffic. */
export const sendCheck = (targetId: string) =>
  apiFetch<GatewayCheck>(`${base}/targets/${targetId}/check`, { method: "POST" })

export const getCheck = (targetId: string, signal?: AbortSignal) =>
  apiFetch<GatewayCheck>(`${base}/targets/${targetId}/check`, { signal })

export const getPolicy = (targetId: string, signal?: AbortSignal) =>
  apiFetch<PolicyPage>(`${base}/targets/${targetId}/policy`, { signal })

export const deployPolicy = (targetId: string, data: DeployPayload) =>
  apiFetch<DeployResult>(`${base}/targets/${targetId}/policy`, {
    method: "POST",
    body: JSON.stringify(data),
  })

export const rollbackConsequences = (targetId: string, toVersion: number, signal?: AbortSignal) =>
  apiFetch<RollbackConsequences>(
    `${base}/targets/${targetId}/rollback?to_version=${toVersion}`,
    { signal },
  )

export const rollBack = (targetId: string, toVersion: number, reason: string) =>
  apiFetch<RollbackResult>(`${base}/targets/${targetId}/rollback`, {
    method: "POST",
    body: JSON.stringify({ to_version: toVersion, reason }),
  })

export const POSITION_LABEL: Record<GatewayPosition, string> = {
  in_front: "In front of the endpoint",
  before_model: "Between the app and its LLM provider",
}

/** The same two places inside a sentence ("Active · in front of the endpoint · …"). */
export const POSITION_PHRASE: Record<GatewayPosition, string> = {
  in_front: "in front of the endpoint",
  before_model: "between the app and its LLM provider",
}

/** What each position lets a gateway enforce (UC-8.1 step 1, FR-8.3). */
export const POSITION_DESCRIPTION: Record<GatewayPosition, string> = {
  in_front:
    "Enforces guardrail policies on the requests of your users and on the replies they get.",
  before_model:
    "Can also hold tool calls back, watch restricted knowledge sources and harden the system prompt, because the model traffic passes through it.",
}

/** A problem a person has to act on is said in words, never in colour alone (NFR-4.3). */
export const STATUS_IS_A_PROBLEM: Record<GatewayStatus, boolean> = {
  pending: true,
  not_in_path: true,
  active: false,
  not_reporting: true,
  revoked: true,
}

/**
 * How long ago something happened, in the words the pages use ("12 s ago", "6 min ago").
 * Anything older than a day is a date, because "31 h ago" is not how anybody reads a date.
 */
export function sinceNow(iso: string | null): string {
  if (!iso) return "never"
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** The command that runs a gateway in the target owner's own environment (Screen 48, step 2). */
export function runCommand({
  sentraUrl,
  credential,
  upstream,
  position,
  version,
}: {
  sentraUrl: string
  credential: string
  upstream: string
  position: GatewayPosition
  version: string
}): string {
  return [
    "docker run -d --name sentra-shield \\",
    `  -e SENTRA_URL=${sentraUrl} \\`,
    `  -e SENTRA_GATEWAY_TOKEN=${credential} \\`,
    `  -e SHIELD_UPSTREAM_URL=${upstream || "http://your-application:8080"} \\`,
    `  -e SHIELD_POSITION=${position} \\`,
    `  -p 8443:8443 sentra/shield:${version}`,
  ].join("\n")
}
