"use client"

import { useEffect, useRef, useState } from "react"
import { Check, CircleCheck, RefreshCw, Wrench } from "lucide-react"

/**
 * The three small pictures of the Find, Prove and Fix cards. They are three parts of one story that
 * pillars.tsx plays once, in order, each time the cards come into view: Find scans down a list of findings and
 * their severities appear one by one; Prove then repeats a test three times and counts how often it worked;
 * Fix proposes a fix, gets it approved by a person and tests it again. With the system's "reduce motion"
 * setting they show their finished state and do not move. The pictures are hidden from
 * screen readers, because the card's own lines say the same. Joynto asked for no pause button on moving
 * pictures (15 Nov 2026): a gap against WCAG 2.2.2 (movement longer than five seconds) to be recorded in
 * the task note.
 */

/**
 * Counts from 0 to `last` every `every` ms, waits `hold` ms on the last step and starts again, but only
 * while the element is on screen. With reduced motion it stays on the last step.
 */
export function usePhase(last: number, every: number, hold: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => setPhase(last), 0)
      return () => window.clearTimeout(id)
    }
    let timer = 0
    const step = (now: number) => {
      setPhase(now)
      timer = window.setTimeout(() => step(now >= last ? 0 : now + 1), now >= last ? hold : every)
    }
    const watcher = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer)
        if (entry.isIntersecting) timer = window.setTimeout(() => step(0), 400)
      },
      { threshold: 0.6 },
    )
    watcher.observe(node)
    return () => {
      watcher.disconnect()
      window.clearTimeout(timer)
    }
  }, [last, every, hold])

  return [ref, phase] as const
}

export const FRAME =
  "mt-6 h-[9.5rem] overflow-hidden rounded-xl border border-lp-line bg-white p-3.5 shadow-[0_18px_36px_-24px_rgba(43,79,216,0.35)]"
export const EASE = "transition-[opacity,transform,background-color] duration-500 motion-reduce:transition-none"

const FINDINGS = [
  ["Prompt injection", "High", "high"],
  ["Document leak", "Medium", "medium"],
  ["Tool misuse", "Low", "low"],
] as const

/** The last step of the whole pipeline: Find takes steps 0 to 3, Prove 4 to 7, Fix 8 to 11 (see pillars.tsx). */
export const PIPELINE_LAST = 11
/** The step at which each card takes over from the one before it. */
export const PROVE_FROM = 4
export const FIX_FROM = 8

/** Find: a scan runs down the list and each finding shows its severity as it is reached. */
function Find({ phase }: { phase: number }) {
  const step = phase < 0 ? -1 : Math.min(phase, 3)
  return (
    <div aria-hidden="true" className={FRAME}>
      <ul className="relative space-y-2 text-[13px]">
        {FINDINGS.map(([name, level, tone], index) => {
          const found = step > index
          const scanning = step === index
          return (
            <li
              key={name}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${EASE} ${scanning ? "bg-primary/10 ring-1 ring-primary/30" : "bg-lp-wash ring-0"}`}
            >
              <span className="font-medium text-lp-ink">{name}</span>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${EASE} ${found ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
                style={{ background: `var(--severity-${tone}-bg)`, color: `var(--severity-${tone}-text)` }}
              >
                {level}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Prove: the same test repeated three times, and a count of how often it worked. */
function Prove({ phase }: { phase: number }) {
  const step = phase < PROVE_FROM ? -1 : Math.min(phase - PROVE_FROM, 3)
  return (
    <div aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-4`}>
      <p className="text-[13px] font-medium text-lp-ink">Prompt injection</p>
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            className={`grid size-7 place-items-center rounded-full ${EASE} ${
              step > n
                ? "scale-100 bg-primary text-primary-foreground"
                : step === n
                  ? "scale-100 bg-primary/15 text-primary"
                  : "scale-90 bg-lp-line text-transparent"
            }`}
          >
            {step === n ? <RefreshCw className="size-3.5 motion-safe:animate-spin" /> : <Check className="size-4" />}
          </span>
        ))}
        <span className="ml-1 text-sm font-medium text-lp-ink tabular-nums">
          {step < 0 ? "Waiting…" : step === 0 ? "Repeating…" : `${step} of 3 worked`}
        </span>
      </div>
    </div>
  )
}

/** Fix: a fix is proposed, a person approves it, and the test runs again and passes. */
function Fix({ phase }: { phase: number }) {
  const step = phase < FIX_FROM ? 0 : Math.min(phase - FIX_FROM + 1, 4)
  const line = (shown: boolean) =>
    `flex items-center gap-2.5 text-[13px] text-lp-ink ${EASE} ${shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`
  return (
    <div aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-3`}>
      <p className={line(step >= 1)}>
        <Wrench className="size-5 shrink-0 text-lp-muted" />
        Fix proposed
      </p>
      <p className={`${line(step >= 2)} font-medium`}>
        <CircleCheck className="size-5 shrink-0 text-success" />
        Fix approved by a person
      </p>
      <p className={line(step >= 3)}>
        <RefreshCw className={`size-5 shrink-0 text-link ${step === 3 ? "motion-safe:animate-spin" : ""}`} />
        {step >= 4 ? "Retest passed" : "Testing again…"}
      </p>
    </div>
  )
}

/** The picture of one card, drawn at a step of the pipeline that the three cards share. */
export function PillarPicture({ id, phase }: { id: string; phase: number }) {
  if (id === "find") return <Find phase={phase} />
  if (id === "prove") return <Prove phase={phase} />
  return <Fix phase={phase} />
}
