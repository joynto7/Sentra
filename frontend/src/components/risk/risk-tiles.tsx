import Link from "next/link"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"

import { RiskSummaryCard } from "@/components/risk/risk-summary-card"
import { SeverityBreakdown } from "@/components/risk/severity-breakdown"
import { type SeverityCounts } from "@/lib/risk"
import { cn } from "@/lib/utils"

/**
 * A change against an earlier moment, said three ways at once: an arrow, a sign and a colour, so
 * it never rests on colour alone (WCAG 1.4.1). `worseWhen` says which way is bad: more open
 * findings read as worse, more fixed findings as better — never green for more risk.
 */
export function Delta({
  change,
  worseWhen,
  against,
  spoken,
  className,
}: {
  change: number
  worseWhen: "up" | "down"
  /** After the figure: "since 12 Aug". Without a change it is the whole line: "Same as on 12 Aug" */
  against: string
  /** The whole change as a sentence, for screen readers */
  spoken: string
  className?: string
}) {
  const worse = change !== 0 && (change > 0) === (worseWhen === "up")
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus
  return (
    <p
      className={cn(
        "flex items-center gap-1 text-[13px]",
        change === 0 ? "text-muted-foreground" : worse ? "text-destructive" : "text-success",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span aria-hidden="true">
        {change !== 0 && <span className="tabular font-medium">{`${change > 0 ? "+" : "−"}${Math.abs(change)} `}</span>}
        {against}
      </span>
      <span className="sr-only">{spoken}</span>
    </p>
  )
}

/**
 * The four tiles of Screen 42 (UC-7.3 steps 2-3): what is open, what waits for a person, what
 * waits for a fix and what was fixed and verified in the period. Every number opens the findings
 * it counts (Screen 38), which is what the screen asks for.
 */
export function RiskTiles({
  openTotal,
  openBySeverity,
  awaitingTriage,
  awaitingRemediation,
  fixedAndVerified,
  byStatus,
  periodDays,
  filterQuery,
  changes,
}: {
  openTotal: number
  openBySeverity: SeverityCounts
  awaitingTriage: number
  awaitingRemediation: number
  fixedAndVerified: number
  byStatus: Record<string, number>
  periodDays: number
  /** `&target_id=…&category=…` for the chosen target and category, so every link keeps them */
  filterQuery: string
  /** The start of the period and the period before it, which the tiles compare with */
  changes: { since: string; open_then: number | null; fixed_before: number }
}) {
  const since = new Date(changes.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const opened = changes.open_then === null ? null : openTotal - changes.open_then
  const fixed = fixedAndVerified - changes.fixed_before
  const open = `/findings?view=open${filterQuery}`
  // The period's closings open with the period's start, so the list holds what the tile counts
  const closedInPeriod = `/findings?view=closed&closed_from=${encodeURIComponent(changes.since)}${filterQuery}`
  const part = (label: string, count: number, href: string) => (
    <Link href={href} className="inline-flex min-h-6 items-center gap-1 text-text-secondary hover:underline">
      <span className="tabular">{count}</span> {label}
    </Link>
  )
  return (
    <div className="grid grid-cols-1 gap-3 @min-[28rem]/dash:grid-cols-2 @min-[56rem]/dash:grid-cols-4">
      <RiskSummaryCard title="Open findings" count={openTotal} href={open}>
        {opened !== null && (
          <Delta
            change={opened}
            worseWhen="up"
            against={opened === 0 ? `Same as on ${since}` : `since ${since}`}
            spoken={
              opened === 0
                ? `As many open findings as on ${since}.`
                : `${Math.abs(opened)} ${opened > 0 ? "more" : "fewer"} open findings than on ${since}.`
            }
          />
        )}
        {openTotal > 0 ? (
          <SeverityBreakdown counts={openBySeverity} total={openTotal} href={open} />
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">Nothing is open.</p>
        )}
      </RiskSummaryCard>
      <RiskSummaryCard title="Awaiting triage" count={awaitingTriage} href={`/findings?view=awaiting_triage${filterQuery}`}>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px]">
          {part("new", byStatus.new ?? 0, `/findings?view=open&status=new${filterQuery}`)}
          <span className="text-muted-foreground" aria-hidden="true">·</span>
          {part(
            "require confirmation",
            byStatus.requires_confirmation ?? 0,
            `/findings?view=requires_confirmation${filterQuery}`,
          )}
        </p>
      </RiskSummaryCard>
      <RiskSummaryCard
        title="Awaiting remediation"
        count={awaitingRemediation}
        href={`/findings?view=awaiting_remediation${filterQuery}`}
      >
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px]">
          {part("confirmed", byStatus.confirmed ?? 0, `/findings?view=open&status=confirmed${filterQuery}`)}
          <span className="text-muted-foreground" aria-hidden="true">·</span>
          {part("reopened", byStatus.reopened ?? 0, `/findings?view=open&status=reopened${filterQuery}`)}
        </p>
      </RiskSummaryCard>
      <RiskSummaryCard title="Fixed and verified" count={fixedAndVerified} href={`${closedInPeriod}&status=fixed_and_verified`}>
        <Delta
          change={fixed}
          worseWhen="down"
          against={fixed === 0 ? `Same as the ${periodDays} days before` : `vs the ${periodDays} days before`}
          spoken={
            fixed === 0
              ? `As many as in the ${periodDays} days before.`
              : `${Math.abs(fixed)} ${fixed > 0 ? "more" : "fewer"} than in the ${periodDays} days before.`
          }
        />
        <p className="mt-1 text-[13px] text-muted-foreground">
          Closed by a retest in the last {periodDays} days.
        </p>
      </RiskSummaryCard>
    </div>
  )
}
