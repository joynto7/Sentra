import { cn } from "@/lib/utils"

/**
 * The card of the card views (Targets, Remediation): a rounded card in a soft periwinkle that is a
 * little deeper at the top, with white pills on it. One place, so that every list that offers cards
 * offers the same card.
 */
export const GLASS_PILL = "rounded-full border-[#e1e7fb] bg-white px-3 dark:border-transparent dark:bg-white/10"

/** The colour every card has: a fifth of blue in the top corner, fading to white (light), or to the page's navy (dark). */
export const GLASS_SURFACE =
  "border-[#e1e7fb] bg-white bg-[linear-gradient(160deg,#d3deff_0%,#e8eeff_20%,#ffffff_80%)] dark:border-white/10 dark:bg-[#151b30] dark:bg-[linear-gradient(160deg,#27346e_0%,#1c2547_22%,#151b30_80%)]"

/** The wide pill at the foot of a card: the way into the thing the card is about. */
export const GLASS_BUTTON =
  "flex h-10 min-w-0 flex-1 items-center justify-center rounded-full border-2 border-[#dbe3fb] bg-white text-sm font-medium outline-none hover:border-[#c4d1fa] hover:bg-[#f4f7ff] focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/15"

/** The round white button next to it, 40 px: one quick action. */
export const GLASS_ROUND =
  "grid size-10 shrink-0 place-items-center rounded-full bg-white text-foreground shadow-[0_8px_20px_-10px_rgba(15,30,70,0.5)] outline-none hover:bg-white/80 focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/15 dark:hover:bg-white/25"

export function GlassCard({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <article
      aria-label={label}
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-[22px] border p-4 text-foreground shadow-[0_20px_40px_-28px_rgba(43,79,216,0.35)]",
        GLASS_SURFACE,
        "motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      {children}
    </article>
  )
}

/** One column of a card's figures: the figure, then what it is. */
export function GlassFigure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1.5 text-center">
      <div className="tabular flex min-h-6 items-center text-lg leading-6 font-medium">{children}</div>
      <span className="text-xs text-foreground/65">{label}</span>
    </div>
  )
}
