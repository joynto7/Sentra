"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Ban, CircleDot, Clock, Loader2, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type StepState = "done" | "current" | "waiting" | "problem" | "upcoming" | "blocked"

export type Step = {
  id: string
  title: string
  state: StepState
  /** The word under the node, when the state's own word is not the right one */
  word?: string
  /** What is true now, from the server's data and nothing else */
  status: string
  who?: string
  /** The next thing to do, in words, or null when nothing is waiting */
  next?: string | null
  /** The one action the step offers: a link, or something the page already does */
  action?: { label: string; href?: string; onClick?: () => void; disabled?: boolean } | null
  /** Something is going on right now: the node turns */
  working?: boolean
}

/**
 * What moves in a journey moves because the reader did something: the steps draw themselves in once
 * when the page opens; a step that has just been completed by an action gets its ring and its tick
 * and the line after it fills; one that has just failed shakes once. Choosing a step slides its
 * detail in. Nothing loops, and with less motion asked for every picture is its end state.
 */
const CSS = `
@keyframes rj-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
@keyframes rj-fill { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes rj-pop { 0% { transform: scale(.7); box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 55%, transparent) } 55% { transform: scale(1.14) } 100% { transform: scale(1); box-shadow: 0 0 0 16px transparent } }
@keyframes rj-shake { 0%, 100% { transform: translateX(0) } 20% { transform: translateX(-5px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(3px) } }
@keyframes rj-ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--primary) 45%, transparent) } 100% { box-shadow: 0 0 0 14px transparent } }
@keyframes rj-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes rj-swap { from { opacity: 0; transform: translateX(14px) } to { opacity: 1; transform: translateX(0) } }
@media (prefers-reduced-motion: reduce) { .rj * { animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important } }
`

const LOOK: Record<StepState, { icon: typeof Clock; word: string; text: string; fill: string }> = {
  done: { icon: Clock, word: "Done", text: "text-success", fill: "bg-success text-white border-success" },
  current: { icon: CircleDot, word: "Now", text: "text-link", fill: "bg-primary/10 text-primary border-primary" },
  waiting: { icon: Clock, word: "Waiting", text: "text-warning", fill: "bg-warning/10 text-warning border-warning" },
  problem: {
    icon: TriangleAlert,
    word: "Needs attention",
    text: "text-destructive",
    fill: "bg-destructive/10 text-destructive border-destructive",
  },
  blocked: { icon: Ban, word: "Blocked", text: "text-destructive", fill: "bg-destructive/10 text-destructive border-destructive" },
  upcoming: {
    icon: CircleDot,
    word: "Not yet",
    text: "text-muted-foreground",
    fill: "bg-card text-muted-foreground border-border-strong border-dashed",
  },
}

/** The tick of a finished step, drawn stroke by stroke. */
function Tick({ delay }: { delay: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray={1} style={{ animation: `rj-draw .45s ${delay}s ease-out both` }} />
    </svg>
  )
}

