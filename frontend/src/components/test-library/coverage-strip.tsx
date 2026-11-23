import { Skeleton } from "@/components/ui/skeleton"
import type { CoverageRow } from "@/lib/test-library"
import { cn } from "@/lib/utils"

/**
 * Ten tiles, one per OWASP Top 10 for LLM Applications category, with the number of tests of each
 * (UC-4.1 step 2). In-scope tiles are buttons that also filter the table; the two out of scope are
 * text. While the numbers load, ten placeholders of the same size hold their place, so nothing
 * below them jumps when they come (CLS, UX task 3.4).
 */
export function CoverageStrip({
  rows,
  selected,
  onToggle,
}: {
  rows: CoverageRow[] | null
  selected: string[]
  onToggle: (category: string) => void
}) {
  if (rows !== null && rows.length === 0) return null // the counts couldn't be loaded: the table still works
  return (
    <section aria-labelledby="coverage-strip" className="space-y-2">
      <p className="text-sm">
        <span id="coverage-strip" className="font-semibold">
          OWASP Top 10 for LLM Applications 2025
        </span>{" "}
        <span className="text-muted-foreground">Select a category to filter the table.</span>
      </p>
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-5 @4xl:grid-cols-10">
        {rows === null
          ? Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} className="h-[52px] rounded-[10px]" aria-hidden="true" />
            ))
          : rows.map((row) => {
              if (!row.in_scope) {
                // Not a control: nothing to choose, so it reads as text, also to a screen reader
                return (
                  <div
                    key={row.category}
                    title={row.name}
                    className="flex h-[52px] flex-col items-start justify-center rounded-[10px] border border-dashed bg-muted px-2"
                  >
                    <span className="font-mono text-xs font-medium">{row.category}</span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      Out of scope<span className="sr-only">: {row.name}</span>
                    </span>
                  </div>
                )
              }
              const active = selected.includes(row.category)
              return (
                <button
                  key={row.category}
                  type="button"
                  onClick={() => onToggle(row.category)}
                  aria-pressed={active}
                  // Starts with what the tile shows, so a voice command such as "LLM01 4" finds it (WCAG 2.5.3)
                  aria-label={`${row.category} ${row.tests} ${row.tests === 1 ? "test" : "tests"}, ${row.name}`}
                  title={row.name}
                  className={cn(
                    "flex h-[52px] flex-col items-start justify-center rounded-[10px] border bg-card px-2 text-left transition-colors",
                    "hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active && "border-primary bg-accent",
                  )}
                >
                  <span className="font-mono text-xs font-medium">{row.category}</span>
                  <span className="tabular text-base leading-tight font-semibold">{row.tests}</span>
                </button>
              )
            })}
      </div>
    </section>
  )
}
