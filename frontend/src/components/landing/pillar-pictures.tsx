"use client"

import { useEffect, useRef, useState } from "react"
import { Check, CircleCheck, RefreshCw, Wrench } from "lucide-react"

/**
 * The three small pictures of the Find, Prove and Fix cards, alive: while a card is on screen its picture
 * plays its job over and over, slowly. Find scans down a list of findings and their severities appear one
 * by one; Prove repeats a test three times and counts how often it worked; Fix proposes a fix, gets it
 * approved by a person and tests it again. A picture stops when it is off screen, and with the system's
 * "reduce motion" setting it shows its finished state and does not move. The pictures are hidden from
 * screen readers, because the card's own lines say the same. Joynto asked for no pause button on moving
 * pictures (15 Nov 2026): a gap against WCAG 2.2.2 (movement longer than five seconds) to be recorded in
 * the task note.
 */

/**
 * Counts from 0 to `last` every `every` ms, waits `hold` ms on the last step and starts again, but only
 * while the element is on screen. With reduced motion it stays on the last step.
 */
function usePhase(last: number, every: number, hold: number) {
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

const FRAME = "mt-6 h-[9.5rem] overflow-hidden rounded-xl border border-lp-line bg-white p-3.5 shadow-[0_18px_36px_-24px_rgba(43,79,216,0.35)]"
const EASE = "transition-[opacity,transform,background-color] duration-500 motion-reduce:transition-none"

const FINDINGS = [
  ["Prompt injection", "High", "high"],
  ["Document leak", "Medium", "medium"],
  ["Tool misuse", "Low", "low"],
] as const

/** Find: a scan runs down the list and each finding shows its severity as it is reached. */
function Find() {
  const [ref, phase] = usePhase(3, 900, 2600)
  return (
    <div ref={ref} aria-hidden="true" className={FRAME}>
      <ul className="relative space-y-2 text-[13px]">
        {FINDINGS.map(([name, level, tone], index) => {
          const found = phase > index
          const scanning = phase === index
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
function Prove() {
  const [ref, phase] = usePhase(3, 900, 2600)
  return (
    <div ref={ref} aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-4`}>
      <p className="text-[13px] font-medium text-lp-ink">Prompt injection</p>
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            className={`grid size-7 place-items-center rounded-full ${EASE} ${
              phase > n ? "scale-100 bg-primary text-primary-foreground" : phase === n ? "scale-100 bg-primary/15 text-primary" : "scale-90 bg-lp-line text-transparent"
            }`}
          >
            {phase === n ? <RefreshCw className="size-3.5 motion-safe:animate-spin" /> : <Check className="size-4" />}
          </span>
        ))}
        <span className="ml-1 text-sm font-medium text-lp-ink tabular-nums">{phase === 0 ? "Repeating…" : `${phase} of 3 worked`}</span>
      </div>
    </div>
  )
}

/** Fix: a fix is proposed, a person approves it, and the test runs again and passes. */
function Fix() {
  const [ref, phase] = usePhase(4, 1100, 2800)
  const line = (shown: boolean) => `flex items-center gap-2.5 text-[13px] text-lp-ink ${EASE} ${shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`
  return (
    <div ref={ref} aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-3`}>
      <p className={line(phase >= 1)}>
        <Wrench className="size-5 shrink-0 text-lp-muted" />
        Fix proposed
      </p>
      <p className={`${line(phase >= 2)} font-medium`}>
        <CircleCheck className="size-5 shrink-0 text-success" />
        Fix approved by a person
      </p>
      <p className={line(phase >= 3)}>
        <RefreshCw className={`size-5 shrink-0 text-link ${phase === 3 ? "motion-safe:animate-spin" : ""}`} />
        {phase >= 4 ? "Retest passed" : "Testing again…"}
      </p>
    </div>
  )
}

export function PillarPicture({ id }: { id: string }) {
  if (id === "find") return <Find />
  if (id === "prove") return <Prove />
  return <Fix />
}
