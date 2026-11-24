import Link from "next/link"

import { RiskBandChip } from "@/components/sentra/risk-score"
import { ShieldStatus } from "@/components/targets/shield-status"
import { OwnershipBadge } from "@/components/targets/target-badges"
import { GLASS_BUTTON, GLASS_PILL, GlassCard, GlassFigure } from "@/components/sentra/glass-card"
import { Skeleton } from "@/components/ui/skeleton"
import type { TargetRiskRow } from "@/lib/risk"
import { initials } from "@/lib/session"
import { ENVIRONMENT_LABEL, TYPE_LABEL, type TargetListItem } from "@/lib/targets"

/** What the card knows about the target's score: still loading, failed, or answered. */
export type CardRisk = "loading" | "failed" | "ready"

/**
 * Screen 16 as cards: one target, the same facts as a row of the table. The name, the type and the
 * two badges on top; the score, the open findings and the last run as three figures; the shield and
 * the owner under them; and the two ways on at the bottom: the target itself, and the one quick
 * action the reader may take (create a campaign, verify ownership, restore).
 */
export function TargetCard({
  target,
  row,
  risk,
  notScored,
  menu,
  quick,
}: {
  target: TargetListItem
  row: TargetRiskRow | undefined
  risk: CardRisk
  /** The words for a target without a score, with the way to make it testable */
  notScored: React.ReactNode
  /** The "more" menu in the corner, for the roles that have one */
  menu?: React.ReactNode
  /** The round button at the bottom: its own link or button, 40 px */
  quick?: React.ReactNode
}) {
  const scored = risk === "ready" && row && row.score !== null
  return (
    <GlassCard label={target.name}>
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[#c9d2fa] text-base font-medium text-[#1f2f80] dark:bg-[#27406f] dark:text-[#d8e4ff]"
        >
          {initials(target.name)}
        </span>
        {menu}
      </div>

      <h3 className="mt-3 text-lg leading-6 font-medium">
        <Link
          href={`/targets/${target.id}`}
          className="rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {target.name}
        </Link>
      </h3>
      <p className="text-sm text-foreground/65">
        {TYPE_LABEL[target.type]} ·{" "}
        <span className={target.environment === "production" ? "font-semibold text-foreground" : undefined}>
          {ENVIRONMENT_LABEL[target.environment]}
        </span>
      </p>

      <div className="mt-2.5">
        <OwnershipBadge status={target.status} className={GLASS_PILL} />
      </div>

      <div className="mt-4 flex min-h-[48px] items-stretch divide-x divide-foreground/10">
        {risk === "failed" ? (
          <p className="w-full self-center text-center text-[13px] text-foreground/65">Risk score unavailable</p>
        ) : risk === "loading" ? (
          <>
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2 px-2">
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </>
        ) : scored ? (
          <>
            <GlassFigure label="Risk score">
              <span className="flex items-center gap-2">
                {row.score}
                <RiskBandChip band={row.band ?? "none"} />
              </span>
            </GlassFigure>
            <GlassFigure label="Open findings">
              {Object.values(row.open_by_severity).reduce((sum, count) => sum + (count ?? 0), 0)}
            </GlassFigure>
          </>
        ) : (
          <div className="flex w-full items-center justify-center">{notScored}</div>
        )}
      </div>

      {/* The gateway only gets a line when it is a problem: a quiet "not connected" is not news */}
      {(target.shield.status === "not_reporting" || target.shield.status === "not_in_path") && (
        <div className="mt-3">
          <ShieldStatus shield={target.shield} />
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Link href={`/targets/${target.id}`} className={GLASS_BUTTON}>
          Open target
        </Link>
        {quick}
      </div>
    </GlassCard>
  )
}
