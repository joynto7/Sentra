"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { RefreshCw } from "lucide-react"

import { StatusBadge } from "@/components/findings/finding-badges"
import { EmptyState } from "@/components/layout/empty-state"
import { ReportDialog } from "@/components/reports/report-dialog"
import { BreakdownCharts } from "@/components/risk/breakdown-charts"
import { CategoryTable } from "@/components/risk/category-table"
import { CriticalFindings } from "@/components/risk/critical-findings"
import { DEFAULT_DAYS, DashboardFilters, focusFilters } from "@/components/risk/dashboard-filters"
import { NeedsAttention } from "@/components/risk/needs-attention"
import { RiskTiles } from "@/components/risk/risk-tiles"
import { TargetRisk } from "@/components/risk/target-risk"
import { TrendCharts } from "@/components/risk/trend-charts"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { refused } from "@/hooks/use-kept-list"
import { useUrlState } from "@/hooks/use-url-state"
import type { FindingStatus } from "@/lib/findings"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { CLOSED_STATUSES, OPEN_STATUSES, PERIODS, type RiskDashboard as Dashboard, getRiskDashboard } from "@/lib/risk"
import { formatDateTime, listTargets } from "@/lib/targets"
import { cn } from "@/lib/utils"

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const clock = (at: Date) => at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/** "Findings by status" (UC-7.3 step 3): the lifecycle of the findings, each status a link. */
function ByStatus({
  byStatus,
  periodDays,
  filterQuery,
  since,
}: {
  byStatus: Record<string, number>
  periodDays: number
  filterQuery: string
  /** The start of the period: a closed count opens the findings closed since then */
  since: string
}) {
  const most = Math.max(1, ...Object.values(byStatus))
  const row = (status: FindingStatus, view: "open" | "closed") => {
    const count = byStatus[status] ?? 0
    const query =
      status === "requires_confirmation"
        ? "view=requires_confirmation"
        : view === "closed"
          ? `view=closed&status=${status}&closed_from=${encodeURIComponent(since)}`
          : `view=open&status=${status}`
    return (
      <li key={status}>
        <Link
          href={`/findings?${query}${filterQuery}`}
          className="group flex min-h-8 items-center gap-3 rounded-[5px] px-1 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      <ul className="mt-1">{OPEN_STATUSES.map((status) => row(status, "open"))}</ul>
      <h3 className="mt-3 text-[13px] font-medium text-muted-foreground">Closed in the last {periodDays} days</h3>
      <ul className="mt-1">{CLOSED_STATUSES.map((status) => row(status, "closed"))}</ul>
      <p className="mt-3 text-xs text-muted-foreground">Bars share one scale of 0 to {most} findings.</p>
    </section>
  )
}

/**
 * The Risk Dashboard (UC-7.3), and the score of UC-7.2 per target. The page reads in the order the
 * questions come: how much is open and is it more or less than before; what I should look at now,
 * with the most serious findings beside what needs me; which targets are worst and moving which
 * way; how it developed; and by status and by category. Its three filters are in its address, so a
 * reload, Back, or a link somebody shares opens the same view.
 */
export function RiskDashboard() {
  // When the address changes without the page (the menu's link, Back or Forward), the page starts
  // again from the new address, as if it had just been opened
  const [opened, setOpened] = useState(0)
  return <DashboardFromAddress key={opened} onOutside={() => setOpened((count) => count + 1)} />
}

function DashboardFromAddress({ onOutside }: { onOutside: () => void }) {
  const canVerify = useCan("verify_targets")
  const canReport = useCan("generate_reports")
  const canRegister = useCan("manage_targets")
  const canRun = useCan("manage_campaigns")
  const canLab = useCan("use_security_lab")
  const query = useSearchParams()
  const [report, setReport] = useState(false)
  const [target, setTarget] = useState(query.get("target") ?? "")
  const askedDays = query.get("days")
  const [days, setDays] = useState(PERIODS.some((one) => one.value === askedDays) ? (askedDays as string) : DEFAULT_DAYS)
  const [category, setCategory] = useState((query.get("category") ?? "").slice(0, 20))
  const [data, setData] = useState<Dashboard | null>(null)
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])
  // The API's own words when it gave any (too many requests, a session that ended), else ours
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  // Which filters the numbers on screen belong to: while they differ from the chosen ones, the
  // page is updating
  const asked = `${target}|${days}|${category}|${attempt}`
  const [answered, setAnswered] = useState("")
  const loading = answered !== asked

  // The filters are in the address, except what a person has not chosen
  useUrlState({ target, days, category }, { days: DEFAULT_DAYS }, onOutside)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ days })
    if (target) params.set("target_id", target)
    if (category) params.set("category", category)
    getRiskDashboard(params, controller.signal)
      .then((found) => {
        setData(found)
        setError(null)
        setCheckedAt(new Date())
        setAnswered(`${target}|${days}|${category}|${attempt}`)
        // The answer holds every target while no target is chosen, which is the filter's list.
        if (!target) setOptions(found.targets.map((row) => ({ id: row.id, name: row.name })))
      })
      .catch((failure) => {
        if (controller.signal.aborted) return
        // Numbers of other filters would contradict the filters above them: they go
        setError(
          refused(failure)
            ? (failure as ApiError).status === 401
              ? "Your login has ended. Log in again to see the dashboard."
              : "You can't see the dashboard of this organization any more. Ask an Organization Administrator for access."
            : failure instanceof ApiError
              ? failure.message
              : "The dashboard could not be loaded.",
        )
        setData(null)
        setAnswered(`${target}|${days}|${category}|${attempt}`)
      })
    return () => controller.abort()
  }, [target, days, category, attempt])

  // A page opened with a target in its address has no answer that holds them all: the filter's
  // list comes from the targets themselves
  useEffect(() => {
    if (!target || options.length > 0) return
    const controller = new AbortController()
    listTargets(new URLSearchParams({ tab: "active", page_size: "100" }), controller.signal)
      .then((found) => setOptions(found.items.map((one) => ({ id: one.id, name: one.name }))))
      .catch(() => undefined)
    return () => controller.abort()
  }, [target, options.length])

  const filtered = target !== "" || days !== DEFAULT_DAYS || category !== ""
  const reset = useCallback(() => {
    setTarget("")
    setDays(DEFAULT_DAYS)
    setCategory("")
  }, [])
  const targetQuery = target ? `&target_id=${target}` : ""
  // Every link carries the chosen target and category, so it opens what its number counts
  const filterQuery = `${targetQuery}${category ? `&category=${category}` : ""}`
  // Before any run has ended, a run that is going on is what there is to see
  const firstRun = data?.targets.find((row) => row.live_run)
  const since = data ? shortDate(data.changes.since) : ""
  const calculated = data?.targets
    .map((row) => row.calculated_at)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1)
  const freshness = [
    "Updated after every campaign run, triage action and retest",
    data?.last_run_at ? `last campaign run ${formatDateTime(data.last_run_at)}` : null,
    calculated ? `scores calculated ${formatDateTime(calculated)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="@container/dash">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold tracking-tight">Risk Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">{freshness}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="h-9 gap-1.5 text-muted-foreground"
            onClick={() => setAttempt((n) => n + 1)}
            aria-label={checkedAt ? `Refresh the dashboard, last checked at ${clock(checkedAt)}` : "Refresh the dashboard"}
          >
            <RefreshCw className={cn(loading && "motion-safe:animate-spin")} aria-hidden="true" />
            <span className="tabular">{loading ? "Updating" : checkedAt ? `Checked ${clock(checkedAt)}` : "Refresh"}</span>
          </Button>
          <Button asChild variant="outline" className="h-9">
            <Link href="/findings">View all findings</Link>
          </Button>
          {canReport && (
            <Button className="h-9 hover:bg-primary-hover" onClick={() => setReport(true)}>
              Generate executive report
            </Button>
          )}
        </div>
      </div>

      {/* UC-9.1, 1a1: the report takes the filters this page is showing. */}
      <ReportDialog
        open={report}
        preset={{
          target_id: target || null,
          period_days: Number(days),
          // What the page's filters say now, not what the last answer was about
          category: category || null,
          label: `${target ? (options.find((one) => one.id === target)?.name ?? "one target") : `All targets${options.length ? ` (${options.length})` : ""}`} · ${PERIODS.find((one) => one.value === days)?.label ?? `Last ${days} days`} · ${category || "All OWASP categories"}`,
        }}
        onClose={() => setReport(false)}
        onDone={() => undefined}
      />

      <DashboardFilters
        target={target}
        days={days}
        category={category}
        targets={options.map((row) => ({ value: row.id, label: row.name }))}
        categories={(data?.by_category ?? []).map((row) => ({ value: row.code, label: `${row.code} ${row.name ?? ""}`.trim() }))}
        onTarget={setTarget}
        onDays={setDays}
        onCategory={setCategory}
        onReset={reset}
      />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            {error}
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
              {filtered && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    reset()
                    focusFilters()
                  }}
                >
                  Reset filters
                </Button>
              )}
            </span>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-3" role="status" aria-label="Loading the dashboard">
          <div className="grid grid-cols-1 gap-3 @min-[28rem]/dash:grid-cols-2 @min-[56rem]/dash:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[112px] w-full" />
            ))}
          </div>
          <div className="grid gap-3 @min-[58rem]/dash:grid-cols-12">
            <Skeleton className="h-[360px] w-full @min-[58rem]/dash:col-span-8" />
            <Skeleton className="h-[360px] w-full @min-[58rem]/dash:col-span-4" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* While new filters load, the page keeps its frame and says it is updating */}
      <p className="sr-only" role="status">
        {loading && data ? "Updating the dashboard" : ""}
      </p>
      {data && (
        <div className={cn("space-y-3", loading && "opacity-60 transition-opacity motion-reduce:transition-none")} aria-busy={loading}>
          {data.last_run_at === null && <NeedsAttention filtered={target !== "" || category !== ""} />}

          {data.last_run_at === null && firstRun && (
            <EmptyState
              title="The first campaign run is going on"
              description={`${firstRun.name}: ${firstRun.live_run?.code}. Its findings, severities and risk scores appear here as soon as it has ended.`}
              action={
                <Button asChild className="h-9 hover:bg-primary-hover">
                  <Link href={`/campaigns/${firstRun.live_run?.campaign}/runs/${firstRun.live_run?.number}`}>
                    Open the live monitor
                  </Link>
                </Button>
              }
            />
          )}

          {data.last_run_at === null && !firstRun && (
            <EmptyState
              title="No campaign results yet"
              description={
                canRegister
                  ? "Register a target and verify that you own it; a Security Analyst then runs a campaign against it. Its findings, severities and risk scores appear here as soon as the first run has ended."
                  : canRun
                    ? "Run a campaign against a verified target. Its findings, severities and risk scores appear here as soon as the first run has ended."
                    : "Findings, severities and risk scores appear here after the first campaign run. An AI Application Developer registers and verifies a target, and a Security Analyst runs the campaign."
              }
              action={
                canRegister || canRun || canLab ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {canRegister ? (
                      <Button asChild className="h-9 hover:bg-primary-hover">
                        <Link href="/targets/new">Register target</Link>
                      </Button>
                    ) : canRun ? (
                      <Button asChild className="h-9 hover:bg-primary-hover">
                        <Link href="/campaigns/new">Create campaign</Link>
                      </Button>
                    ) : null}
                    {canLab && (
                      <Button asChild variant="outline" className="h-9">
                        <Link href="/lab">Deploy a lab target</Link>
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
            />
          )}

          {data.last_run_at !== null && (
            <>
              <RiskTiles
                openTotal={data.open_total}
                openBySeverity={data.open_by_severity}
                awaitingTriage={data.awaiting_triage}
                awaitingRemediation={data.awaiting_remediation}
                fixedAndVerified={data.fixed_and_verified}
                byStatus={data.by_status}
                periodDays={data.period_days}
                filterQuery={filterQuery}
                changes={data.changes}
              />
              {data.category_filtered && (
                <p className="text-[13px] text-muted-foreground">
                  The counts, the status list and the charts are narrowed to {data.category}. The category table keeps
                  every category, so that another one can be chosen. A risk score covers all of a target&apos;s
                  findings, so the scores and their lines stay as they are.
                </p>
              )}
              {/* The working area: the most serious findings, and what needs this person now */}
              <div className="grid items-start gap-3 @min-[58rem]/dash:grid-cols-12">
                <CriticalFindings
                  className="@min-[58rem]/dash:col-span-8"
                  data={data.top_findings}
                  filterQuery={filterQuery}
                  onChanged={() => setAttempt((n) => n + 1)}
                />
                {/* Beside the findings when there is room; above them when the page is narrow, where it
                    would otherwise come after the whole table */}
                <NeedsAttention
                  className="order-first @min-[58rem]/dash:order-none @min-[58rem]/dash:col-span-4"
                  filtered={target !== "" || category !== ""}
                />
              </div>
              <TargetRisk rows={data.targets} canVerify={canVerify} since={since} />
              {/* New filters start the readouts afresh */}
              <TrendCharts
                key={`${target}|${days}|${category}`}
                trends={data.trends}
                periodDays={data.period_days}
                filterQuery={filterQuery}
              />
              <BreakdownCharts key={`${target}|${days}|${category}`} data={data} filterQuery={filterQuery} targetQuery={targetQuery} />
              <div className="grid items-start gap-3 @min-[58rem]/dash:grid-cols-3">
                <ByStatus
                  byStatus={data.by_status}
                  periodDays={data.period_days}
                  filterQuery={filterQuery}
                  since={data.changes.since}
                />
                <CategoryTable
                  className="@min-[58rem]/dash:col-span-2"
                  rows={data.by_category}
                  targetQuery={targetQuery}
                  chosen={data.category}
                  onChoose={(code) => setCategory((chosen) => (chosen === code ? "" : code))}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
