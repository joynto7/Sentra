import Link from "next/link"

import { SEVERITY_LABEL, SeverityShape, type Severity } from "@/components/sentra/severity-badge"
import { COUNTED, type SeverityCounts } from "@/lib/risk"

const SEVERITY_COLOUR: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  informational: "var(--severity-info)",
}

/**
 * The open findings by severity as one bar with a written legend: the bar is a summary, the legend
 * is the data, so it never depends on colour or on width alone (NFR-4.3). Every number opens the
 * findings of its severity.
 */
export function SeverityBreakdown({ counts, total, href }: { counts: SeverityCounts; total: number; href: string }) {
  return (
    <div className="mt-2.5">
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
              className="inline-flex min-h-6 items-center gap-1 rounded-[5px] px-1 text-[13px] text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <SeverityShape severity={severity as Severity} />
              <span className="tabular">{counts[severity] ?? 0}</span>
              <span className="text-xs">{SEVERITY_LABEL[severity as Severity]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
