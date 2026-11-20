"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FixChip, StatusChip } from "@/components/remediation/badges"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { AiGeneratedLabel } from "@/components/threat-models/badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type RemediationList as List, type RemediationRow, listRemediations } from "@/lib/remediation"
import { formatDate } from "@/lib/targets"

/** What the row says about the proposal of a finding, or why it has none yet. */
function Proposal({ row }: { row: RemediationRow }) {
  if (row.latest) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">Version {row.latest.version}</span>
        <StatusChip status={row.latest.status} />
        {row.latest.ai_generated && <AiGeneratedLabel />}
        {row.latest.origin === "revised" && (
          <span className="text-xs text-muted-foreground">
            revision of version {row.latest.based_on_version}
          </span>
        )}
      </div>
    )
  }
  if (row.job && (row.job.status === "queued" || row.job.status === "running")) {
    return <span className="text-[13px] text-muted-foreground">Sentra is writing a proposal…</span>
  }
  if (row.blocker) return <span className="text-[13px] text-muted-foreground">{row.blocker}</span>
  return <span className="text-[13px] text-muted-foreground">No proposal yet</span>
}

/**
 * Screen 45: the findings that wait for a fix and the proposals they have (UC-8.2). Everything
 * after the draft — approval, the Shield policy and the retest — comes with FR-8.2 to FR-8.5, so
 * the page shows what exists today: which findings have a proposal, what it recommends, and which
 * ones still wait for one.
 */
export function RemediationList() {
  const [data, setData] = useState<List | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listRemediations(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [attempt])

  const again = useCallback(() => setAttempt((n) => n + 1), [])

  return (
    <>
      <PageHeader
        title="Remediation"
        description="Fixes for confirmed findings. Sentra proposes them; a person reviews every one before anything changes."
      />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The proposals could not be loaded.
            <Button variant="outline" size="sm" onClick={again}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the proposals">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && data.rows.length === 0 && (
        <EmptyState
          title="No confirmed finding waits for a fix"
          description="A finding gets a proposal once a security analyst has confirmed it. Until then it stays under Findings."
          action={
            <Button asChild variant="outline" className="h-9">
              <Link href="/findings">Go to findings</Link>
            </Button>
          }
        />
      )}

      {data && data.rows.length > 0 && (
        <section aria-labelledby="proposals" className="min-w-0 rounded-[10px] border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <h2 id="proposals" className="text-[15px] font-semibold">
              Confirmed findings
            </h2>
            <p className="tabular text-sm text-muted-foreground">
              {data.drafts} {data.drafts === 1 ? "proposal awaits" : "proposals await"} a person ·{" "}
              {data.without_proposal} without a proposal
            </p>
          </div>
          <Table
            container={{
              tabIndex: 0,
              role: "group",
              "aria-label": "Confirmed findings and their proposals",
              className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            }}
          >
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead scope="col" className="text-xs">
                  Finding
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Severity
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Target
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Fixes
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Proposal
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Asked for by
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.finding.code}>
                  <TableCell className="max-w-sm whitespace-normal">
                    <Link
                      href={`/remediation/${row.finding.code}`}
                      className="inline-block py-1 font-medium text-link hover:underline"
                    >
                      {row.finding.code}
                    </Link>
                    <span className="block text-[13px]">{row.finding.title}</span>
                    <span className="block text-xs text-muted-foreground">{row.finding.component}</span>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={row.finding.severity} />
                  </TableCell>
                  <TableCell className="text-[13px]">{row.finding.target_name}</TableCell>
                  <TableCell>
                    {row.latest && row.latest.fixes_in_short.length > 0 ? (
                      <ul className="flex max-w-xs flex-wrap gap-1">
                        {row.latest.fixes_in_short.map((fix, index) => (
                          <li key={index}>
                            <FixChip kind={fix.kind} label={fix.kind_label} enforcement={fix.enforcement} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Proposal row={row} />
                    {row.latest && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {row.latest.fix_count} {row.latest.fix_count === 1 ? "fix" : "fixes"} ·{" "}
                        {formatDate(row.latest.created_at)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {row.latest?.requested_by ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t p-3 text-[13px] text-muted-foreground">
            Every proposal is a draft: nothing it recommends takes effect until a person approves it,
            which comes with the review of FR-8.2.
          </p>
        </section>
      )}
    </>
  )
}
