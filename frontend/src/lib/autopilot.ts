import { apiFetch } from "@/lib/api"

/** Types and API calls of the autopilot: one assessment of a verified target, from the threat model
 *  to the remediation proposals (it stops wherever a person has to decide). */

export type AutopilotStatus = "running" | "waiting" | "completed" | "failed" | "stopped"
export type AutopilotStage = "check" | "threat_model" | "campaign" | "run" | "remediation" | "done"
export type WaitingFor = "review_profile" | "approve_threat_model" | "approve_scope"

export const STATUS_LABEL: Record<AutopilotStatus, string> = {
  running: "Working",
  waiting: "Waiting for you",
  completed: "Finished",
  failed: "Stopped by a problem",
  stopped: "Stopped",
}

/** The stages in the order they happen, with the words a person reads. */
export const STAGES: { stage: AutopilotStage; label: string; what: string }[] = [
  { stage: "check", label: "Check the target", what: "It is verified and its profile is reviewed." },
  { stage: "threat_model", label: "Threat model", what: "Sentra's LLM suggests threats for this target, and you approve them." },
  { stage: "campaign", label: "Campaign", what: "A campaign of every test that applies, within the safe rate and a budget." },
  { stage: "run", label: "Run", what: "The tests are sent to the target and each reply is judged." },
  { stage: "remediation", label: "Remediation proposals", what: "A proposed fix is drafted for the most severe findings." },
]

export type Plan = {
  target_id: string
  target_name: string
  can_start: boolean
  reason: string | null
  tests: number
  repetitions: number
  attempt_budget: number
  request_rate: number
  estimated_minutes: number
  llm_cost: { judged_attempts: number; low_usd: string | null; high_usd: string | null }
  requires_scope_approval: boolean
  has_approved_threat_model: boolean
  has_reviewed_profile: boolean
  warnings: string[]
}

export type Step = { stage: AutopilotStage; at: string; text: string }

export type Summary = {
  findings: number
  by_severity: Record<string, number>
  proposals: number
  campaign: string
  run_number: number
  finding_codes: string[]
}

/** What the page shows while it works, read from the records on the server. */
export type Progress = {
  run_status: string | null
  attempts_planned: number
  attempts_sent: number
  attempt_budget: number
  findings: number
  by_severity: Record<string, number>
  proposals: number
  proposals_total: number
}

export type Autopilot = {
  id: string
  code: string
  target_id: string
  target_name: string
  status: AutopilotStatus
  stage: AutopilotStage
  waiting_for: WaitingFor | null
  message: string
  started_by: string | null
  created_at: string
  finished_at: string | null
  plan: Partial<Plan>
  steps: Step[]
  summary: Summary | null
  progress: Progress
  campaign_code: string | null
  run_number: number | null
  can_stop: boolean
}

export const ACTIVE: AutopilotStatus[] = ["running", "waiting"]

export const getPlan = (targetId: string, signal?: AbortSignal) =>
  apiFetch<Plan>(`/v1/autopilot/plan?target_id=${targetId}`, { signal })

export const startAutopilot = (targetId: string) =>
  apiFetch<Autopilot>("/v1/autopilot", { method: "POST", body: JSON.stringify({ target_id: targetId }) })

export const listAutopilot = (signal?: AbortSignal) => apiFetch<Autopilot[]>("/v1/autopilot", { signal })

export const getAutopilot = (id: string, signal?: AbortSignal) =>
  apiFetch<Autopilot>(`/v1/autopilot/${id}`, { signal })

/** Does the next step now; the page calls it while an assessment is on. */
export const refreshAutopilot = (id: string, signal?: AbortSignal) =>
  apiFetch<Autopilot>(`/v1/autopilot/${id}/refresh`, { method: "POST", signal })

export const stopAutopilot = (id: string) => apiFetch<Autopilot>(`/v1/autopilot/${id}/stop`, { method: "POST" })

/** The page where a person does what the autopilot waits for. */
export function waitingLink(run: Autopilot): { href: string; label: string } | null {
  switch (run.waiting_for) {
    case "review_profile":
      return { href: `/targets/${run.target_id}/profile`, label: "Review the target profile" }
    case "approve_threat_model":
      return { href: `/threat-models/${run.target_id}`, label: "Review the threat model" }
    case "approve_scope":
      return run.campaign_code
        ? { href: `/campaigns/${run.campaign_code}/approval`, label: "Open the scope approval" }
        : null
    default:
      return null
  }
}
