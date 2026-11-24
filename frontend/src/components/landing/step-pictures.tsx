"use client"

import { Check, CircleCheck, Globe, RefreshCw, Wrench } from "lucide-react"

import { EASE, FRAME, usePhase } from "@/components/landing/pillar-pictures"

/**
 * The four small pictures of the "Four steps" cards, in the same style and with the same rules as the
 * Find, Prove and Fix pictures (pillar-pictures.tsx): each plays its step slowly, over and over, while its
 * card is on screen; with the "reduce motion" setting it shows its finished state; screen readers do not
 * get them, since the card's own words say the same. Same gap against WCAG 2.2.2 as the others, to be
 * recorded in the task note.
 */

/** 1. Register and verify: the application's address, the record to add, and "Verified" */
function Register() {
  const [ref, phase] = usePhase(3, 950, 2600)
  const row = (shown: boolean) => `${EASE} ${shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`
  return (
    <div ref={ref} aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-2.5 text-[13px]`}>
      <p className="flex items-center gap-2 rounded-lg bg-lp-wash px-3 py-2 font-medium text-lp-ink">
        <Globe className="size-4 text-lp-muted" />
        support.example.com
      </p>
      <p className={`rounded-lg border border-dashed border-lp-line px-3 py-2 font-mono text-xs text-lp-muted ${row(phase >= 1)}`}>sentra-verify=7f3a91…</p>
      <p className={`flex items-center gap-2 font-medium text-success ${row(phase >= 3)}`}>
        <CircleCheck className="size-5" />
        Verified
      </p>
    </div>
  )
}

const TESTS = ["Prompt injection", "Data leakage", "Tool misuse"]

/** 2. Choose what to test: tests ticked one by one, with the limits beside them */
function Choose() {
  const [ref, phase] = usePhase(3, 900, 2600)
  return (
    <div ref={ref} aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-2 text-[13px]`}>
      {TESTS.map((name, i) => (
        <p key={name} className="flex items-center gap-2.5 text-lp-ink">
          <span className={`grid size-5 place-items-center rounded-md border ${EASE} ${phase > i ? "border-primary bg-primary text-primary-foreground" : "border-lp-line bg-white text-transparent"}`}>
            <Check className="size-3.5" />
          </span>
          {name}
        </p>
      ))}
      <p className="mt-1 text-xs text-lp-muted">Budget 870 · 18 per minute</p>
    </div>
  )
}

/** 3. Run and read the evidence: a run filling up, and a finding as it is found */
function Run() {
  const [ref, phase] = usePhase(3, 1000, 2600)
  const pct = [4, 38, 71, 100][phase]
  return (
    <div ref={ref} aria-hidden="true" className={`${FRAME} flex flex-col justify-center gap-3`}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-lp-ink">Running</span>
        <span className="tabular text-xs text-lp-muted">{Math.round((pct / 100) * 870)} of 870</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-lp-line">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, transition: "width 900ms ease-in-out" }} />
      </div>
      <p className={`flex items-center justify-between rounded-lg bg-lp-wash px-3 py-2 text-[13px] ${EASE} ${phase >= 2 ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`}>
        <span className="font-medium text-lp-ink">Prompt injection</span>
        <span className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: "var(--severity-critical-bg)", color: "var(--severity-critical-text)" }}>
          Finding
        </span>
      </p>
    </div>
  )
}

/** 4. Fix and verify: proposed, approved by a person, tested again */
function FixIt() {
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
        Approved by a person
      </p>
      <p className={line(phase >= 3)}>
        <RefreshCw className={`size-5 shrink-0 text-link ${phase === 3 ? "motion-safe:animate-spin" : ""}`} />
        {phase >= 4 ? "Retest passed" : "Testing again…"}
      </p>
    </div>
  )
}

export function StepPicture({ index }: { index: number }) {
  return [<Register key="r" />, <Choose key="c" />, <Run key="u" />, <FixIt key="f" />][index] ?? null
}