export function StepJourney({
  title,
  titleId,
  summary,
  steps,
  fallbackId,
  aside,
}: {
  title: string
  titleId: string
  /** The line beside the title: what comes next, or that nothing is waiting */
  summary: React.ReactNode
  steps: Step[]
  /** The step that opens first: the one that needs something, else the last */
  fallbackId: string
  /** Something to the right of the title, such as the button that starts the next thing */
  aside?: React.ReactNode
}) {
  const signature = steps.map((step) => `${step.id}:${step.state}`).join("|")
  const states = () => Object.fromEntries(steps.map((step) => [step.id, step.state])) as Record<string, StepState>

  // The step the reader chose, kept only while the steps are as they were: when an action changes
  // them, the picture moves on to the next thing by itself.
  const [picked, setPicked] = useState<{ id: string; signature: string } | null>(null)
  const selectedId = picked && picked.signature === signature ? picked.id : fallbackId
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0]

  // Which steps have just changed, so that they play their motion once
  const [before, setBefore] = useState({ signature, states: states() })
  const [fresh, setFresh] = useState<{ done: string[]; failed: string[] }>({ done: [], failed: [] })
  if (before.signature !== signature) {
    const now = states()
    setFresh({
      done: steps.filter((s) => s.state === "done" && before.states[s.id] !== "done").map((s) => s.id),
      failed: steps.filter((s) => (s.state === "problem" || s.state === "blocked") && before.states[s.id] !== s.state).map((s) => s.id),
    })
    setBefore({ signature, states: now })
  }

  const look = LOOK[selected.state]
  const action = selected.action

  function move(delta: number) {
    const at = steps.findIndex((step) => step.id === selected.id)
    const target = steps[(at + delta + steps.length) % steps.length]
    setPicked({ id: target.id, signature })
    document.getElementById(`step-${titleId}-${target.id}`)?.focus()
  }

  return (
    <section aria-labelledby={titleId} className="rj mb-5 overflow-hidden rounded-[14px] border bg-card">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-[linear-gradient(160deg,#e3e9ff_0%,#ffffff_70%)] px-4 py-3 dark:bg-[linear-gradient(160deg,#27346e_0%,#151b30_80%)]">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {title}
          </h2>
          <p className="text-[13px] text-text-secondary" role="status">
            {summary}
          </p>
        </div>
        {aside}
      </div>

      <ol
        className="px-2 pt-5 pb-2"
        style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault()
            move(1)
          } else if (event.key === "ArrowLeft") {
            event.preventDefault()
            move(-1)
          }
        }}
      >
        {steps.map((step, index) => {
          const stepLook = LOOK[step.state]
          const Icon = step.working ? Loader2 : stepLook.icon
          const isFresh = fresh.done.includes(step.id)
          const failed = fresh.failed.includes(step.id)
          const chosen = step.id === selected.id
          const word = step.word ?? stepLook.word
          return (
            <li
              key={step.id}
              data-state={step.state}
              className="relative flex flex-col items-center px-1"
              style={{ animation: `rj-in .5s ${index * 0.12}s ease-out both` }}
            >
              {index < steps.length - 1 && (
                <span aria-hidden="true" className="absolute top-5 left-[calc(50%+26px)] h-0.5 w-[calc(100%-52px)] rounded-full bg-border">
                  {step.state === "done" && (
                    <span
                      className="block h-full origin-left rounded-full bg-success"
                      style={{ animation: `rj-fill .7s ${isFresh ? 0.35 : 0.3 + index * 0.12}s ease-out both` }}
                    />
                  )}
                </span>
              )}
              <button
                id={`step-${titleId}-${step.id}`}
                type="button"
                aria-pressed={chosen}
                aria-label={`${step.title}: ${word}. ${step.status}`}
                onClick={() => setPicked({ id: step.id, signature })}
                tabIndex={chosen ? 0 : -1}
                className="group flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "relative z-10 grid size-10 place-items-center rounded-full border-2 transition-transform duration-200 group-hover:scale-105",
                    stepLook.fill,
                    chosen && "ring-4 ring-primary/20",
                  )}
                  style={
                    isFresh && step.state === "done"
                      ? { animation: "rj-pop .7s ease-out both" }
                      : failed
                        ? { animation: "rj-shake .5s ease-out both" }
                        : chosen && step.state === "current" && !step.working
                          ? { animation: "rj-ring 1.1s ease-out 2" }
                          : undefined
                  }
                >
                  {step.state === "done" ? (
                    <Tick delay={isFresh ? 0.25 : 0.2 + index * 0.12} />
                  ) : (
                    <Icon className={cn("size-5", step.working && "animate-spin")} aria-hidden="true" />
                  )}
                </span>
                <span className={cn("text-sm font-medium", chosen && "text-foreground")}>{step.title}</span>
                <span className={cn("text-xs", stepLook.text)}>{word}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <div
        key={selected.id}
        className="mx-4 mb-4 rounded-2xl border bg-muted/30 p-4"
        style={{ animation: "rj-swap .3s ease-out both" }}
        aria-live="polite"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {selected.title}
              <span className={cn("text-xs font-normal", look.text)}>{selected.word ?? look.word}</span>
            </p>
            <p className="mt-1 text-sm text-text-secondary">{selected.status}</p>
            {selected.who && selected.state !== "done" && selected.state !== "upcoming" && (
              <p className="mt-1 text-xs text-muted-foreground">Who: {selected.who}</p>
            )}
            {selected.next && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px]">
                <ArrowRight className="size-3.5 text-primary" aria-hidden="true" />
                <span className="font-medium">{selected.next}</span>
              </p>
            )}
          </div>
          {action &&
            (action.href ? (
              <Button asChild className="h-9 rounded-full px-4 hover:bg-primary-hover">
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ) : (
              <Button className="h-9 rounded-full px-4 hover:bg-primary-hover" onClick={action.onClick} disabled={action.disabled}>
                {action.label}
              </Button>
            ))}
        </div>
      </div>
    </section>
  )
}
