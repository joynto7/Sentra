import Link from "next/link"

import { SEVERITY_LABEL, SeverityShape, type Severity } from "@/components/sentra/severity-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { COUNTED, COVERAGE_SYMBOL, type CategoryRow, type SeverityCounts } from "@/lib/risk"

// What a gap means here, in three words; the full reason is the cell's tooltip and Screen 43.
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

/** The open findings of one category as a bar; the counts beside it carry the numbers. */
function SeveritySplit({ counts, total }: { counts: SeverityCounts; total: number }) {
  if (total === 0) return <span className="text-[13px] text-muted-foreground">None open</span>
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {COUNTED.map((severity) =>
          (counts[severity] ?? 0) > 0 ? (
            <span
              key={severity}
              className="h-full"
              style={{ width: `${((counts[severity] ?? 0) / total) * 100}%`, background: SEVERITY_COLOUR[severity] }}
            />
          ) : null,
        )}
      </span>
      <span className="flex items-center gap-2">
        {COUNTED.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => (
          <span key={severity} className="flex items-center gap-1 text-[13px]">
            <SeverityShape severity={severity as Severity} />
            <span className="tabular">{counts[severity]}</span>
            <span className="sr-only">{SEVERITY_LABEL[severity as Severity].toLowerCase()}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

/**
 * "Open findings by OWASP category" (Screen 42, FR-7.4): what each category holds and whether it
 * has been tested. The coverage column says it in words and with a symbol, never in colour alone
 * (NFR-4.3), and the whole matrix is Screen 43.
 */
export function CategoryTable({
  rows,
  targetQuery,
  chosen,
  onChoose,
}: {
  rows: CategoryRow[]
  targetQuery: string
  /** The category the dashboard is filtered by, which the table marks. */
  chosen: string | null
  onChoose: (code: string) => void
}) {
  return (
    <section aria-labelledby="by-category" className="min-w-0 rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
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
            <TableHead scope="col" className="text-xs">
              Category
            </TableHead>
            <TableHead scope="col" className="text-xs">
              Open findings
            </TableHead>
            <TableHead scope="col" className="text-xs">
              Coverage
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.code} className={chosen === row.code ? "bg-muted/60" : undefined}>
              <TableCell>
                <button
                  type="button"
                  onClick={() => onChoose(row.code)}
                  className="inline-block rounded-[5px] py-1 text-left text-[13px] font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-pressed={chosen === row.code}
                >
                  {row.code} {row.name}
                </button>
              </TableCell>
              <TableCell>
                {row.open_total > 0 ? (
                  <Link
                    href={`/findings?view=open&category=${row.code}${targetQuery}`}
                    className="flex items-center gap-2 py-1 hover:underline"
                    aria-label={`${row.open_total} open findings in ${row.code}`}
                  >
                    <span className="tabular w-6 text-[13px] font-medium">{row.open_total}</span>
                    <SeveritySplit counts={row.open_by_severity} total={row.open_total} />
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 py-1">
                    <span className="tabular w-6 text-[13px] text-muted-foreground">0</span>
                    <SeveritySplit counts={row.open_by_severity} total={0} />
                  </span>
                )}
              </TableCell>
              <TableCell>
                <span className="text-[13px]" title={row.reason}>
                  <span aria-hidden="true">{COVERAGE_SYMBOL[row.status]} </span>
                  {row.applicable_targets > 1 ? (
                    // With several targets, how many were tested says more than one target's gap.
                    `${row.tested_targets} of ${row.applicable_targets} targets tested`
                  ) : (
                    <>
                      {row.label}
                      {row.worst_target && SHORT[row.status] && (
                        <span className="block text-xs text-muted-foreground">
                          {row.worst_target}: {SHORT[row.status]}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
