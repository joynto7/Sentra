"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight, Check, Search, ShieldCheck, Wrench, type LucideIcon } from "lucide-react"

import { PILLARS } from "@/components/landing/landing-content"
import { FIX_FROM, PIPELINE_LAST, PROVE_FROM, PillarPicture } from "@/components/landing/pillar-pictures"
import { cn } from "@/lib/utils"

const ICON: Record<string, LucideIcon> = { find: Search, prove: ShieldCheck, fix: Wrench }
const STEP_MS = 900

const CSS = `
@keyframes pipe-ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--primary) 50%, transparent); transform: translate(50%, -50%) scale(.8) } 60% { transform: translate(50%, -50%) scale(1.25) } 100% { box-shadow: 0 0 0 16px transparent; transform: translate(50%, -50%) scale(1) } }
@media (prefers-reduced-motion: reduce) { .pipe * { animation: none !important; transition: none !important } }
`

/**
 * One timeline for the three cards: when they come into view the pipeline runs once, from the first card to
 * the last, and rests on its finished state; when they leave the view it rests, so that coming back plays it
 * again. With the system's "reduce motion" setting it never runs. `phase` is the step it is at, -1 before the
 * first; `running` is whether it is in progress.
 */
function usePipeline() {
  const ref = useRef<HTMLOListElement>(null)
  const [phase, setPhase] = useState(PIPELINE_LAST)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let timers: number[] = []
    const clear = () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers = []
    }
    const play = () => {
      clear()
      setRunning(true)
      setPhase(-1)
      for (let step = 0; step <= PIPELINE_LAST; step += 1) {
        timers.push(
          window.setTimeout(
            () => {
              setPhase(step)
              if (step === PIPELINE_LAST) setRunning(false)
            },
            500 + step * STEP_MS,
          ),
        )
      }
    }
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) play()
        else {
          clear()
          setRunning(false)
          setPhase(PIPELINE_LAST)
        }
      },
      { threshold: 0.45 },
    )
    watcher.observe(node)
    return () => {
      watcher.disconnect()
      clear()
    }
  }, [])

  return { ref, phase, running }
}

/**
 * Find, prove and fix: the three jobs of the product as three cards side by side, each with a small
 * picture of what that job looks like in the product. The pictures are drawn from the real screens
 * (a finding with its severity, its repeat count, the approved fix and the retest) and the sample is
 * fictional. The three cards work as one system (see usePipeline): the first finds, the arrow carries it to
 * the second, which proves it, and the arrow carries that to the third, which fixes it. While it runs the
 * card that has the turn is lit, the ones still to come are held back, and each card's list is ticked off as
 * the card is reached.
 */
export function Pillars() {
  const { ref, phase, running } = usePipeline()
  const reached = [true, phase >= PROVE_FROM, phase >= FIX_FROM]
  const current = phase >= FIX_FROM ? 2 : phase >= PROVE_FROM ? 1 : 0
  return (
    <ol ref={ref} className="pipe mt-14 grid gap-6 lg:grid-cols-3 lg:gap-0">
      <style>{CSS}</style>
      {PILLARS.map((pillar, index) => {
        const Icon = ICON[pillar.id]
        const mine = running && current === index
        const waiting = running && !reached[index]
        return (
          <li
            key={pillar.id}
            data-reveal="scale"
            data-reveal-delay={160 + index * 170}
            className="relative lg:px-3 first:lg:pl-0 last:lg:pr-0"
          >
            <article
              className={cn(
                "flex h-full flex-col rounded-2xl border bg-lp-wash p-6 transition-[opacity,transform,border-color,box-shadow] duration-500 motion-reduce:transition-none sm:p-7",
                "hover:-translate-y-1 hover:shadow-[0_24px_48px_-28px_rgba(43,79,216,0.45)]",
                mine ? "border-primary/50 shadow-[0_24px_48px_-28px_rgba(43,79,216,0.55)]" : "border-lp-line",
                waiting && "scale-[.985] opacity-60",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-10 place-items-center rounded-xl border bg-white shadow-[0_6px_14px_-8px_rgba(43,79,216,0.4)] transition-colors duration-500",
                    mine ? "border-primary bg-primary" : "border-lp-line",
                  )}
                >
                  <Icon
                    className={cn("size-5 transition-colors duration-500", mine ? "text-primary-foreground" : "text-primary")}
                    aria-hidden="true"
                  />
                </span>
                <h3 className="text-xl font-medium tracking-tight text-lp-ink">{pillar.name}</h3>
              </div>

              <PillarPicture id={pillar.id} phase={phase} />

              <ul className="mt-6 space-y-3">
                {pillar.steps.map((step, i) => (
                  <li key={step} className="flex gap-3 text-[15px] leading-snug text-lp-ink">
                    <Check
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-link transition-[transform,opacity] duration-300 motion-reduce:transition-none",
                        waiting ? "scale-50 opacity-0" : "scale-100 opacity-100",
                      )}
                      style={{ transitionDelay: running && reached[index] ? `${300 + i * 220}ms` : "0ms" }}
                      aria-hidden="true"
                    />
                    {step}
                  </li>
                ))}
              </ul>
            </article>

            {index < PILLARS.length - 1 && (
              <span
                key={reached[index + 1] ? `lit-${running}` : "dim"}
                aria-hidden="true"
                className={cn(
                  "absolute top-1/2 right-0 z-10 hidden size-8 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition-colors duration-500 lg:grid",
                  running && reached[index + 1]
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-lp-line bg-white text-primary",
                )}
                style={running && reached[index + 1] ? { animation: "pipe-ping .8s ease-out 1" } : undefined}
              >
                <ArrowRight className="size-4" />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
