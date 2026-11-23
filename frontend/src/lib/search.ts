import { apiFetch } from "@/lib/api"
import type { Severity } from "@/components/sentra/severity-badge"
import type { Environment, TargetStatus, TargetType } from "@/lib/targets"

/** The search of the top bar. The answers carry only what the list pages show every member. */
export type TargetHit = {
  id: string
  name: string
  type: TargetType
  environment: Environment
  status: TargetStatus
  endpoint_host: string
}

export type FindingHit = {
  code: string
  title: string
  severity: Severity
  status: string
  target_name: string
}

export type CampaignHit = {
  code: string
  name: string
  target_name: string
  run_number: number | null // set when the words were a run's code, such as R-231-4
}

type Hits<T> = { total: number; items: T[] }

export type SearchResults = {
  targets: Hits<TargetHit>
  findings: Hits<FindingHit>
  campaigns: Hits<CampaignHit>
}

export const MIN_SEARCH_LENGTH = 2

/** A POST, so that what people search for stays out of addresses and access logs. */
export const search = (q: string, signal: AbortSignal) =>
  apiFetch<SearchResults>("/v1/search", { method: "POST", body: JSON.stringify({ q }), signal })

/** Where a campaign hit leads: to the run when the words were a run's code. */
export function campaignHref(hit: CampaignHit): string {
  return hit.run_number === null ? `/campaigns/${hit.code}` : `/campaigns/${hit.code}/runs/${hit.run_number}`
}

/** What a campaign hit is called: R-231-4 for a run, C-231 for a campaign. */
export function campaignLabel(hit: CampaignHit): string {
  return hit.run_number === null ? hit.code : `${hit.code.replace("C-", "R-")}-${hit.run_number}`
}
