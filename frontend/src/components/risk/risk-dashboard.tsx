"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"

import { Reproducibility, StatusBadge } from "@/components/findings/finding-badges"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { RiskTiles } from "@/components/risk/risk-tiles"
import { ScoreMethod } from "@/components/risk/score-method"
import { FilterSelect } from "@/components/sentra/filter-select"
import { RiskScore, SeverityCountsStrip } from "@/components/sentra/risk-score"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FindingStatus } from "@/lib/findings"
import { useCan } from "@/lib/permissions"
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  PERIODS,
  type RiskDashboard as Dashboard,
  type TargetRiskRow,
  getRiskDashboard,
  notScoredText,
} from "@/lib/risk"
import { formatDate, formatDateTime } from "@/lib/targets"

const DEFAULT_DAYS = "90"

/** "Findings by status" (UC-7.3 step 3): the lifecycle of the findings, each status a link. */
function ByStatus({
  byStatus,
  periodDays,
  targetQuery,
}: {
  byStatus: Record<string, number>
  periodDays: number
  targetQuery: string
}) {
  const most = Math.max(1, ...Object.values(byStatus))
  const row = (status: FindingStatus, view: "open" | "closed") => {
    const count = byStatus[status] ?? 0
    const query = status === "requires_confirmation" ? "view=requires_confirmation" : `view=${view}&status=${status}`
    return (
      <li key={status}>
        <Link
          href={`/findings?${query}${targetQuery}`}
          className="group flex min-h-6 items-baseline gap-3 rounded-[5px] px-1 py-1 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="w-44">
            <StatusBadge status={status} />
          </span>
          <span className="tabular w-8 text-right text-[13px] font-medium">{count}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-foreground/50"
              style={{ width: `${count === 0 ? 0 : Math.max((count / most) * 100, 3)}%` }}
            />
          </span>
        </Link>
      </li>
    )
  }
  return (
    <section aria-labelledby="by-status" className="min-w-0 rounded-[10px] border bg-card p-4">
      <h2 id="by-status" className="text-[15px] font-semibold">
        Findings by status
      </h2>
      <h3 className="mt-3 text-[13px] font-medium text-muted-foreground">Open</h3>
      <ul className="mt-1 space-y-0.5">{OPEN_STATUSES.map((status) => row(status, "open"))}</ul>
      <h3 className="mt-4 text-[13px] font-medium text-muted-foreground">
        Closed in the last {periodDays} days
      </h3>
      <ul className="mt-1 space-y-0.5">{CLOSED_STATUSES.map((status) => row(status, "closed"))}</ul>
    </section>
  )
}

