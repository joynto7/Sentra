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
  /** The verification of the version being read (UC-8.5, UC-8.6). */
  changes: ApplicationChange[]
  retests: RetestSummary[]
  /** What the proposal still waits for before a retest can start, in one sentence. */
  in_effect: string | null
}

/** One fix of an approved proposal that no gateway can carry (UC-8.5 step 1). */
export type ChangeStatus = "open" | "implemented"

export type ApplicationChange = {
  id: string
  finding: FindingRef
  /** The version of the proposal the fix belongs to, and its position in it. */
  version: number
  position: number
  title: string
  description: string
  status: ChangeStatus
  /** What the developer changed, and where it can be seen (step 3). */
  note: string | null
  link: string | null
  implemented_by: string | null
  implemented_at: string | null
  approved_by: string | null
  approved_at: string | null
  /** "1 of 2 fixes in effect (Shield Policy v5 active) · the retest can start". */
  progress: string
}

export type ChangeList = {
  rows: ApplicationChange[]
  open_changes: number
}

/** How far the retest of UC-8.6 has come. */
export type RetestStatus = "testing" | "checking" | "completed" | "failed" | "cancelled"
/** What the repeated attempts showed (step 5 and 5a). */
export type RetestVerdict = "closed" | "still_open" | "inconclusive"

export type RetestSummary = {
  id: string
  number: number
  version: number
  status: RetestStatus
  status_label: string
  verdict: RetestVerdict | null
  verdict_label: string | null
  running: boolean
  /** A rollback has taken what it proved out of the traffic again (UC-8.8). */
  out_of_date: boolean
  started_at: string
  finished_at: string | null
}

/** What became of one request of normal use (UC-8.6 step 4). */
export type BenignOutcome = "answered" | "blocked" | "changed" | "failed"
export type BenignReview = "pending" | "fine" | "needs_revision"

export type BenignCheck = {
  id: string
  position: number
  text: string
  outcome: BenignOutcome
  outcome_label: string
  what_happened: string | null
  reply: string | null
  status_code: number | null
  review: BenignReview
  review_label: string
  reviewed_by: string | null
  reviewed_at: string | null
}

/** One side of a comparison: how many of the repeated attempts succeeded, in counts and in words. */
export type AttackSuccess = {
  before_successes: number
  before_attempts: number
  before_rate: number | null
  before_words: string
  after_successes: number
  after_attempts: number
  after_rate: number | null
  after_words: string
}

export type NormalUse = {
  total: number
  blocked: number
  changed: number
  failed: number
  affected: number
  affected_rate: number | null
  affected_words: string
  /** 1a1: the target has no Benign Request Set of its own, so the comparison is less reliable. */
  generic_set: boolean
}

export type RiskChange = {
  before: number | null
  band_before: string | null
  after: number | null
  band_after: string | null
  change: number | null
}

/** The three comparison cards of Screen 51 (FR-8.5), each with its figures in words (NFR-4.3). */
export type Figures = {
  attack_success: AttackSuccess
  normal_use: NormalUse
  risk_score: RiskChange
}

export type Retest = RetestSummary & {
  finding: FindingRef
  /** What the comparison means, in plain language (NFR-4.2). */
  conclusion: string | null
  /** Why it couldn't run, or what a rollback did to it. */
  message: string | null
  /** The retest run it was measured in. It belongs to no campaign, so it has no page of its own. */
  run_code: string | null
  run_status: string | null
  test_code: string
  repetitions: number
  attempts_repeated: number
  policy_version: number | null
  changes_marked: number
  figures: Figures
  benign_checks: BenignCheck[]
  benign_generic: boolean
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
  /** Open application changes of the newest version (UC-8.5). */
  open_changes: number
  /** The newest retest of the finding (UC-8.6). */
  retest: RetestSummary | null
  /** Whether the person reading the page may decide this version (UC-8.3 step 4, and 4a). */
  can_approve: boolean
}

export type RemediationList = {
  rows: RemediationRow[]
  /** Proposals that await a person, and confirmed findings that have none yet. */
  drafts: number
  without_proposal: number
  /** The counts of the tabs of Screen 45, for the person reading it. */
  awaiting_me: number
  open_changes: number
  retesting: number
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

/** Screen 50: every change inside an application that a developer still has to make (UC-8.5). */
export const listOpenChanges = (signal?: AbortSignal) =>
  apiFetch<ChangeList>(`${base}/changes/open`, { signal })

/** UC-8.5 steps 3-5: what the developer changed. The retest follows when nothing is open (2b1). */
export const markImplemented = (
  code: string,
  changeId: string,
  data: { note: string; link?: string | null },
) =>
  apiFetch<ApplicationChange>(
    `${base}/${encodeURIComponent(code)}/changes/${changeId}/implemented`,
    { method: "POST", body: JSON.stringify(data) },
  )

/** Screen 51: the before-and-after comparison of a retest, the newest by default (UC-8.7). */
export const getRetest = (code: string, number?: number, signal?: AbortSignal) =>
  apiFetch<Retest>(
    `${base}/${encodeURIComponent(code)}/retest${number ? `?number=${number}` : ""}`,
    { signal },
  )

/** The failed end condition of UC-8.6: a retest that couldn't run is started again. */
export const startRetest = (code: string) =>
  apiFetch<Retest>(`${base}/${encodeURIComponent(code)}/retest`, { method: "POST" })

/** UC-8.7 step 3: "Looks fine" or "Needs revision" on a request of normal use the fix affected. */
export const reviewBenignCheck = (
  code: string,
  checkId: string,
  judgement: Exclude<BenignReview, "pending">,
) =>
  apiFetch<Retest>(`${base}/${encodeURIComponent(code)}/retest/benign/${checkId}`, {
    method: "POST",
    body: JSON.stringify({ judgement }),
  })
