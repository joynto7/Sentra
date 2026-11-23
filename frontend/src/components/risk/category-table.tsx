import Link from "next/link"

import { SEVERITY_LABEL, type Severity } from "@/components/sentra/severity-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { COUNTED, COVERAGE_SYMBOL, type CategoryRow, type SeverityCounts } from "@/lib/risk"
import { cn } from "@/lib/utils"

// What a gap means here, in three words; the full reason is the cell's tooltip and Framework Coverage.
const SHORT: Record<string, string> = {
  gap: "never tested",
  stale: "changed since its last test",
}

const SEVERITY_COLOUR: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  informational: "var(--severity-info)",
}

/** The open findings of one category as one bar, its parts on the same scale in every row, so the
 * rows compare at a glance; the count beside it and the link's name carry the numbers. */
function SeverityBar({ counts, most }: { counts: SeverityCounts; most: number }) {
  return (
    <span className="flex h-2 w-full max-w-40 gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {COUNTED.map((severity) =>
        (counts[severity] ?? 0) > 0 ? (
          <span
            key={severity}
            className="h-full"
            style={{ width: `${((counts[severity] ?? 0) / most) * 100}%`, background: SEVERITY_COLOUR[severity] }}
          />
        ) : null,
      )}
    </span>
  )
}

/** "12 open findings in LLM01: 1 critical, 2 high, 5 medium, 4 low" */
function spoken(row: CategoryRow): string {
  const parts = COUNTED.filter((severity) => (row.open_by_severity[severity] ?? 0) > 0).map(
    (severity) => `${row.open_by_severity[severity]} ${SEVERITY_LABEL[severity as Severity].toLowerCase()}`,
  )
  return `${row.open_total} open findings in ${row.code}: ${parts.join(", ")}`
}

/**
 * "Open findings by OWASP category" (Screen 42; FR-7.4, M7): what each category holds and whether it
 * has been tested. The coverage column says it in words and with a symbol, never in colour alone
 * (NFR-4.3), and the whole matrix is Framework Coverage. Categories that are out of scope and hold
 * nothing are named once under the table instead of taking a row each.
 */
export function CategoryTable({
  rows,
  targetQuery,
  chosen,
  onChoose,
  className,
}: {
  rows: CategoryRow[]
  targetQuery: string
  /** The category the dashboard is filtered by, which the table marks. */
  chosen: string | null
  onChoose: (code: string) => void
  className?: string
}) {
  const shown = rows.filter((row) => row.status !== "out_of_scope" || row.open_total > 0 || row.code === chosen)
  const folded = rows.filter((row) => !shown.includes(row))
  const most = Math.max(1, ...rows.map((row) => row.open_total))
  const total = rows.reduce((sum, row) => sum + row.open_total, 0)
  const holding = rows.filter((row) => row.open_total > 0).length
  return (
    <section aria-labelledby="by-category" className={cn("min-w-0 rounded-[10px] border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="by-category" className="text-[15px] font-semibold">
          Open findings by OWASP category
        </h2>
        <Link href="/framework-coverage" className="inline-block py-0.5 text-[13px] text-link hover:underline">
          Framework coverage
        </Link>
      </div>
      <Table
        container={{
          tabIndex: 0,
          role: "group",
          "aria-label": "Open findings by OWASP category",
          className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        }}
      >
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead scope="col" className="text-xs">Category</TableHead>
            <TableHead scope="col" className="text-xs">By severity</TableHead>
            <TableHead scope="col" className="text-right text-xs">Open</TableHead>
            <TableHead scope="col" className="text-xs">Coverage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.code} className={chosen === row.code ? "bg-muted/60" : undefined}>
              <TableCell className="py-1.5">
                <button
                  type="button"
                  onClick={() => onChoose(row.code)}
                  className="inline-block min-h-6 rounded-[5px] text-left text-[13px] font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-pressed={chosen === row.code}
                >
                  <span className="font-mono">{row.code}</span> {row.name}
                </button>
              </TableCell>
              <TableCell className="w-32 py-1.5">
                {row.open_total > 0 ? <SeverityBar counts={row.open_by_severity} most={most} /> : null}
              </TableCell>
              <TableCell className="py-1.5 text-right">
                {row.open_total > 0 ? (
                  <Link
                    href={`/findings?view=open&category=${row.code}${targetQuery}`}
                    className="tabular inline-block min-h-6 min-w-6 text-[13px] font-medium text-link hover:underline"
                    aria-label={spoken(row)}
                  >
                    {row.open_total}
                  </Link>
                ) : (
                  <span className="tabular text-[13px] text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell className="py-1.5 whitespace-normal">
                <span className="text-[13px]" title={row.reason}>
                  <span aria-hidden="true">{COVERAGE_SYMBOL[row.status]} </span>
                  {/* With several targets, how many were tested says more than one target's word */}
                  {row.applicable_targets > 1 ? `${row.tested_targets} of ${row.applicable_targets} targets tested` : row.label}
                  {/* The weakest target's gap stays readable without a pointer (Screen 42) */}
                  {row.worst_target && SHORT[row.status] && (
                    <span className="block text-xs text-muted-foreground">
                      {row.worst_target}: {SHORT[row.status]}
                    </span>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Severities in the bars">
          {COUNTED.map((severity) => (
            <li key={severity} className="flex items-center gap-1">
              <span className="size-2.5 rounded-[2px]" style={{ background: SEVERITY_COLOUR[severity] }} aria-hidden="true" />
              {SEVERITY_LABEL[severity as Severity]}
            </li>
          ))}
        </ul>
        <span className="tabular">
          {total} open {total === 1 ? "finding" : "findings"} in {holding} {holding === 1 ? "category" : "categories"}
          {folded.length > 0 && (
            <>
              {" · "}
              {folded.map((row) => row.code).join(" and ")} out of scope
            </>
          )}
        </span>
      </div>
    </section>
  )
}
