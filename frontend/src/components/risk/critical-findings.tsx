"use client"

import { useRef, useState } from "react"
import Link from "next/link"

import { Reproducibility, StatusBadge } from "@/components/findings/finding-badges"
import { FindingDetailSheet } from "@/components/risk/finding-detail-sheet"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { RiskDashboard as Dashboard } from "@/lib/risk"

/**
 * "Critical and high findings": the most serious open findings first, in the order and with the
 * tie-breakers the dashboard's own answer has (the page doesn't sort again). A finding's title
 * opens it in a panel beside the table (`FindingDetailSheet`) without leaving the dashboard, and its
 * number is the link to its own page, as it was.
 */
export function CriticalFindings({
  data,
  filterQuery,
  onChanged,
  className,
}: {
  data: Dashboard["top_findings"]
  filterQuery: string
  onChanged: () => void
  className?: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})
  const lastOpened = useRef<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const choose = (code: string | null) => {
    if (code) lastOpened.current = code
    setOpen(code)
  }
  const shown = Math.min(data.items.length, data.total)
  return (
    <section aria-labelledby="top-findings" className={cn("@container/crit min-w-0 rounded-[10px] border bg-card", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <h2 id="top-findings" ref={heading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
          Critical and high findings
          <span className="ml-2 text-[13px] font-normal text-muted-foreground">Most serious first</span>
        </h2>
        <span className="tabular text-sm text-muted-foreground">
          {shown} of {data.total} ·{" "}
          <Link
            href={`/findings?view=open${filterQuery}`}
            className="inline-flex min-h-6 items-center text-link underline underline-offset-2"
          >
            View all
          </Link>
        </span>
      </div>
      {data.total === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Nothing critical or high is open. The medium and low findings are under Findings.
        </p>
      ) : (
        <Table
          className="table-fixed"
          container={{
            tabIndex: 0,
            role: "group",
            "aria-label": "Critical and high findings",
            className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          }}
        >
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead scope="col" className="text-xs">Finding</TableHead>
              <TableHead scope="col" className="w-[116px] text-xs">Severity</TableHead>
              <TableHead scope="col" className="hidden w-[136px] text-xs @min-[34rem]/crit:table-cell">Status</TableHead>
              <TableHead scope="col" className="hidden w-[104px] text-xs @min-[40rem]/crit:table-cell">Reproducibility</TableHead>
              <TableHead scope="col" className="hidden w-[104px] text-xs @min-[46rem]/crit:table-cell">Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((finding) => (
              <TableRow key={finding.code}>
                <TableCell className="py-2.5 whitespace-normal">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/findings/${finding.code}`}
                      className="inline-flex min-h-6 shrink-0 items-center font-mono text-xs font-medium text-link hover:underline"
                    >
                      {finding.code}
                    </Link>
                    <button
                      type="button"
                      ref={(element) => {
                        buttons.current[finding.code] = element
                      }}
                      onClick={() => choose(finding.code)}
                      aria-label={`Preview ${finding.code}: ${finding.title}`}
                      title={finding.title}
                      className="line-clamp-2 min-h-6 rounded-[5px] text-left text-[13px] leading-snug font-medium hover:text-link focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {finding.title}
                    </button>
                  </div>
                  <span className="mt-1 block @min-[34rem]/crit:hidden">
                    <StatusBadge status={finding.status} />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {finding.target.name}
                    {finding.category && <span className="font-mono"> · {finding.category}</span>}
                    {/* The columns that are out of room say what they hold here */}
                    <span className="@min-[46rem]/crit:hidden">
                      {" · "}
                      {finding.owner ?? "Unassigned"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <SeverityBadge severity={finding.severity} />
                  {finding.provisional && <span className="mt-1 block text-xs text-muted-foreground">Provisional</span>}
                </TableCell>
                <TableCell className="hidden whitespace-normal @min-[34rem]/crit:table-cell">
                  <StatusBadge status={finding.status} />
                </TableCell>
                <TableCell className="hidden @min-[40rem]/crit:table-cell">
                  <Reproducibility value={finding.reproducibility} />
                </TableCell>
                <TableCell className="hidden text-[13px] whitespace-normal @min-[46rem]/crit:table-cell">
                  {finding.owner ?? <span className="text-muted-foreground">Unassigned</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <FindingDetailSheet
        code={open}
        codes={data.items.map((finding) => finding.code)}
        onSelect={choose}
        onChanged={onChanged}
        // After a triage the finding may have left the table: then the keyboard goes to the table's heading
        returnFocus={() => (lastOpened.current ? buttons.current[lastOpened.current] : null) ?? heading.current}
      />
    </section>
  )
}
