import type { Severity } from "@/components/sentra/severity-badge"
import { apiFetch } from "@/lib/api"
import type { FindingStatus } from "@/lib/findings"

/** The five kinds of fix FR-8.1 names. */
export type FixKind =
  "system_prompt" | "guardrail" | "tool_policy" | "retrieval_isolation" | "code_change"

/** Where a fix takes effect (UC-8.2 step 6): a Sentra Shield gateway, or the application itself. */
export type Enforcement = "gateway" | "application"

/** The lifecycle of a proposal (report, Figure 2.7). FR-8.1 writes drafts; the rest comes with
 * FR-8.2 to FR-8.5. */
export type RemediationStatus =
  "draft" | "awaiting_approval" | "rejected" | "approved" | "applying" | "effective" | "ineffective"

export const STATUS_LABEL: Record<RemediationStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  rejected: "Rejected",
  approved: "Approved",
  applying: "Applying",
  effective: "Effective",
  ineffective: "Ineffective",
}

/** What a fix of this kind holds, which is what the card shows under it. */
export const DETAIL_KEY: Record<FixKind, string> = {
  system_prompt: "prompt",
  guardrail: "rules",
  tool_policy: "tools",
  retrieval_isolation: "sources",
  code_change: "steps",
}

export const DETAIL_TITLE: Record<FixKind, string> = {
  system_prompt: "What the system prompt says",
  guardrail: "The rules",
  tool_policy: "The tool rules",
  retrieval_isolation: "The sources",
  code_change: "The steps",
}

export type FindingRef = {
  id: string
  code: string
  title: string
  severity: Severity
  status: FindingStatus
  category: string
  component: string
  test_code: string
  target_id: string
  target_name: string
}

export type Fix = {
  position: number
  kind: FixKind
  kind_label: string
  title: string
  description: string
  details: Record<string, unknown>
  enforcement: Enforcement
  /** Why it has to be made in the application although a gateway could carry it (6a). */
  enforcement_note: string | null
}

export type VersionSummary = {
  version: number
  status: RemediationStatus
  /** How the version came about: Sentra wrote it, Sentra revised it, or a person adapted it. */
  origin: "generated" | "revised" | "edited"
  based_on_version: number | null
  ai_generated: boolean
  created_at: string
  requested_by: string | null
  /** Who adapted this version (UC-8.3 step 2); they may not approve it (4a). */
  edited_by: string | null
  decided_by: string | null
  decided_at: string | null
  /** Why it was rejected (UC-8.3, 5a1). */
  decision_reason: string | null
  fix_count: number
  /** The kinds of fix it recommends and where each takes effect, for the list of Screen 45. */
  fixes_in_short: { kind: FixKind; kind_label: string; enforcement: Enforcement }[]
}

export type RemediationVersion = VersionSummary & {
  root_cause: string
  summary: string
  model: string | null
  /** Fixes the model proposed that Sentra could not use (UC-8.2 step 5). */
  dropped: number
  /** Why it holds the test's recommended mitigation only (4a, 4b). */
  mitigation_only: string | null
  fixes: Fix[]
}

export type RemediationJob = {
  id: string
  status: "queued" | "running" | "done" | "failed"
  trigger: "requested" | "revision"
  requested_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  version: number | null
  message: string | null
}

/** One message of the review thread (UC-8.3), with the version it was written on. */
export type RemediationComment = {
  id: string
  version: number
  author: string | null
  text: string
  created_at: string
}

/** What the person reading Screen 46 may do with the newest version, and what approval starts. */
export type Review = {
  can_edit: boolean
  can_submit: boolean
  can_approve: boolean
  cannot_approve: string | null
  approvers: string[]
  on_approval: string[]
}

export type RemediationPage = {
  finding: FindingRef
  blocker: string | null
  blocker_code: string | null
  job: RemediationJob | null
  versions: VersionSummary[]
  current: RemediationVersion | null
  review: Review
  comments: RemediationComment[]
}

/** A fix the person keeps, with what they changed about it (UC-8.3 step 2). */
export type FixEdit = {
  position: number
  title: string
  description: string
  details: Record<string, unknown>
}

export type RemediationRow = {
  finding: FindingRef
  latest: VersionSummary | null
  job: RemediationJob | null
  blocker: string | null
  blocker_code: string | null
}

export type RemediationList = {
  rows: RemediationRow[]
  /** Proposals that await a person, and confirmed findings that have none yet. */
  drafts: number
  without_proposal: number
}

const base = "/v1/remediations"

/** Screen 45: the confirmed findings and their proposals, the most severe first. */
export const listRemediations = (signal?: AbortSignal) =>
  apiFetch<RemediationList>(base, { signal })

/** Screen 46: one version of a finding's proposal, the newest by default. */
export const getRemediation = (code: string, version?: number, signal?: AbortSignal) =>
  apiFetch<RemediationPage>(
    `${base}/${encodeURIComponent(code)}${version ? `?version=${version}` : ""}`,
    { signal },
  )

/** UC-8.2 step 1: a developer or an analyst asks for a proposal; a worker writes it. */
export const requestRemediation = (code: string) =>
  apiFetch<RemediationJob>(`${base}/${encodeURIComponent(code)}/generate`, { method: "POST" })

export const getRemediationJob = (code: string, id: string, signal?: AbortSignal) =>
  apiFetch<RemediationJob>(`${base}/${encodeURIComponent(code)}/jobs/${id}`, { signal })

/** UC-8.3 steps 2-3: the person's version of the proposal, which asks for approval at once. */
export const adaptRemediation = (
  code: string,
  version: number,
  data: { root_cause: string; summary: string; fixes: FixEdit[] },
) =>
  apiFetch<VersionSummary>(`${base}/${encodeURIComponent(code)}/versions?version=${version}`, {
    method: "POST",
    body: JSON.stringify(data),
  })

/** Step 3 for a draft that needs no change. */
export const submitRemediation = (code: string, version: number) =>
  apiFetch<VersionSummary>(`${base}/${encodeURIComponent(code)}/versions/${version}/submit`, {
    method: "POST",
  })

/** Steps 5-6: only a person approves, and never the person who adapted the version (4a). */
export const approveRemediation = (code: string, version: number) =>
  apiFetch<VersionSummary>(`${base}/${encodeURIComponent(code)}/versions/${version}/approve`, {
    method: "POST",
  })

/** 5a1: the version is kept with the reason it was rejected for. */
export const rejectRemediation = (code: string, version: number, reason: string) =>
  apiFetch<VersionSummary>(`${base}/${encodeURIComponent(code)}/versions/${version}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })

export const commentOnRemediation = (code: string, version: number, text: string) =>
  apiFetch<RemediationComment>(`${base}/${encodeURIComponent(code)}/comments`, {
    method: "POST",
    body: JSON.stringify({ version, text }),
  })
