"use client"

import { type Stage, remediationJourney } from "@/components/remediation/remediation-journey"
import { type Step, StepJourney } from "@/components/sentra/step-journey"
import type { RemediationPage } from "@/lib/remediation"

/** The one thing a stage offers, when it offers something: a link, or a button that does what the page already can. */
function actionOf(
  stage: Stage,
  page: RemediationPage,
  ask: (() => void) | undefined,
): { label: string; href?: string; onClick?: () => void } | null {
  const code = page.finding.code
  const toApproval = () => document.getElementById("approval-panel")?.scrollIntoView({ behavior: "smooth", block: "center" })
  const newest = [...page.retests].sort((a, b) => b.number - a.number)[0]
  if (stage.id === "proposal") return !page.current && !page.blocker && ask ? { label: "Request remediation", onClick: ask } : null
  if (stage.id === "review") {
    if (stage.state === "current" && page.review.can_submit) return { label: "Request approval", onClick: toApproval }
    if (stage.state === "waiting" && page.review.can_approve) return { label: "Go to the approval", onClick: toApproval }
    if (stage.state === "problem") return { label: "Adapt the proposal", onClick: toApproval }
    return null
  }
  if (stage.id === "application" && stage.state === "current") {
    return page.changes.some((change) => change.status === "open")
      ? { label: "Mark them as implemented", href: "/remediation/changes" }
      : { label: "Deploy the Shield policy", href: `/targets/${page.finding.target_id}/shield` }
  }
  if (stage.id === "retest" && newest)
    return {
      label: newest.running ? "Follow the retest" : "See before and after",
      href: `/remediation/${code}/retest?number=${newest.number}`,
    }
  if (stage.id === "outcome" && stage.state === "problem") return { label: "Adapt the proposal", onClick: toApproval }
  if (stage.id === "outcome" && stage.state === "done") return { label: "Open the finding", href: `/findings/${code}` }
  return null
}

/**
 * The five stages of a fix, from proposal to a verified outcome, with the real state of each, the
 * role that moves it and the next action. Reading it completes nothing: the stages follow the
 * server's data, and the outcome stays unknown until a retest has judged the fix. Choosing a stage
 * shows what it means and the one action it offers.
 */
export function RemediationStages({ page, onAsk }: { page: RemediationPage; onAsk?: () => void }) {
  const stages = remediationJourney(page)
  const next = stages.find((stage) => stage.next && stage.state !== "upcoming")
  const steps: Step[] = stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    state: stage.state,
    status: stage.status,
    who: stage.who,
    next: stage.next,
    action: actionOf(stage, page, onAsk),
  }))
  return (
    <StepJourney
      title="Where this fix stands"
      titleId="stages-heading"
      fallbackId={next?.id ?? stages[stages.length - 1].id}
      steps={steps}
      summary={
        next ? (
          <>
            Next: <span className="font-medium text-foreground">{next.next}</span> ({next.who}).
          </>
        ) : (
          "Nothing is waiting on a person."
        )
      }
    />
  )
}
