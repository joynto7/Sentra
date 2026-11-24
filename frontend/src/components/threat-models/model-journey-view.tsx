"use client"

import { type JourneyInput, type Stage, type StageState, nextStep, threatModelStages } from "@/components/threat-models/model-journey"
import { type Step, type StepState, StepJourney } from "@/components/sentra/step-journey"

/** How a stage of the threat model reads as a step: "ready" is the person's turn, "working" is Sentra's. */
const AS_STATE: Record<StageState, { state: StepState; word: string }> = {
  done: { state: "done", word: "Done" },
  ready: { state: "current", word: "Ready" },
  waiting: { state: "waiting", word: "Waiting" },
  blocked: { state: "blocked", word: "Blocked" },
  working: { state: "current", word: "In progress" },
  upcoming: { state: "upcoming", word: "Not yet" },
}

const toThreats = () => document.getElementById("threats-heading")?.scrollIntoView({ behavior: "smooth", block: "start" })
const toReview = () => document.getElementById("review-heading")?.scrollIntoView({ behavior: "smooth", block: "center" })

/** The one thing a stage offers: a link, or something the page already does (generating, reviewing, approving). */
function actionOf(stage: Stage, input: JourneyInput, onGenerate: (() => void) | undefined): Step["action"] {
  if (stage.href && stage.action) return { label: stage.action, href: stage.href }
  if (stage.id === "generation" && input.canManage && onGenerate && (stage.state === "ready" || (stage.state === "done" && /baseline threats only/.test(stage.detail)))) {
    return { label: stage.state === "ready" && input.versions.length === 0 ? "Generate the threat model" : "Generate again", onClick: onGenerate }
  }
  if (stage.id === "review" && stage.state === "ready") return { label: "Review the threats", onClick: toThreats }
  if (stage.id === "approval" && stage.state === "ready") return { label: "Go to the approval", onClick: toReview }
  return null
}

/** The five stages of a threat model with the version and the role responsible: generation is never approval. */
export function ModelJourney({ input, onGenerate }: { input: JourneyInput; onGenerate?: () => void }) {
  const stages = threatModelStages(input)
  const newest = input.versions[0]
  const approved = input.versions.find((v) => v.status === "approved")
  const made = stages.find((s) => s.id === "generation")?.state === "done"
  const open = stages.filter((s) => !(made && s.id === "profile") && ["ready", "blocked", "waiting", "working"].includes(s.state))
  const first = open.find((s) => s.state === "ready") ?? open.find((s) => s.state === "working") ?? open[0]
  const steps: Step[] = stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    state: AS_STATE[stage.state].state,
    word: AS_STATE[stage.state].word,
    status: stage.detail,
    who: stage.who,
    next: null,
    working: stage.state === "working",
    action: actionOf(stage, input, onGenerate),
  }))
  return (
    <StepJourney
      title="Where this threat model stands"
      titleId="journey-heading"
      fallbackId={first?.id ?? stages[stages.length - 1].id}
      steps={steps}
      summary={
        <>
          {newest ? `Newest v${newest.version} is ${newest.status === "approved" ? "approved" : "a draft"}` : "No version yet"}
          {approved && newest?.version !== approved.version ? ` · campaigns use v${approved.version}` : ""}. {nextStep(stages, input.canManage)}
        </>
      }
    />
  )
}
