import Link from "next/link"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"

import { SEVERITY_LABEL, SeverityShape, type Severity } from "@/components/sentra/severity-badge"
import { COUNTED, type SeverityCounts } from "@/lib/risk"
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

const SEVERITY_COLOUR: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  informational: "var(--severity-info)",
}

/**
 * The open findings by severity as one bar with a written legend: the bar is a summary, the legend
 * is the data, so the tile never depends on colour or on width alone (NFR-4.3).
 */
function SeverityBar({ counts, total, href }: { counts: SeverityCounts; total: number; href: string }) {
  return (
    <div className="mt-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {COUNTED.map((severity) =>
          (counts[severity] ?? 0) > 0 ? (
            <span
              key={severity}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${((counts[severity] ?? 0) / total) * 100}%`, background: SEVERITY_COLOUR[severity] }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-1">
        {COUNTED.map((severity) => (
          <li key={severity}>
            <Link
              href={`${href}&severity=${severity}`}
              className="inline-flex min-h-6 items-center gap-1 rounded-[5px] px-1 text-[13px] text-text-secondary hover:underline"
              title={SEVERITY_LABEL[severity as Severity]}
            >
              <SeverityShape severity={severity as Severity} />
              <span className="tabular">{counts[severity] ?? 0}</span>
              <span className="sr-only">{SEVERITY_LABEL[severity as Severity].toLowerCase()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One tile: a number that opens the findings behind it, and a line that breaks it down. */
function Tile({
  title,
  count,
  href,
  children,
  className,
}: {
  title: string
  count: number
  href: string
  children?: React.ReactNode
  className?: string
}) {
  const id = `tile-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section className={cn("rounded-[10px] border bg-card p-4", className)} aria-labelledby={id}>
      <h2 id={id} className="text-[13px] font-medium text-muted-foreground">
        {title}
      </h2>
      <Link
        href={href}
        className="tabular mt-1 -ml-1 inline-block px-1 text-3xl font-semibold tracking-tight hover:underline"
        aria-label={`${title}: ${count}`}
      >
        {count}
      </Link>
      {children}
    </section>
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
  targetQuery,
  changes,
}: {
  openTotal: number
  openBySeverity: SeverityCounts
  awaitingTriage: number
  awaitingRemediation: number
  fixedAndVerified: number
  byStatus: Record<string, number>
  periodDays: number
  /** `&target_id=…` when one target is chosen, so every link keeps the filter. */
  targetQuery: string
  /** The start of the period and the period before it, which the tiles compare with */
  changes: { since: string; open_then: number | null; fixed_before: number }
}) {
  const since = new Date(changes.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const opened = changes.open_then === null ? null : openTotal - changes.open_then
  const fixed = fixedAndVerified - changes.fixed_before
  const open = `/findings?view=open${targetQuery}`
  const closed = `/findings?view=closed${targetQuery}`
  const part = (label: string, count: number, href: string) => (
    <Link href={href} className="text-text-secondary hover:underline">
      <span className="tabular">{count}</span> {label}
    </Link>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile title="Open findings" count={openTotal} href={open}>
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
          <SeverityBar counts={openBySeverity} total={openTotal} href={open} />
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">Nothing is open.</p>
        )}
      </Tile>
      <Tile title="Awaiting triage" count={awaitingTriage} href={open}>
        <p className="mt-2 text-[13px]">
          {part("new", byStatus.new ?? 0, `/findings?view=open&status=new${targetQuery}`)}
          <span className="text-muted-foreground"> · </span>
          {part(
            "require confirmation",
            byStatus.requires_confirmation ?? 0,
            `/findings?view=requires_confirmation${targetQuery}`,
          )}
        </p>
      </Tile>
      <Tile title="Awaiting remediation" count={awaitingRemediation} href={open}>
        <p className="mt-2 text-[13px]">
          {part("confirmed", byStatus.confirmed ?? 0, `/findings?view=open&status=confirmed${targetQuery}`)}
          <span className="text-muted-foreground"> · </span>
          {part("reopened", byStatus.reopened ?? 0, `/findings?view=open&status=reopened${targetQuery}`)}
        </p>
      </Tile>
      <Tile
        title="Fixed and verified"
        count={fixedAndVerified}
        href={`${closed}&status=fixed_and_verified`}
      >
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
      </Tile>
    </div>
  )
}
