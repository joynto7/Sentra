import { ArrowRight, Check, CircleCheck, RefreshCw, Search, ShieldCheck, Wrench, type LucideIcon } from "lucide-react"

import { PILLARS } from "@/components/landing/landing-content"

const ICON: Record<string, LucideIcon> = { find: Search, prove: ShieldCheck, fix: Wrench }

/**
 * Find, prove and fix: the three jobs of the product as three cards side by side, each with a small
 * picture of what that job looks like in the product. The pictures are drawn from the real screens
 * (a finding with its severity, its repeat count, the approved fix and the retest) and the sample is
 * fictional, which the line under the cards says. Nothing here moves: the motion on this page is kept
 * for the pictures that tell a story, and a still card is also the one that reads best in a list.
 */
export function Pillars() {
  return (
    <ol className="mt-14 grid gap-6 lg:grid-cols-3 lg:gap-0">
      {PILLARS.map((pillar, index) => {
        const Icon = ICON[pillar.id]
        return (
          <li key={pillar.id} className="relative lg:px-3 first:lg:pl-0 last:lg:pr-0">
            <article className="flex h-full flex-col rounded-2xl border border-lp-line bg-lp-wash p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-lp-line bg-white shadow-[0_6px_14px_-8px_rgba(43,79,216,0.4)]">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                </span>
                <h3 className="text-xl font-medium tracking-tight text-lp-ink">{pillar.name}</h3>
              </div>

              <Picture id={pillar.id} />

              <ul className="mt-6 space-y-3">
                {pillar.steps.map((step) => (
                  <li key={step} className="flex gap-3 text-[15px] leading-snug text-lp-ink">
                    <Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden="true" />
                    {step}
                  </li>
                ))}
              </ul>
            </article>

            {index < PILLARS.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-1/2 right-0 z-10 hidden size-8 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-lp-line bg-white text-primary shadow-sm lg:grid"
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

/** The small picture at the top of each card. It repeats what the card says, so it is hidden from readers. */
function Picture({ id }: { id: string }) {
  return (
    <div
      aria-hidden="true"
      className="mt-6 h-[9.5rem] rounded-xl border border-lp-line bg-white p-3.5 shadow-[0_18px_36px_-24px_rgba(43,79,216,0.35)]"
    >
      {id === "find" && (
        <ul className="space-y-2 text-[13px]">
          {[
            ["Prompt injection", "High", "high"],
            ["Document leak", "Medium", "medium"],
            ["Tool misuse", "Low", "low"],
          ].map(([name, level, tone]) => (
            <li key={name} className="flex items-center justify-between gap-3 rounded-lg bg-lp-wash px-3 py-2">
              <span className="font-medium text-lp-ink">{name}</span>
              <span
                className="rounded-md px-2 py-0.5 text-xs font-medium"
                style={{ background: `var(--severity-${tone}-bg)`, color: `var(--severity-${tone}-text)` }}
              >
                {level}
              </span>
            </li>
          ))}
        </ul>
      )}

      {id === "prove" && (
        <div className="flex h-full flex-col justify-center gap-4">
          <p className="text-[13px] font-medium text-lp-ink">Prompt injection</p>
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((n) => (
              <span key={n} className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-4" />
              </span>
            ))}
            <span className="ml-1 text-sm font-medium text-lp-ink">3 of 3 worked</span>
          </div>
        </div>
      )}

      {id === "fix" && (
        <ul className="flex h-full flex-col justify-center gap-3 text-[13px]">
          <li className="flex items-center gap-2.5 text-lp-ink">
            <Wrench className="size-5 shrink-0 text-lp-muted" />
            Fix proposed
          </li>
          <li className="flex items-center gap-2.5 font-medium text-lp-ink">
            <CircleCheck className="size-5 shrink-0 text-success" />
            Fix approved by a person
          </li>
          <li className="flex items-center gap-2.5 text-lp-ink">
            <RefreshCw className="size-5 shrink-0 text-link" />
            Retest passed
          </li>
        </ul>
      )}
    </div>
  )
}
