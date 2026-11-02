"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FixChip, RetestChip, StatusChip } from "@/components/remediation/badges"
import { type RemediationTab, RemediationTabs } from "@/components/remediation/remediation-tabs"
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
 * How far the fix has come after the approval (UC-8.5, UC-8.6): the changes the developer still
 * has to make, and what the retest said. Each one is a link to the page that can do something
 * about it, so Screen 45 stays the entry to the whole of M8.
 */
function Progress({ row }: { row: RemediationRow }) {
  if (!row.latest) return <span className="text-[13px] text-muted-foreground">—</span>
  return (
    <div className="space-y-1">
      {row.open_changes > 0 && (
        <Link href="/remediation/changes" className="block py-0.5 text-[13px] text-link hover:underline">
          {row.open_changes} application {row.open_changes === 1 ? "change" : "changes"} open
        </Link>
      )}
      {row.retest && (
        <Link
          href={`/remediation/${row.finding.code}/retest`}
          className="inline-flex py-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Retest ${row.retest.number} of ${row.finding.code}: ${row.retest.verdict_label ?? row.retest.status_label}`}
        >
          <RetestChip retest={row.retest} />
        </Link>
      )}
      {row.open_changes === 0 && !row.retest && (
        <span className="text-[13px] text-muted-foreground">—</span>
      )}
    </div>
  )
}

const EMPTY: Record<RemediationTab, { title: string; description: string }> = {
  all: {
    title: "No confirmed finding waits for a fix",
    description:
      "A finding gets a proposal once a security analyst has confirmed it. Until then it stays under Findings.",
  },
  approval: {
    title: "Nothing waits for your approval",
    description:
      "A proposal appears here when a developer sends it for approval and you are allowed to decide it — never the person who last edited it (UC-8.3, 4a).",
  },
  retesting: {
    title: "No retest is running",
    description:
      "Sentra retests a finding by itself as soon as every fix of its approved proposal is in effect, and the comparison appears on the finding.",
  },
  changes: { title: "", description: "" }, // its own page (Screen 50)
}

/**
 * Screen 45: the findings that wait for a fix and how far each one has come (UC-8.2 to UC-8.8).
 * It is the entry to the whole of M8 — the proposal and its approval, the changes the application
 * needs, and the retest that decides whether the weakness is closed — so each row leads to the
 * page where the next step happens.
 */
export function RemediationList() {
  const show = useSearchParams().get("show")
  const tab: RemediationTab = show === "approval" || show === "retesting" ? show : "all"
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

  const rows = !data
    ? []
    : tab === "approval"
      ? data.rows.filter((row) => row.can_approve)
      : tab === "retesting"
        ? data.rows.filter((row) => row.retest?.running)
        : data.rows

  return (
    <>
      <PageHeader
        title="Remediation"
        description="Fixes for confirmed findings, from proposal to verified. Sentra proposes them; a person reviews every one before anything changes."
      />
      <RemediationTabs
        active={tab}
        counts={
          data
            ? {
                all: data.rows.length,
                awaiting_me: data.awaiting_me,
                open_changes: data.open_changes,
                retesting: data.retesting,
              }
            : {}
        }
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

      {data && rows.length === 0 && (
        <EmptyState
          title={EMPTY[tab].title}
          description={EMPTY[tab].description}
          action={
            <Button asChild variant="outline" className="h-9">
              <Link href={tab === "all" ? "/findings" : "/remediation"}>
                {tab === "all" ? "Go to findings" : "All proposals"}
              </Link>
            </Button>
          }
        />
      )}

      {data && rows.length > 0 && (
        <section aria-labelledby="proposals" className="min-w-0 rounded-[10px] border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <h2 id="proposals" className="text-[15px] font-semibold">
              {tab === "approval"
                ? "Awaiting my approval"
                : tab === "retesting"
                  ? "Being retested"
                  : "Confirmed findings"}
            </h2>
            <p className="tabular text-sm text-muted-foreground">
              {tab === "all" ? (
                <>
                  {data.drafts} {data.drafts === 1 ? "proposal awaits" : "proposals await"} a person
                  · {data.without_proposal} without a proposal
                </>
              ) : (
                <>
                  {rows.length} of {data.rows.length}{" "}
                  {data.rows.length === 1 ? "finding" : "findings"}
                </>
              )}
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
                  Verification
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Approver
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
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
                  <TableCell>
                    <Progress row={row} />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {row.latest?.decided_by ? (
                      <>
                        {row.latest.decided_by}
                        {row.latest.decided_at && (
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(row.latest.decided_at)}
                          </span>
                        )}
                      </>
                    ) : row.can_approve ? (
                      <Link
                        href={`/remediation/${row.finding.code}`}
                        className="py-1 text-link hover:underline"
                      >
                        Review it
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t p-3 text-[13px] text-muted-foreground">
            Nothing a proposal recommends takes effect until a person approves it, and no finding is
            closed until a retest finds nothing.
          </p>
        </section>
      )}
    </>
  )
}
