import type { RemediationPage } from "@/lib/remediation"

export type StageState = "done" | "current" | "waiting" | "problem" | "upcoming" | "blocked"

export type Stage = {
  id: "proposal" | "review" | "application" | "retest" | "outcome"
  title: string
  state: StageState
  /** What is true now, from the server's data and nothing else */
  status: string
  /** Who may move it forward: a role, as the permission table has it */
  who: string
  /** The next action, or null when nothing is waiting on a person */
  next: string | null
}

const DEVELOPER_OR_ANALYST = "AI Application Developer or Security Analyst"
const APPROVERS = "Security Analyst or Security Manager, not the person who last adapted it"

/**
 * The stages a fix passes from proposal to a verified outcome, each with its real state, who is
 * responsible and what comes next. Viewing a stage completes nothing: a stage is "done" only when
 * the server's data says it happened (a version approved, a retest that judged it), and "upcoming"
 * stays upcoming until the stage before it is done. The outcome is never "fixed" without a retest
 * whose verdict is closed.
 */
export function remediationJourney(page: RemediationPage): Stage[] {
  const current = page.current
  const writing = page.job?.status === "queued" || page.job?.status === "running"
  const status = current?.status
  const approved = status === "approved" || status === "applying" || status === "effective" || status === "ineffective"
  const newestRetest = [...page.retests].sort((a, b) => b.number - a.number)[0]
  const openChanges = page.changes.filter((change) => change.status === "open").length

  const proposal: Stage = !current
    ? writing
      ? { id: "proposal", title: "Proposal", state: "current", status: "Sentra is writing the proposal", who: "Sentra", next: "Wait: the version appears here when it is written" }
      : page.blocker
        ? { id: "proposal", title: "Proposal", state: "blocked", status: page.blocker, who: DEVELOPER_OR_ANALYST, next: null }
        : { id: "proposal", title: "Proposal", state: "current", status: "No proposal yet", who: DEVELOPER_OR_ANALYST, next: "Request remediation" }
    : { id: "proposal", title: "Proposal", state: "done", status: `Version ${current.version} exists`, who: DEVELOPER_OR_ANALYST, next: null }

  let review: Stage
  if (!current) review = { id: "review", title: "Review", state: "upcoming", status: "Starts when there is a proposal", who: APPROVERS, next: null }
  else if (status === "draft")
    review = { id: "review", title: "Review", state: "current", status: `Version ${current.version} is not with the approvers yet`, who: DEVELOPER_OR_ANALYST, next: page.review.can_submit ? "Request approval" : "Wait for someone who may send it" }
  else if (status === "awaiting_approval")
    review = { id: "review", title: "Review", state: "waiting", status: `Version ${current.version} is waiting for approval`, who: APPROVERS, next: page.review.can_approve ? "Approve or reject it" : "Wait for an approver" }
  else if (status === "rejected")
    review = { id: "review", title: "Review", state: "problem", status: `Version ${current.version} was rejected${current.decided_by ? ` by ${current.decided_by}` : ""}`, who: "AI Application Developer", next: "Adapt the proposal, or ask for a revision" }
  else review = { id: "review", title: "Review", state: "done", status: `Version ${current.version} was approved${current.decided_by ? ` by ${current.decided_by}` : ""}`, who: APPROVERS, next: null }

  let application: Stage
  if (!approved) application = { id: "application", title: "Application", state: "upcoming", status: "Nothing is applied before a person approves", who: "AI Application Developer", next: null }
  else if (status === "effective" || status === "ineffective")
    application = { id: "application", title: "Application", state: "done", status: "Every fix was in effect when it was retested", who: "AI Application Developer", next: null }
  else
    application = {
      id: "application",
      title: "Application",
      state: "current",
      status: page.in_effect ?? "Approved, and not applied yet",
      who: "AI Application Developer (gateway policy and changes inside the application)",
      next: openChanges > 0 ? `Mark the ${openChanges} change${openChanges === 1 ? "" : "s"} inside the application as implemented once it is in the code` : "Deploy the Shield policy that carries the gateway fixes",
    }

  let retest: Stage
  if (!approved) retest = { id: "retest", title: "Retest", state: "upcoming", status: "Starts by itself once every fix is in effect", who: "Sentra", next: null }
  else if (newestRetest?.running) retest = { id: "retest", title: "Retest", state: "current", status: `Retest ${newestRetest.number} of version ${newestRetest.version} is running`, who: "Sentra", next: "Follow it" }
  else if (newestRetest) retest = { id: "retest", title: "Retest", state: newestRetest.verdict === "closed" ? "done" : "problem", status: `Retest ${newestRetest.number} of version ${newestRetest.version}: ${newestRetest.verdict_label ?? newestRetest.status_label}${newestRetest.out_of_date ? " (a rollback has taken what it proved out of the traffic)" : ""}`, who: "Sentra", next: newestRetest.verdict === "closed" && !newestRetest.out_of_date ? null : "Read the before and after" }
  else retest = { id: "retest", title: "Retest", state: "upcoming", status: "Not run yet: it starts by itself once every fix is in effect", who: "Sentra", next: null }

  let outcome: Stage
  if (!newestRetest || newestRetest.running) outcome = { id: "outcome", title: "Outcome", state: "upcoming", status: "Not known: there is no finished retest", who: "—", next: null }
  else if (newestRetest.verdict === "closed" && !newestRetest.out_of_date) outcome = { id: "outcome", title: "Outcome", state: "done", status: "Fixed and verified by the retest", who: "—", next: null }
  else if (newestRetest.verdict === "still_open") outcome = { id: "outcome", title: "Outcome", state: "problem", status: "Still open after the retest", who: "AI Application Developer", next: "Adapt the proposal or ask for a revision" }
  else outcome = { id: "outcome", title: "Outcome", state: "problem", status: "Not decided: the retest could not tell, so nothing is marked fixed", who: "—", next: "Read the retest, then retest again when it can run" }

  return [proposal, review, application, retest, outcome]
}
