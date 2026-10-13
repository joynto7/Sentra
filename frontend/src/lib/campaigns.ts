import { apiFetch } from "@/lib/api"

/** Types and API calls for campaigns (M5, FR-5.1). */

export type CampaignTarget = {
  id: string
  name: string
  type: string
  environment: string
  status: string
  max_request_rate: number
}

export type CampaignItem = {
  code: string
  name: string
  target: CampaignTarget | null
  suite_count: number
  attempt_budget: number
  request_rate: number
  approval_status: string
  created_by: string | null
  created_at: string
}

/** UC-5.1 step 6: the tests that will run against the target and the attempts they need. */
export type Estimate = {
  tests: number
  skipped: number
  estimated_attempts: number
  target_safe_rate: number | null
  threat_model: boolean
  warnings: string[]
}

export type CampaignDetail = CampaignItem & {
  adaptive_agent: boolean
  repetitions: number
  window_start: string | null
  window_end: string | null
  time_zone: string
  suites: { code: string; found: boolean; name: string; version: number; test_count: number }[]
  estimate: Estimate
}

export type CampaignInput = {
  name: string
  target_id: string | null
  suites: string[]
  adaptive_agent: boolean
  attempt_budget: number | null
  request_rate: number | null
  repetitions: number | null
  window_start: string | null
  window_end: string | null
  time_zone: string
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) })

export const listCampaigns = (params?: URLSearchParams) =>
  apiFetch<CampaignItem[]>(`/v1/campaigns${params?.size ? `?${params}` : ""}`)
export const getCampaign = (code: string) => apiFetch<CampaignDetail>(`/v1/campaigns/${encodeURIComponent(code)}`)
export const estimateCampaign = (input: { target_id: string | null; suites: string[]; attempt_budget: number | null }) =>
  apiFetch<Estimate>("/v1/campaigns/estimate", post(input))
export const createCampaign = (input: CampaignInput) => apiFetch<CampaignDetail>("/v1/campaigns", post(input))

export const formatCount = (value: number) => value.toLocaleString("en-US")

/** "02:00–05:00 (Asia/Dhaka)", or "Any time" without a window. */
export function windowText(start: string | null, end: string | null, timeZone: string): string {
  return start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)} (${timeZone})` : "Any time"
}
