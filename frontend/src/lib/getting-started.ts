import { apiFetch } from "@/lib/api"

/** Screen 07: which of the five first steps are done (UC-1.6 step 6, NFR-4.1). */
export type FirstSteps = {
  organization: string
  created_at: string
  created_by: string | null
  members: number
  open_invitations: number
  /** The first target registered (step 3) */
  first_target: { id: string; name: string } | null
  /** The target to verify next (step 4) */
  unverified_target: { id: string; name: string } | null
  /** The target for the first campaign (step 5) */
  verified_target: { id: string; name: string } | null
  campaign_run_finished: boolean
  done: ("organization" | "team" | "target" | "verification" | "campaign_run")[]
}

export function getFirstSteps() {
  return apiFetch<FirstSteps>("/v1/organizations/current/getting-started")
}
