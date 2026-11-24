"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Sparkles } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusChip } from "@/components/remediation/badges"
import { RemediationCard } from "@/components/remediation/remediation-card"
import { Progress } from "@/components/remediation/remediation-progress"
import { type RemediationTab, RemediationTabs } from "@/components/remediation/remediation-tabs"
import { ViewSwitch, useStoredView } from "@/components/sentra/view-switch"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { refused, useKeptAnswer, useKeptScroll } from "@/hooks/use-kept-list"
import { type RemediationList as List, type RemediationRow, listRemediations } from "@/lib/remediation"

/** What the row says about the proposal of a finding: its state and one line of facts, or why it has none yet. */
function Proposal({ row }: { row: RemediationRow }) {
  if (row.latest) {
    return (
      <div className="space-y-1.5">
        <StatusChip status={row.latest.status} />
        <p className="tabular flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>
            Version {row.latest.version} · {row.latest.fix_count} {row.latest.fix_count === 1 ? "fix" : "fixes"}
          </span>
          {row.latest.ai_generated && (
            <span className="inline-flex items-center gap-1 text-confirm">
              <Sparkles className="size-3" aria-hidden="true" />
              AI-generated
            </span>
          )}
        </p>
      </div>
    )
  }
  if (row.job && (row.job.status === "queued" || row.job.status === "running")) {
    return <span className="text-[13px] text-muted-foreground">Sentra is writing a proposal…</span>
  }
  if (row.blocker) return <span className="text-[13px] text-muted-foreground">{row.blocker}</span>
  return <span className="text-[13px] text-muted-foreground">No proposal yet</span>
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
      "A proposal appears here when a developer sends it for approval and you are allowed to decide it — never the person who last edited it.",
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
  // The answer kept for Back (UX task 3.0): coming back shows the list at once, and where the
  // reader was in it, and refreshes it behind
  const [kept, keep, drop] = useKeptAnswer<List>("remediation")
  const [data, setData] = useState<List | null>(kept)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useKeptScroll("remediation", `remediation?show=${tab}`, data !== null)
  const [view, setView] = useStoredView("remediation")

  useEffect(() => {
    const controller = new AbortController()
    listRemediations(controller.signal)
      .then((found) => {
        setData(found)
        keep(found)
        setError(false)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return
        // A list the reader may no longer read leaves the page and the memory (UX task 3.0)
        if (refused(problem)) {
          drop()
          setData(null)
        }
        setError(true)
      })
    return () => controller.abort()
  }, [attempt, keep, drop])

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
      <PageHeader title="Remediation" description="Fixes for confirmed findings." />
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
            <Button variant="outline" size="sm" className="h-9 text-foreground" onClick={again}>
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
            <div className="flex flex-wrap items-center gap-3">
              <p className="tabular text-sm text-muted-foreground">
                {tab === "all" ? (
                  <>
                    {data.drafts} {data.drafts === 1 ? "proposal awaits" : "proposals await"} a person ·{" "}
                    {data.without_proposal} without a proposal
                  </>
                ) : (
                  <>
                    {rows.length} of {data.rows.length} {data.rows.length === 1 ? "finding" : "findings"}
                  </>
                )}
              </p>
              <ViewSwitch value={view} onChange={setView} />
            </div>
          </div>
          {view === "cards" ? (
            <ul className="grid gap-4 bg-muted/40 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.map((row) => (
                <li key={row.finding.code} className="min-w-0">
                  <RemediationCard row={row} />
                </li>
              ))}
            </ul>
          ) : (
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
                  <TableHead scope="col" className="w-44 text-xs">
                    Proposal
                  </TableHead>
                  <TableHead scope="col" className="w-44 text-xs">
                    Progress
                  </TableHead>
                  <TableHead scope="col" className="w-24 text-xs">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.finding.code}>
                    <TableCell className="min-w-56 max-w-md py-3 whitespace-normal">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/remediation/${row.finding.code}`}
                          className="inline-flex min-h-6 items-center font-mono text-[13px] font-medium text-link hover:underline"
                        >
                          {row.finding.code}
                        </Link>
                        <SeverityBadge severity={row.finding.severity} />
                      </div>
                      <span className="mt-1 line-clamp-2 block text-[13px] font-medium">{row.finding.title}</span>
                      <span className="block text-xs text-muted-foreground">{row.finding.target_name}</span>
                    </TableCell>
                    <TableCell className="py-3 whitespace-normal">
                      <Proposal row={row} />
                    </TableCell>
                    <TableCell className="py-3 whitespace-normal">
                      <Progress row={row} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <Button
                        asChild
                        variant={row.can_approve ? "default" : "outline"}
                        size="sm"
                        className="h-8 rounded-full px-4"
                      >
                        <Link
                          href={`/remediation/${row.finding.code}`}
                          aria-label={`${row.can_approve ? "Review" : "Open"} the proposal for ${row.finding.code}`}
                        >
                          {row.can_approve ? "Review" : "Open"}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="border-t p-3 text-[13px] text-muted-foreground">
            Nothing takes effect until a person approves it.
          </p>
        </section>
      )}
    </>
  )
}
