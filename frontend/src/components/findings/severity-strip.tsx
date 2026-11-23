import { SEVERITY_LABEL, SeverityShape, type Severity } from "@/components/sentra/severity-badge"
import { cn } from "@/lib/utils"

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"]

/**
 * How many findings of each severity the list holds, as a row of buttons above the table
 * (Screen 38): a press shows only that severity, a second press shows them all again. Each
 * count is what pressing it would show, because it counts the view and every other filter but
 * the severity. Shape, number and word together, never colour alone (NFR-4.3).
 */
export function SeverityStrip({
  counts,
  chosen,
  onChoose,
}: {
  counts: Record<string, number> | undefined
  chosen: string
  onChoose: (severity: string) => void
}) {
  return (
    <div role="group" aria-label="Show one severity" className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
      {SEVERITIES.map((severity) => {
        // Before the list has loaded, or when it couldn't, the strip says "–", as the tabs do
        const count = counts?.[severity]
        const on = chosen === severity
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={on}
            // A severity with nothing in it stays readable but can't be chosen, unless it is the chosen one
            disabled={!count && !on}
            onClick={() => onChoose(on ? "" : severity)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border px-2.5 text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-60",
              on ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted/60",
            )}
          >
            <SeverityShape severity={severity} />
            <span className="tabular font-semibold">{count ?? "–"}</span>
            {SEVERITY_LABEL[severity]}
          </button>
        )
      })}
    </div>
  )
}