/** The "Target risk" table (UC-7.3 step 2): a score per target, with the date of its last run. */
function TargetRisk({ rows, canVerify }: { rows: TargetRiskRow[]; canVerify: boolean | undefined }) {
  return (
    <section aria-labelledby="target-risk" className="min-w-0 rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <h2 id="target-risk" className="text-[15px] font-semibold">
          Target risk
        </h2>
        <ScoreMethod />
      </div>
      <Table
        container={{
          tabIndex: 0,
          role: "group",
          "aria-label": "Target risk",
          className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        }}
      >
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead scope="col" className="text-xs">Target</TableHead>
            <TableHead scope="col" className="text-xs">Risk score</TableHead>
            <TableHead scope="col" className="text-xs">Open findings</TableHead>
            <TableHead scope="col" className="text-xs">Awaiting confirmation</TableHead>
            <TableHead scope="col" className="text-xs">Last campaign run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link href={`/targets/${row.id}`} className="inline-block py-1 font-medium text-link hover:underline">
                  {row.name}
                </Link>
                <span className="block text-xs text-muted-foreground">{row.environment}</span>
              </TableCell>
              <TableCell>
                {row.score !== null && row.band !== null ? (
                  <RiskScore score={row.score} band={row.band} />
                ) : (
                  <div className="min-w-44">
                    <span className="text-[13px] text-muted-foreground">{notScoredText(row.not_scored_reason)}</span>
                    {row.not_scored_reason === "ownership_not_verified" && canVerify && (
                      <Link
                        href={`/targets/${row.id}/verify`}
                        className="mt-0.5 inline-block py-1 text-[13px] text-link hover:underline"
                      >
                        Verify ownership
                      </Link>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Link
                  href={`/findings?view=open&target_id=${row.id}`}
                  className="block py-1 hover:underline"
                  aria-label={`${row.open_total} open findings of ${row.name}`}
                >
                  <SeverityCountsStrip counts={row.open_by_severity} />
                </Link>
              </TableCell>
              <TableCell className="tabular">
                {row.awaiting_confirmation > 0 ? (
                  <Link
                    href={`/findings?view=requires_confirmation&target_id=${row.id}`}
                    className="inline-block min-w-6 py-1 text-center text-link hover:underline"
                  >
                    {row.awaiting_confirmation}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell className="text-[13px] whitespace-nowrap">
                {row.last_run_at ? formatDate(row.last_run_at) : <span className="text-muted-foreground">Never</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="tabular border-t p-3 text-sm text-muted-foreground">
        {rows.length} {rows.length === 1 ? "target" : "targets"}
      </p>
    </section>
  )
}

/** Screen 42: the organization's risk at a glance (UC-7.3), and the score of UC-7.2 per target. */
export function RiskDashboard() {
  const canVerify = useCan("verify_targets")
  const [target, setTarget] = useState("")
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [data, setData] = useState<Dashboard | null>(null)
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ days })
    if (target) params.set("target_id", target)
    getRiskDashboard(params, controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
        // The answer holds every target while no target is chosen, which is the filter's list.
        if (!target) setOptions(found.targets.map((row) => ({ id: row.id, name: row.name })))
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [target, days, attempt])

  const filtered = target !== "" || days !== DEFAULT_DAYS
  const reset = useCallback(() => {
    setTarget("")
    setDays(DEFAULT_DAYS)
  }, [])
  const targetQuery = target ? `&target_id=${target}` : ""

  return (
    <>
      <PageHeader
        title="Risk Dashboard"
        description={
          data?.last_run_at
            ? `Updated after every campaign run, triage action and retest · last campaign run ${formatDateTime(data.last_run_at)}`
            : "Updated after every campaign run, triage action and retest"
        }
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/findings">View all findings</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Target"
          value={target}
          onChange={setTarget}
          options={options.map((row) => ({ value: row.id, label: row.name }))}
          allLabel={`All targets${options.length ? ` (${options.length})` : ""}`}
        />
        <FilterSelect
          label="Period"
          value={days}
          onChange={setDays}
          options={PERIODS}
          allLabel={null}
          changed={days !== DEFAULT_DAYS}
        />
        {filtered && (
          <Button variant="ghost" size="sm" className="h-9" onClick={reset}>
            Reset filters
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The dashboard could not be loaded.
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-3" role="status" aria-label="Loading the dashboard">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && data.last_run_at === null && (
        <EmptyState
          title="No campaign results yet"
          description="Register a target, verify that you own it and run a campaign against it. Its findings, severities and risk scores appear here as soon as the first run has ended."
          action={
            <Button asChild className="h-9 hover:bg-primary-hover">
              <Link href="/targets/new">Register target</Link>
            </Button>
          }
        />
      )}

      {data && data.last_run_at !== null && (
        <div className="space-y-3">
          <RiskTiles
            openTotal={data.open_total}
            openBySeverity={data.open_by_severity}
            awaitingTriage={data.awaiting_triage}
            awaitingRemediation={data.awaiting_remediation}
            fixedAndVerified={data.fixed_and_verified}
            byStatus={data.by_status}
            periodDays={data.period_days}
            targetQuery={targetQuery}
          />
          <TargetRisk rows={data.targets} canVerify={canVerify} />
          <div className="grid gap-3 lg:grid-cols-3">
            <ByStatus byStatus={data.by_status} periodDays={data.period_days} targetQuery={targetQuery} />
            <section aria-labelledby="top-findings" className="min-w-0 rounded-[10px] border bg-card lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <h2 id="top-findings" className="text-[15px] font-semibold">
                  Critical and high findings
                </h2>
                <span className="tabular text-sm text-muted-foreground">
                  {Math.min(data.top_findings.items.length, data.top_findings.total)} of {data.top_findings.total} ·{" "}
                  <Link href={`/findings?view=open${targetQuery}`} className="text-link hover:underline">
                    View all
                  </Link>
                </span>
              </div>
              {data.top_findings.total === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Nothing critical or high is open. The medium and low findings are under Findings.
                </p>
              ) : (
                <Table
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
                      <TableHead scope="col" className="text-xs">Severity</TableHead>
                      <TableHead scope="col" className="text-xs">Reproducibility</TableHead>
                      <TableHead scope="col" className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.top_findings.items.map((finding) => (
                      <TableRow key={finding.code}>
                        <TableCell>
                          <Link
                            href={`/findings/${finding.code}`}
                            className="inline-block py-1 font-medium text-link hover:underline"
                          >
                            {finding.code}
                          </Link>
                          <span className="block max-w-xs truncate text-[13px]" title={finding.title}>
                            {finding.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">{finding.target.name}</span>
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={finding.severity} />
                          {finding.provisional && (
                            <span className="mt-1 block text-xs text-muted-foreground">Provisional</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Reproducibility value={finding.reproducibility} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={finding.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  )
}
