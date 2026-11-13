"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Activity, Plus, Search, TriangleAlert } from "lucide-react"

import { ApprovalBadge } from "@/components/campaigns/approval-view"
import { RunsTable } from "@/components/campaigns/runs-table"
import { EmptyState } from "@/components/layout/empty-state"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SortHeader, type SortDirection } from "@/components/sentra/sort-header"
import { EnvironmentBadge } from "@/components/targets/target-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type ApprovalStatus,
  type CampaignRow,
  END_REASON_LABEL,
  RUNNING_STATUSES,
  RUN_STATUS_LABEL,
  type RunItem,
  type RunOverviewItem,
  formatCount,
  listCampaigns,
  listOrganizationRuns,
} from "@/lib/campaigns"
import { refused, useKeptAnswer, useKeptScroll } from "@/hooks/use-kept-list"
import { useUrlState } from "@/hooks/use-url-state"
import { useCan } from "@/lib/permissions"
import { type Environment, formatDate, formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

/** "Create campaign" in the page header, for Security Analysts (FR-1.6, M1). */
export function CreateCampaignButton({ targetId }: { targetId?: string }) {
  const canCreate = useCan("manage_campaigns")
  if (!canCreate) return null
  return (
    <Button asChild className="h-9 shrink-0 hover:bg-primary-hover">
      <Link href={targetId ? `/campaigns/new?target=${targetId}` : "/campaigns/new"}>
        <Plus aria-hidden="true" />
        Create campaign
      </Link>
    </Button>
  )
}

/**
 * Where a campaign stands now, the one answer Screen 33 asks to be seen at a glance: a run going on
 * (running, waiting to start or paused) comes first, then a scope decision it waits for, then its
 * schedule (paused, as when its creator is suspended, or waiting for its next moment). "idle" ran
 * before and has nothing planned; "ready" has never run.
 */
type State = "running" | "queued" | "paused" | "awaiting_approval" | "rejected" | "scheduled" | "ready" | "idle"

const STATE_LABEL: Record<State, string> = {
  running: "Running",
  queued: "Waiting to start",
  paused: "Paused",
  awaiting_approval: "Awaiting approval",
  rejected: "Rejected",
  scheduled: "Scheduled",
  ready: "Not run yet",
  idle: "Nothing planned",
}

function stateOf(campaign: CampaignRow): State {
  const run = campaign.last_run
  if (run && RUNNING_STATUSES.includes(run.status)) return run.status as State
  if (campaign.approval_status === "awaiting_approval" || campaign.approval_status === "rejected") {
    return campaign.approval_status
  }
  if (campaign.schedule?.status === "paused") return "paused"
  if (campaign.schedule?.status === "active" && campaign.schedule.next_run_at) return "scheduled"
  return run ? "idle" : "ready"
}

/** How a campaign runs: the Schedule filter's choices. */
type ScheduleKind = "once" | "recurring" | "pipeline" | "manual"
const SCHEDULE_LABEL: Record<ScheduleKind, string> = {
  once: "Once, at a set time",
  recurring: "Recurring",
  pipeline: "Started by CI/CD",
  manual: "When launched",
}

function scheduleOf(campaign: CampaignRow): ScheduleKind {
  if (campaign.schedule) return campaign.schedule.kind
  // A pipeline starts it through the API (UC-5.3, 1a), which its runs remember
  return campaign.last_run?.trigger === "api" ? "pipeline" : "manual"
}

// The runs tab asks for the newest runs only: the API sends no total, so a full answer shows "100+"
const RUNS_LIMIT = 100

type SortKey = "campaign" | "target" | "last_run" | "next_run"
const SORT_KEYS: SortKey[] = ["campaign", "target", "last_run", "next_run"]
// A column's first direction: the newest campaign and the latest run first, the soonest next run
const FIRST_DIRECTION: Record<SortKey, SortDirection> = {
  campaign: "desc",
  target: "asc",
  last_run: "desc",
  next_run: "asc",
}

/** When the campaign last ran: a run going on now is the latest of all. */
function lastRunTime(run: RunItem | null): number | null {
  if (!run) return null
  if (RUNNING_STATUSES.includes(run.status)) return Number.MAX_SAFE_INTEGER
  return Date.parse(run.ended_at ?? run.started_at ?? run.created_at)
}

function nextRunTime(campaign: CampaignRow): number | null {
  const schedule = campaign.schedule
  return schedule?.status === "active" && schedule.next_run_at ? Date.parse(schedule.next_run_at) : null
}

/** The campaigns in the chosen order; a campaign without a value comes last either way. */
function ordered(campaigns: CampaignRow[], sort: SortKey, direction: SortDirection): CampaignRow[] {
  const number = (c: CampaignRow) => Number(c.code.replace(/\D/g, ""))
  const value = (c: CampaignRow): number | string | null =>
    sort === "campaign"
      ? number(c)
      : sort === "target"
        ? (c.target?.name.toLowerCase() ?? null)
        : sort === "last_run"
          ? lastRunTime(c.last_run)
          : nextRunTime(c)
  const sign = direction === "asc" ? 1 : -1
  return [...campaigns].sort((a, b) => {
    const [x, y] = [value(a), value(b)]
    if (x === null || y === null) return x === y ? number(b) - number(a) : x === null ? 1 : -1
    if (x === y) return number(b) - number(a) // ties: the newest campaign first
    return (x < y ? -1 : 1) * sign
  })
}

// Which columns show at which width of the table's own frame (a container query), so that the
// campaign's name keeps room: all eight from 1,120 px (a window of 1,440 px), Schedule and Next run
// from 832 px (1,024 px). While a column is hidden, what it says shows under the campaign's name.
const SHOW = {
  wide: "hidden @min-[70rem]/campaigns:table-cell",
  mid: "hidden @min-[52rem]/campaigns:table-cell",
  // The number of test suites keeps its column from 640 px of frame; below that it sits under the name
  suites: "hidden @min-[40rem]/campaigns:table-cell",
}

/** Screen 33's Last run: a run going on now with its progress and the way to its monitor. */
function LastRun({ campaign }: { campaign: CampaignRow }) {
  const run = campaign.last_run
  if (!run) return <span className="text-[13px] text-muted-foreground">Not run yet</span>
  const href = `/campaigns/${campaign.code}/runs/${run.number}`
  if (RUNNING_STATUSES.includes(run.status)) {
    const percent = Math.min(100, Math.round((run.attempts_sent / (run.attempt_budget || 1)) * 100))
    const paused = run.status === "paused"
    return (
      <div className="space-y-1.5">
        <div className={cn("flex items-center gap-1.5 text-[13px] font-medium", paused && "text-warning")}>
          {paused ? (
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Activity className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          )}
          {run.status === "running" ? "Running now" : STATE_LABEL[run.status as State]}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${formatCount(run.attempts_sent)} of ${formatCount(run.attempt_budget)} attempts sent`}
          >
            <div
              className={cn("h-full rounded-full", paused ? "bg-warning" : "bg-primary")}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          </div>
          <span className="tabular text-xs text-muted-foreground" aria-hidden="true">
            {percent} %
          </span>
        </div>
        <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
          <Link href={href} aria-label={`Open the monitor of ${run.code}`}>
            Open monitor
          </Link>
        </Button>
      </div>
    )
  }
  const reason = run.end_reason ? END_REASON_LABEL[run.end_reason] : undefined
  return (
    <div>
      <Link href={href} className="inline-flex min-h-6 items-center text-[13px] text-link hover:underline">
        {RUN_STATUS_LABEL[run.status]} {run.ended_at ? formatDate(run.ended_at) : ""}
      </Link>
      {reason && run.status !== "completed" && <div className="text-xs text-muted-foreground">{reason}</div>}
    </div>
  )
}

/** Screen 33's Next run: the schedule's next moment, or why there is none. */
function NextRun({ campaign }: { campaign: CampaignRow }) {
  const schedule = campaign.schedule
  if (schedule?.status === "active" && schedule.next_run_at) {
    return <span className="tabular text-[13px]">{formatDateTime(schedule.next_run_at)}</span>
  }
  if (schedule?.status === "paused") {
    return (
      <span className="inline-flex items-start gap-1.5 text-[13px] font-medium text-warning">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          Schedule paused
          {/* Why, as the schedule says it (a suspended creator, missed moments): two lines at most,
              all of it on the campaign's own page */}
          {schedule.last_message && (
            <span className="line-clamp-2 text-xs font-normal text-muted-foreground" title={schedule.last_message}>
              {schedule.last_message}
            </span>
          )}
        </span>
      </span>
    )
  }
  return (
    <span className="text-[13px] text-muted-foreground">
      –<span className="sr-only">None planned</span>
    </span>
  )
}

/** Screen 33's Approval: who approved the scope, or what the campaign waits for (FR-5.2, M5). */
function Approval({ campaign }: { campaign: CampaignRow }) {
  const status = campaign.approval_status as ApprovalStatus
  if (status === "not_required") return <span className="text-[13px] text-muted-foreground">Not required</span>
  if (status === "approved") {
    return (
      <div>
        <ApprovalBadge status="approved" />
        {campaign.approved_by && (
          <div className="mt-0.5 text-xs text-muted-foreground">by {campaign.approved_by}</div>
        )}
      </div>
    )
  }
  return (
    <div>
      <ApprovalBadge status={status} />
      <div className="mt-0.5 text-xs">
        <Link
          href={`/campaigns/${campaign.code}/approval`}
          className="inline-flex min-h-6 items-center text-link hover:underline"
        >
          {status === "rejected" ? "See the reason" : "Review the scope"}
        </Link>
      </div>
    </div>
  )
}

function ScheduleText({ campaign }: { campaign: CampaignRow }) {
  if (campaign.schedule) return <>{campaign.schedule.summary}</>
  return <>{SCHEDULE_LABEL[scheduleOf(campaign)]}</>
}

/** Screen 33, the campaigns of the organization: the entry to UC-5.1 to UC-5.7. */
export function CampaignsList({ targetId }: { targetId?: string } = {}) {
  // When the address changes without the list (the menu's link, Back or Forward), the list starts
  // again from the new address, as if the page had just been opened
  const [opened, setOpened] = useState(0)
  return <ListFromAddress key={opened} targetId={targetId} onOutside={() => setOpened((count) => count + 1)} />
}

function ListFromAddress({ targetId, onOutside }: { targetId?: string; onOutside: () => void }) {
  const canCreate = useCan("manage_campaigns")
  // The list starts as its address says: a reload, Back, or a link somebody shared
  const query = useSearchParams()
  const [tab, setTab] = useState(query.get("tab") === "runs" ? "runs" : "campaigns")
  const [search, setSearch] = useState("")
  const [target, setTarget] = useState(targetId ? "" : (query.get("target") ?? ""))
  const [status, setStatus] = useState(query.get("status") ?? "")
  const [schedule, setSchedule] = useState(query.get("schedule") ?? "")
  const askedSort = query.get("sort") as SortKey | null
  const [sort, setSort] = useState<SortKey>(askedSort && SORT_KEYS.includes(askedSort) ? askedSort : "last_run")
  const [direction, setDirection] = useState<SortDirection>(() => {
    const value = query.get("direction")
    return value === "asc" || value === "desc" ? value : FIRST_DIRECTION[sort]
  })

  // The answers kept for Back (UX task 3.0): coming back shows the campaigns at once, and where the
  // reader was among them, and refreshes them behind
  const campaignsRequest = `campaigns${targetId ? `?target_id=${targetId}` : ""}`
  const runsRequest = `runs?limit=${RUNS_LIMIT}${targetId ? `&target_id=${targetId}` : ""}`
  const [keptCampaigns, keepCampaigns, dropCampaigns] = useKeptAnswer<CampaignRow[]>(campaignsRequest)
  const [keptRuns, keepRuns, dropRuns] = useKeptAnswer<RunOverviewItem[]>(runsRequest)
  const [all, setCampaigns] = useState<CampaignRow[] | null>(keptCampaigns)
  const [runs, setRuns] = useState<RunOverviewItem[] | null>(keptRuns)
  const [failed, setFailed] = useState(false)
  // The campaigns or the runs were refused: the reader may no longer read them (401, 403)
  const [denied, setDenied] = useState(false)
  const [runsFailed, setRunsFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // The tab, filters and order are in the address, so Back opens the same view of the list and
  // brings the reader back to where they were in it. The search words stay out of the history.
  const view = `campaigns?tab=${tab}&target=${target}&status=${status}&schedule=${schedule}&sort=${sort}&direction=${direction}`
  useKeptScroll(`campaigns${targetId ? `:${targetId}` : ""}`, view, all !== null)
  useUrlState(
    { tab, target, status, schedule, sort, direction },
    { tab: "campaigns", sort: "last_run", direction: FIRST_DIRECTION[sort] },
    onOutside,
  )

  useEffect(() => {
    const controller = new AbortController()
    const asked = new URLSearchParams()
    if (targetId) asked.set("target_id", targetId)
    listCampaigns(asked, controller.signal)
      .then((found) => {
        setCampaigns(found)
        keepCampaigns(found)
        setFailed(false)
        setDenied(false)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return
        // Campaigns the reader may no longer read leave the page and the memory (UX task 3.0)
        if (refused(problem)) {
          dropCampaigns()
          dropRuns()
          setCampaigns(null)
          setDenied(true)
        }
        setFailed(true)
      })
    // The organization's runs, or inside a target's tabs that target's runs, newest first: the
    // Campaign runs tab
    const runsAsked = new URLSearchParams({ limit: String(RUNS_LIMIT) })
    if (targetId) runsAsked.set("target_id", targetId)
    listOrganizationRuns(runsAsked, controller.signal)
      .then((found) => {
        setRuns(found)
        keepRuns(found)
        setRunsFailed(false)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return
        if (refused(problem)) dropRuns()
        // Not an empty list: the runs are unknown, and the tab says so
        setRuns(null)
        setRunsFailed(true)
      })
    return () => controller.abort()
  }, [targetId, attempt, keepCampaigns, keepRuns, dropCampaigns, dropRuns])

  if (failed && !all) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex items-center justify-between gap-4">
          {denied
            ? "You can no longer see the campaigns of this organization. Ask an Organization Administrator for access."
            : "The campaigns could not be loaded."}
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-foreground"
            onClick={() => {
              setFailed(false)
              setDenied(false)
              setAttempt((count) => count + 1)
            }}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!all) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading campaigns">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  const campaigns = targetId ? all.filter((campaign) => campaign.target?.id === targetId) : all
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title={targetId ? "No campaign for this target yet" : "No campaigns yet"}
        description={
          canCreate
            ? "A campaign tests one verified target with the test suites you choose, within the limits you set."
            : "A Security Analyst creates the campaigns of your organization."
        }
        action={
          canCreate ? (
            <Button asChild className="h-9 hover:bg-primary-hover">
              <Link href={targetId ? `/campaigns/new?target=${targetId}` : "/campaigns/new"}>Create campaign</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  function sortBy(column: SortKey) {
    if (column === sort) setDirection((now) => (now === "asc" ? "desc" : "asc"))
    else {
      setSort(column)
      setDirection(FIRST_DIRECTION[column])
    }
  }
  const sortProps = { sort, direction, onSort: sortBy }

  const text = search.trim().toLowerCase()
  const targets = Array.from(new Map(campaigns.filter((c) => c.target).map((c) => [c.target!.id, c.target!.name])))
  const states = new Map(campaigns.map((c) => [c.code, stateOf(c)]))
  // A "running" choice also finds the runs that wait for a worker: both are going on
  const matchesStatus = (c: CampaignRow) =>
    !status || states.get(c.code) === status || (status === "running" && states.get(c.code) === "queued")
  const shown = ordered(
    campaigns.filter(
      (c) =>
        (!target || c.target?.id === target) &&
        matchesStatus(c) &&
        (!schedule || scheduleOf(c) === schedule) &&
        (!text || c.name.toLowerCase().includes(text) || c.code.toLowerCase().includes(text)),
    ),
    sort,
    direction,
  )
  const clearFilters = () => {
    setSearch("")
    setTarget("")
    setStatus("")
    setSchedule("")
  }

  // Screen 33's summary: what is going on and what waits, each a way to see those campaigns
  const count = (...wanted: State[]) => campaigns.filter((c) => wanted.includes(states.get(c.code)!)).length
  const chips: [State, string, number][] = [
    ["running", "running", count("running", "queued")],
    ["scheduled", "scheduled", count("scheduled")],
    ["paused", "paused", count("paused")],
    ["awaiting_approval", "awaiting approval", count("awaiting_approval")],
  ]

  const campaignsPanel = (
    <section aria-label="Campaigns" className="@container/campaigns rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search campaigns</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID"
            className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
        {!targetId && (
          <FilterSelect label="Target" value={target} onChange={setTarget} options={targets.map(([value, label]) => ({ value, label }))} />
        )}
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={(["running", "paused", "scheduled", "awaiting_approval", "rejected", "ready", "idle"] as State[]).map(
            (value) => ({ value, label: STATE_LABEL[value] }),
          )}
        />
        <FilterSelect
          label="Schedule"
          value={schedule}
          onChange={setSchedule}
          options={Object.entries(SCHEDULE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
          {shown.length} of {campaigns.length} campaigns
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No campaigns match these filters"
            description="Remove some filters or change the search."
            action={
              <Button variant="outline" className="h-9" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        // Fixed widths on the header's cells, each measured on its longest content; the campaign's
        // name takes what is left, and a hidden header cell takes its column along
        <Table className="table-fixed">
          <TableHeader className="bg-muted">
            <TableRow>
              <SortHeader column="campaign" label="Campaign" {...sortProps} />
              {!targetId && <SortHeader column="target" label="Target" className={cn("w-[176px]", SHOW.wide)} {...sortProps} />}
              <TableHead scope="col" className={cn("w-[88px] text-center text-xs", SHOW.suites)}>
                Test suites
              </TableHead>
              <TableHead scope="col" className={cn("w-[152px] text-xs", SHOW.mid)}>
                Schedule
              </TableHead>
              <TableHead scope="col" className="w-[128px] text-xs">
                Approval
              </TableHead>
              <SortHeader column="last_run" label="Last run" className="w-[140px]" {...sortProps} />
              <SortHeader column="next_run" label="Next run" className={cn("w-[128px]", SHOW.mid)} {...sortProps} />
              <TableHead scope="col" className={cn("w-[120px] text-xs", SHOW.wide)}>
                Created by
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((campaign) => (
              <TableRow key={campaign.code}>
                <TableCell className="py-2.5 whitespace-normal">
                  <Link
                    href={`/campaigns/${campaign.code}`}
                    className="inline-block min-h-6 text-[13px] leading-6 font-medium text-link hover:underline"
                  >
                    {campaign.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{campaign.code}</div>
                  {/* What the hidden columns say, each while its column is hidden */}
                  {!targetId && campaign.target && (
                    <div className="text-xs text-muted-foreground @min-[70rem]/campaigns:hidden">
                      {campaign.target.name}
                    </div>
                  )}
                  <div className="tabular text-xs text-muted-foreground @min-[40rem]/campaigns:hidden">
                    {campaign.suite_count} test {campaign.suite_count === 1 ? "suite" : "suites"}
                  </div>
                  <div className="text-xs text-muted-foreground @min-[52rem]/campaigns:hidden">
                    <ScheduleText campaign={campaign} />
                    {nextRunTime(campaign) !== null && <> · Next run {formatDateTime(campaign.schedule!.next_run_at!)}</>}
                    {campaign.schedule?.status === "paused" && <> · Schedule paused</>}
                  </div>
                  {campaign.created_by && (
                    <div className="text-xs text-muted-foreground @min-[70rem]/campaigns:hidden">
                      Created by {campaign.created_by}
                    </div>
                  )}
                </TableCell>
                {!targetId && (
                  <TableCell className={cn("whitespace-normal", SHOW.wide)}>
                    <div className="text-[13px]">{campaign.target?.name ?? "–"}</div>
                    {campaign.target && <EnvironmentBadge environment={campaign.target.environment as Environment} />}
                  </TableCell>
                )}
                <TableCell className={cn("tabular text-center text-[13px]", SHOW.suites)}>{campaign.suite_count}</TableCell>
                <TableCell className={cn("text-[13px] whitespace-normal", SHOW.mid)}>
                  <ScheduleText campaign={campaign} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Approval campaign={campaign} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <LastRun campaign={campaign} />
                </TableCell>
                <TableCell className={cn("whitespace-normal", SHOW.mid)}>
                  <NextRun campaign={campaign} />
                </TableCell>
                <TableCell className={cn("text-[13px] whitespace-normal", SHOW.wide)}>
                  {campaign.created_by ?? "–"}
                  <div className="text-xs text-muted-foreground">{formatDate(campaign.created_at)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )

  return (
    <>
      {chips.some(([, , number]) => number > 0) && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Campaigns by state">
          {chips
            .filter(([, , number]) => number > 0)
            .map(([value, label, number]) => (
              <li key={value}>
                <button
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => {
                    setStatus(status === value ? "" : value)
                    setTab("campaigns")
                  }}
                  className={cn(
                    "tabular inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    status === value && "border-primary bg-primary/10 text-link",
                  )}
                >
                  {value === "running" && <Activity className="size-3.5 text-primary" aria-hidden="true" />}
                  {value === "paused" && <TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />}
                  {number} {label}
                </button>
              </li>
            ))}
        </ul>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList variant="line" aria-label="Campaigns and their runs" className="h-10 w-full justify-start gap-6 border-b px-0">
          <TabsTrigger value="campaigns" className="flex-none gap-2 px-0.5">
            Campaigns
            <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{campaigns.length}</span>
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex-none gap-2 px-0.5">
            Campaign runs
            <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
              {runs ? (runs.length >= RUNS_LIMIT ? `${RUNS_LIMIT}+` : runs.length) : "–"}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="campaigns"
          className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {campaignsPanel}
        </TabsContent>

        <TabsContent
          value="runs"
          className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <section aria-label="Campaign runs" className="rounded-[10px] border bg-card">
            {runsFailed ? (
              <div className="p-4">
                <Alert variant="destructive" role="alert">
                  <AlertDescription className="flex items-center justify-between gap-4">
                    The campaign runs could not be loaded.
                    <Button variant="outline" size="sm" className="h-9 text-foreground" onClick={() => setAttempt((count) => count + 1)}>
                      Try again
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            ) : !runs ? (
              <div className="space-y-2 p-4" role="status" aria-label="Loading campaign runs">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No campaign run yet"
                  description="A run sends a campaign's tests to its target. You can follow it live and stop it at any time."
                />
              </div>
            ) : (
              <RunsTable runs={runs} />
            )}
          </section>
        </TabsContent>
      </Tabs>
    </>
  )
}
