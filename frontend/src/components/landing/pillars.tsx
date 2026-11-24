import { ArrowRight, Check, Search, ShieldCheck, Wrench, type LucideIcon } from "lucide-react"

import { PILLARS } from "@/components/landing/landing-content"
import { PillarPicture } from "@/components/landing/pillar-pictures"

const ICON: Record<string, LucideIcon> = { find: Search, prove: ShieldCheck, fix: Wrench }

/**
 * Find, prove and fix: the three jobs of the product as three cards side by side, each with a small
 * picture of what that job looks like in the product. The pictures are drawn from the real screens
 * (a finding with its severity, its repeat count, the approved fix and the retest) and the sample is
 * fictional. The pictures play their job while the card is on screen (pillar-pictures.tsx).
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

              <PillarPicture id={pillar.id} />

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
