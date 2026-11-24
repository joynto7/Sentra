import { SEVERITY_LABEL, type Severity, SeverityShape } from "@/components/sentra/severity-badge"
import { BAND_LABEL, COUNTED, type RiskBand, type SeverityCounts } from "@/lib/risk"
import { cn } from "@/lib/utils"

/** A band is named after the severity that set it and shares its colour (FR-7.2, UC-7.2). */
const BAND_COLOUR: Record<RiskBand, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  none: "var(--muted-foreground)",
}

// The same tints as a severity badge, so the name has enough contrast in the light and the dark
// theme (WCAG 1.4.3); on the card's own background the text colour alone doesn't.
const BAND_CHIP: Record<RiskBand, string> = {
  critical: "bg-[var(--severity-critical-bg)] text-[var(--severity-critical-text)]",
  high: "bg-[var(--severity-high-bg)] text-[var(--severity-high-text)]",
  medium: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-text)]",
  low: "bg-[var(--severity-low-bg)] text-[var(--severity-low-text)]",
  none: "bg-muted text-muted-foreground",
}

/** The band's name on its own, in the band's tint: the words carry it, the colour only helps. */
export function RiskBandChip({ band, className }: { band: RiskBand; className?: string }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", BAND_CHIP[band], className)}>
      {BAND_LABEL[band]}
    </span>
  )
}

/**
 * A risk score from 0 to 100 with its band: the number, a bar and the band's name, so that the
 * score never depends on colour alone (NFR-4.3). "lg" is the risk card of Screen 20.
 */
export function RiskScore({
  score,
  band,
  size = "sm",
  className,
}: {
  score: number
  band: RiskBand
  size?: "sm" | "lg"
  className?: string
}) {
  const large = size === "lg"
  return (
    <div className={cn("min-w-28", className)}>
      <div className="flex items-baseline gap-2">
        <span className={cn("tabular font-semibold", large ? "text-3xl" : "text-[15px]")}>{score}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", BAND_CHIP[band])}>
          {BAND_LABEL[band]}
        </span>
      </div>
      <div className={cn("mt-1 w-full overflow-hidden rounded-full bg-muted", large ? "h-2" : "h-1.5")} aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${Math.max(score, 2)}%`, background: BAND_COLOUR[band] }} />
      </div>
    </div>
  )
}

/**
 * The open findings of a target by severity, as compact counts with their shapes (Screens 16, 20
 * and 42). Each number carries its severity's name for screen readers (NFR-4.3), and none of them
 * is a tab stop: a table of targets would otherwise have four more stops per row.
 */
export function SeverityCountsStrip({ counts, className }: { counts: SeverityCounts; className?: string }) {
  const total = COUNTED.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0)
  if (total === 0) return <span className={cn("text-sm text-muted-foreground", className)}>None open</span>
  return (
    <ul className={cn("flex items-center gap-2.5", className)}>
      {COUNTED.map((severity) => (
        <li key={severity} className="flex items-center gap-1">
          <SeverityShape severity={severity as Severity} />
          <span className="tabular text-[13px]">
            {counts[severity] ?? 0}
            <span className="sr-only"> {SEVERITY_LABEL[severity as Severity].toLowerCase()} findings</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
