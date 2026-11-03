import { apiFetch } from "@/lib/api"
import type { TargetType } from "@/lib/targets"

/** Screen 65: the Security Lab (FR-11.1, FR-11.2). Lab targets run in an isolated zone with
 * synthetic data and belong to one organization only (NFR-3.3). */
export type LabState = "deploying" | "ready" | "resetting" | "not_ready"

export type LabCard = {
  key: string
  name: string
  about: string
  /** The target type, as M2 names it */
  type: TargetType
  /** What the host needs for it (UC-11.1, 2a) */
  memory_mb: number
  minutes: number
  deployed: boolean
  target_id: string | null
  state: LabState | null
  /** "Deploying", "Ready", "Resetting" or "Not ready" */
  state_label: string
  /** The target's own status (UC-2.3) */
  status: string | null
  vulnerabilities: number
  categories: string[]
  canaries: number
  last_reset_at: string | null
  resets: number
  last_error: string | null
  /** The campaign run that is using it (UC-11.2, 1a) */
  active_run: string | null
}

export type Lab = { cards: LabCard[]; isolation: string }

export type KnownVulnerability = {
  id: string
  title: string
  /** The OWASP LLM category, e.g. "LLM01" */
  category: string
  description: string
}

const URL = "/lab"

export const securityLab = (signal?: AbortSignal) => apiFetch<Lab>(`/v1${URL}`, { signal })

/** UC-11.1: one action claims the lab target for the organization, verifies it and tests it. */
export const deployLabTarget = (key: string) =>
  apiFetch<LabCard>(`/v1${URL}/targets/${key}/deploy`, { method: "POST" })

/** UC-11.2: back to the original state, with new canary tokens. */
export const resetLabTarget = (targetId: string) =>
  apiFetch<LabCard>(`/v1${URL}/targets/${targetId}/reset`, { method: "POST" })

export const knownVulnerabilities = (targetId: string) =>
  apiFetch<KnownVulnerability[]>(`/v1${URL}/targets/${targetId}/vulnerabilities`)

/** "512 MB", "6 GB" — what the host needs, as the helper under Deploy says it. */
export const memory = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`)
