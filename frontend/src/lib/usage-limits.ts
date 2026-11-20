import { apiFetch } from "@/lib/api"

/** Screen 61: every organization's usage this month against its monthly limits (FR-10.4,
 * UC-10.6). Usage and limits only — never an organization's content (NFR-3.3). */
export type LimitKind = "campaign_runs" | "attempts" | "llm_cost"

export type Limit = {
  kind: LimitKind
  label: string
  /** A count, or the cost in USD */
  used: string
  limit: string
  percent: number
  reached: boolean
  /** At or above the warning threshold, but not reached */
  warning: boolean
  /** A Platform Administrator set this limit; otherwise it is the platform's default */
  custom: boolean
  /** When the organization was warned about this limit this month (UC-10.6 step 5) */
  warned_at: string | null
}

export type OrganizationUsage = {
  id: string
  name: string
  slug: string
  members: number
  warn_percent: number
  warn_percent_custom: boolean
  limits: Limit[]
  status: "active" | "limited"
  /** "1 December": when the month's usage starts again */
  next_month: string
}

export type UsageOverview = {
  organizations: OrganizationUsage[]
  defaults: Record<LimitKind, string>
  warn_percent_default: number
  notice: string
  warn_at: string
}

export type NewLimits = {
  campaign_runs: number
  attempts: number
  llm_cost_usd: string
  warn_percent: number
  /** UC-10.6, 2a1: the consequence of a limit below this month's usage has been read */
  confirmed?: boolean
}

const URL = "/v1/admin/platform/organizations"

export const usageOverview = (signal?: AbortSignal) => apiFetch<UsageOverview>(URL, { signal })

export const setLimits = (organizationId: string, data: NewLimits) =>
  apiFetch<OrganizationUsage>(`${URL}/${organizationId}/limits`, {
    method: "PUT",
    body: JSON.stringify(data),
  })

export const limitOf = (organization: OrganizationUsage, kind: LimitKind) =>
  organization.limits.find((limit) => limit.kind === kind)!

/** "18,400", "$492.00" — a limit's amount in the unit it is counted in. */
export function amount(kind: LimitKind, value: string | number): string {
  const number = Number(value)
  if (kind === "llm_cost") {
    return `$${number.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return number.toLocaleString("en-GB")
}

/** "12 / 40", as the table shows a limit. */
export const against = (limit: Limit) => `${amount(limit.kind, limit.used)} / ${amount(limit.kind, limit.limit)}`
