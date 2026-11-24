/**
 * Where a target's threat model stands, as five stages that are NOT the same thing: the profile it
 * is made from, its generation, its review, its approval and the recommendation that follows. A
 * generated model is a draft, never an approval; only an approved version drives recommendations.
 * Pure, so each state can be tested: it reads what the page already loaded and the person's right to
 * manage threat models (the API's permission table).
 */
export type StageState = "done" | "ready" | "waiting" | "blocked" | "working" | "upcoming"

export type Stage = {
  id: "profile" | "generation" | "review" | "approval" | "suites"
  title: string
  state: StageState
  detail: string
  /** The role that has to act when the stage is not done */
  who?: string
  href?: string
  action?: string
}

export type JourneyInput = {
  targetId: string
  blockerCode: "not_verified" | "profile_not_reviewed" | "target_archived" | null
  blocker: string | null
  job: { status: "queued" | "running" | "done" | "failed"; message: string | null } | null
  /** Newest first, as the API gives them */
  versions: { version: number; status: "draft" | "approved"; ai_generated: boolean; created_at: string; approved_at: string | null; approved_by: string | null }[]
  baselineOnly: boolean
  canManage: boolean
}

const ANALYST = "Security Analyst"
const DEVELOPER = "AI Application Developer"
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

export function threatModelStages(i: JourneyInput): Stage[] {
  const newest = i.versions[0] ?? null
  const approved = i.versions.find((v) => v.status === "approved") ?? null
  const active = i.job?.status === "queued" || i.job?.status === "running"

  const profile: Stage = { id: "profile", title: "Target Profile", state: "done", detail: "Reviewed: the threat model is made from it." }
  if (i.blockerCode === "not_verified") {
    profile.state = "blocked"
    profile.detail = "The target's ownership is not verified, so no profile is mapped yet."
    profile.who = DEVELOPER
    profile.href = `/targets/${i.targetId}/verify`
    profile.action = "Verify ownership"
  } else if (i.blockerCode === "profile_not_reviewed") {
    // With a version already made, the profile needs another review before a NEW one can be generated; the existing one stays usable
    profile.state = newest ? "waiting" : "blocked"
    profile.detail = newest
      ? `The Target Profile needs another review before a new version can be generated. v${newest.version} was made from an earlier profile.`
      : "The Target Profile has not been reviewed. The threat model is made from the reviewed profile."
    profile.who = DEVELOPER
    profile.href = `/targets/${i.targetId}/profile`
    profile.action = "Review the profile"
  } else if (i.blockerCode === "target_archived") {
    profile.state = "blocked"
    profile.detail = "The target is archived: its threat model can only be read."
  }

  const generation: Stage = { id: "generation", title: "Generated", state: "upcoming", detail: "Not generated yet." }
  if (profile.state === "blocked" && !newest) generation.detail = "Waits for the profile."
  else if (active) {
    generation.state = "working"
    generation.detail = newest ? "A new version is being generated." : "The first version is being generated."
  } else if (i.job?.status === "failed") {
    generation.state = i.canManage ? "ready" : "blocked"
    generation.detail = `The last generation failed${i.job.message ? `: ${i.job.message}` : ""}.`
    generation.who = i.canManage ? undefined : ANALYST
  } else if (newest) {
    generation.state = "done"
    generation.detail = `v${newest.version} ${newest.ai_generated ? "generated" : "saved"} ${day(newest.created_at)}${i.baselineOnly ? ": baseline threats only, because the model for generation couldn't be reached" : ""}.`
  } else if (profile.state === "done") {
    generation.state = i.canManage ? "ready" : "waiting"
    generation.detail = "Not generated yet."
    generation.who = i.canManage ? undefined : ANALYST
  }

  const review: Stage = { id: "review", title: "Reviewed", state: "upcoming", detail: "Waits for a generated version." }
  const approval: Stage = { id: "approval", title: "Approved", state: "upcoming", detail: "Nothing is approved yet." }
  if (newest) {
    if (newest.status === "draft") {
      review.state = i.canManage ? "ready" : "waiting"
      review.detail = `v${newest.version} is a draft. A person reviews it and may change threats before approving.`
      review.who = i.canManage ? undefined : ANALYST
      approval.state = i.canManage ? "ready" : "waiting"
      approval.who = i.canManage ? undefined : ANALYST
      approval.detail = approved
        ? `v${newest.version} is not approved. Campaigns still use v${approved.version}, approved ${day(approved.approved_at ?? approved.created_at)}${approved.approved_by ? ` by ${approved.approved_by}` : ""}.`
        : `v${newest.version} is not approved, so no campaign can be based on a threat model yet.`
    } else {
      review.state = "done"
      review.detail = `v${newest.version} was reviewed${newest.approved_by ? ` by ${newest.approved_by}` : ""}.`
      approval.state = "done"
      approval.detail = `v${newest.version} approved ${day(newest.approved_at ?? newest.created_at)}${newest.approved_by ? ` by ${newest.approved_by}` : ""}. Every campaign records the version it used.`
    }
  }

  const suites: Stage = { id: "suites", title: "Recommended suites", state: "upcoming", detail: "Recommendations come from an approved version." }
  if (approved) {
    suites.state = "ready"
    suites.detail = `Based on v${approved.version}, the approved version.`
    suites.href = `/threat-models/${i.targetId}/recommendations`
    suites.action = "Open the recommendations"
  } else if (newest) {
    suites.state = "blocked"
    suites.detail = "Nothing is recommended until a version is approved."
    suites.who = ANALYST
  }
  return [profile, generation, review, approval, suites]
}

/** The one thing to do next for this person, or what is being waited for. */
export function nextStep(stages: Stage[], canManage: boolean): string {
  const made = stages.find((s) => s.id === "generation")?.state === "done"
  // Once a version exists, the profile is not what the person is waiting on: its review and approval are
  const open = stages.filter((s) => !(made && s.id === "profile") && (s.state === "ready" || s.state === "blocked" || s.state === "waiting" || s.state === "working"))
  const first = open.find((s) => s.state === "ready") ?? open.find((s) => s.state === "working") ?? open[0]
  if (!first) return "Everything is in place."
  if (first.state === "working") return `${first.title}: in progress.`
  if (first.state === "ready") return canManage ? `Next for you: ${first.title.toLowerCase()}.` : `Next: ${first.title.toLowerCase()}.`
  return `${first.title}: ${first.who ? `waiting for a ${first.who}` : "blocked"}.`
}
