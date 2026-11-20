import { apiFetch } from "@/lib/api"

/** One task of Sentra's AI and where the organization's data goes for it (UC-10.5 steps 1-2). */
export type LLMTaskRow = {
  task: string
  function: string
  model: string | null
  provider: string | null
  /** "external": the data leaves the platform; "local": a model on the platform; null: none */
  deployment: "external" | "local" | null
  receives: string
  requests_this_month: number
  /** A local model serves it, so it stays available with local models only. */
  local_model: boolean
  /** Available with the organization's current setting. */
  available: boolean
  /** What the function does without a model (UC-10.5, 4a1). */
  without_model: string
}

export type DataSharing = {
  local_models_only: boolean
  changed_by: string | null
  changed_at: string | null
  tasks: LLMTaskRow[]
  masking: string
}

export function getDataSharing() {
  return apiFetch<DataSharing>("/v1/admin/data-and-ai")
}

/** UC-10.5 steps 3-6 and 3a, confirmed with the password (NFR-3.5). */
export function setLocalModelsOnly(on: boolean, password: string) {
  return apiFetch<DataSharing>("/v1/admin/data-and-ai", {
    method: "PUT",
    body: JSON.stringify({ local_models_only: on, password }),
  })
}
