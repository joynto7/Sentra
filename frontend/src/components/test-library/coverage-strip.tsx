import type { CoverageRow } from "@/lib/test-library"
import { cn } from "@/lib/utils"

/** Ten tiles, one per OWASP Top 10 for LLM Applications category. In-scope tiles also filter. */
export function CoverageStrip({
  rows,
  selected,
  onToggle,
}: {
  rows: CoverageRow[]
  selected: string[]
  onToggle: (category: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10" aria-label="OWASP coverage">
      {rows.map((row) => {
        const active = selected.includes(row.category)
        return (
          <button
            key={row.category}
            type="button"
            disabled={!row.in_scope}
            onClick={() => onToggle(row.category)}
            aria-pressed={row.in_scope ? active : undefined}
            title={row.name}
            className={cn(
              "flex flex-col items-start rounded-[10px] border bg-card px-3 py-2 text-left transition-colors",
              row.in_scope && "hover:border-primary",
              active && "border-primary bg-accent",
              !row.in_scope && "cursor-not-allowed bg-muted",
            )}
          >
            <span className="font-mono text-xs font-medium">{row.category}</span>
            {row.in_scope ? (
              <span className="tabular text-lg font-semibold">{row.tests}</span>
            ) : (
              <span className="text-xs text-muted-foreground">Out of scope</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
