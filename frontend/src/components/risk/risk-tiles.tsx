import Link from "next/link"

import { SEVERITY_LABEL, SeverityShape, type Severity } from "@/components/sentra/severity-badge"
import { COUNTED, type SeverityCounts } from "@/lib/risk"
import { cn } from "@/lib/utils"

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
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {COUNTED.map((severity) => (
          <li key={severity}>
            <Link
              href={`${href}&severity=${severity}`}
              className="flex items-center gap-1 py-0.5 text-[13px] text-text-secondary hover:underline"
            >
              <SeverityShape severity={severity as Severity} />
              <span className="tabular">{counts[severity] ?? 0}</span>
              {SEVERITY_LABEL[severity as Severity]}
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
}) {
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
        <p className="mt-2 text-[13px] text-muted-foreground">
          Closed by a retest in the last {periodDays} days.
        </p>
      </Tile>
    </div>
  )
}
