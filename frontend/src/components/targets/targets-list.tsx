"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { GLASS_ROUND } from "@/components/sentra/glass-card"
import { ViewSwitch, type View } from "@/components/sentra/view-switch"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect } from "@/components/sentra/filter-select"
import { RiskScore, SeverityCountsStrip } from "@/components/sentra/risk-score"
import { SortHeader, type SortDirection } from "@/components/sentra/sort-header"
import { ShieldStatus } from "@/components/targets/shield-status"
import { TargetCard } from "@/components/targets/target-card"
import { EnvironmentBadge, OwnershipBadge } from "@/components/targets/target-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { refused, useKeptAnswer, useKeptScroll } from "@/hooks/use-kept-list"
import { useUrlState } from "@/hooks/use-url-state"
import { useCan } from "@/lib/permissions"
import { type TargetRiskRow, getRiskDashboard } from "@/lib/risk"
import { initials } from "@/lib/session"
import {
  ENVIRONMENT_LABEL,
  SHIELD_LABEL,
  TYPE_LABEL,
  type Target,
  type TargetList,
  type TargetListItem,
  formatDate,
  listTargets,
  restoreTarget,
} from "@/lib/targets"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 20
type Tab = "active" | "archived"
type SortKey = "name" | "risk" | "last_run"
const SORT_KEYS: SortKey[] = ["name", "risk", "last_run"]
// A column's first direction when it is chosen: names A to Z, the highest risk and the latest run first
const FIRST_DIRECTION: Record<SortKey, SortDirection> = {
  name: "asc",
  risk: "desc",
  last_run: "desc",
}

// Which columns show at which width of the table's own frame (a container query), so that the
// targets' names keep room: all ten from 1,120 px (a window of 1,440 px), Last campaign run and
// Owner from 896 (1,280 px), Ownership and Sentra Shield from 704 (1,024 px). While a column is
// hidden, what it says shows under the target's name.
const SHOW = {
  wide: "hidden @min-[70rem]/targets:table-cell",
  run: "hidden @min-[56rem]/targets:table-cell",
  state: "hidden @min-[44rem]/targets:table-cell",
}

/** "Register target" and "Deploy a lab target" in the page header, for the roles that may. */
function HeaderActions({ register }: { register: React.ReactNode }) {
  const canLab = useCan("use_security_lab")
  if (!canLab && !register) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {canLab && (
        <Button
          asChild
          variant="outline"
          className="h-9 gap-1.5 border-primary/40 bg-primary/10 font-medium text-link shadow-[0_6px_16px_-10px_rgba(43,79,216,0.7)] hover:border-primary hover:bg-primary/15 hover:text-link"
        >
          <Link href="/lab">
            <FlaskConical aria-hidden="true" />
            Deploy a lab target
          </Link>
        </Button>
      )}
      {register}
    </div>
  )
}

/** Screen 16: the organization's targets, the entry to UC-2.1 to UC-2.7. */
export function TargetsList() {
  // When the address changes without the list (the menu's Targets link, Back or Forward), the
  // list starts again from the new address, as if the page had just been opened
  const [opened, setOpened] = useState(0)
  return <ListFromAddress key={opened} onOutside={() => setOpened((count) => count + 1)} />
}

function ListFromAddress({ onOutside }: { onOutside: () => void }) {
  const canManage = useCan("manage_targets")
  const canCampaign = useCan("manage_campaigns") // "Create campaign" on a target (UC-5.1 trigger)
  const canVerify = useCan("verify_targets") // the inline "Verify ownership" of an unverified target
  // The list starts as its address says: a reload, Back, or a link somebody shared
  const query = useSearchParams()
  const [tab, setTab] = useState<Tab>(query.get("tab") === "archived" ? "archived" : "active")
  const hasActions = (canManage || canCampaign) && (tab === "active" || canManage === true)
  const [search, setSearch] = useState("")
  const [type, setType] = useState(query.get("type") ?? "")
  const [environment, setEnvironment] = useState(query.get("environment") ?? "")
  const [ownership, setOwnership] = useState(query.get("ownership") ?? "")
  const [shield, setShield] = useState(query.get("shield") ?? "")
  const askedSort = query.get("sort") as SortKey | null
  const [sort, setSort] = useState<SortKey>(askedSort && SORT_KEYS.includes(askedSort) ? askedSort : "risk")
  const [direction, setDirection] = useState<SortDirection>(() => {
    const value = query.get("direction")
    return value === "asc" || value === "desc" ? value : FIRST_DIRECTION[sort]
  })
  const [page, setPage] = useState(() => Math.max(1, Number(query.get("page")) || 1))
  // One card for each target (the first look), or the table: in the address, so a reload and a shared link keep it
  const [view, setView] = useState<View>(query.get("view") === "list" ? "list" : "cards")
  // What the API is asked for: also the key of the answer kept for Back (UX task 3.0)
  const request = (() => {
    const params = new URLSearchParams({
      tab,
      page: String(page),
      page_size: String(PAGE_SIZE),
      sort,
      direction,
    })
    if (search.trim()) params.set("search", search.trim())
    if (type) params.set("type", type)
    if (environment) params.set("environment", environment)
    if (ownership && tab === "active") params.set("ownership", ownership)
    if (shield) params.set("shield", shield)
    return params.toString()
  })()
  const [kept, keep, drop] = useKeptAnswer<TargetList>(`targets?${request}`)
  const [keptRisk, keepRisk, dropRisk] = useKeptAnswer<Record<string, TargetRiskRow>>("targets-risk")
  const [data, setData] = useState<TargetList | null>(kept)
  const [risk, setRisk] = useState<Record<string, TargetRiskRow> | null>(keptRisk)
  // The tab, filters, order and page are in the address, so Back opens the same view of the list
  // and brings the reader back to where they were in it
  useKeptScroll("targets", `targets?${request}`, data !== null)
  const [error, setError] = useState(false)
  // The list was refused: the reader may no longer read it (401, 403), which is not a failure to retry
  const [denied, setDenied] = useState(false)
  // The scores are a second request: when it fails the table says so, it never calls a scored target "Not scored"
  const [riskFailed, setRiskFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Everything but the search words goes in the address: what people search for stays out of the
  // browser's history, as on the Findings list. A sort's own first direction is left out.
  useUrlState(
    {
      tab,
      type,
      environment,
      ownership: tab === "active" ? ownership : "",
      shield,
      sort,
      direction,
      page: String(page),
      view,
    },
    {
      tab: "active",
      sort: "risk",
      direction: FIRST_DIRECTION[sort],
      page: "1",
      view: "cards",
    },
    onOutside,
  )

  // The risk score and the open findings of every target come from Module 7, in one request.
  useEffect(() => {
    const controller = new AbortController()
    getRiskDashboard(undefined, controller.signal)
      .then((dashboard) => {
        const rows = Object.fromEntries(dashboard.targets.map((row) => [row.id, row]))
        setRisk(rows)
        keepRisk(rows)
        setRiskFailed(false)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return // a cancelled request keeps what is shown
        if (refused(problem)) dropRisk()
        setRisk(null)
        setRiskFailed(true)
      })
    return () => controller.abort()
  }, [attempt, keepRisk, dropRisk])

  useEffect(() => {
    const controller = new AbortController()
    // Wait briefly while the user is typing, then ask the API once.
    const timer = setTimeout(() => {
      listTargets(new URLSearchParams(request), controller.signal)
        .then((result) => {
          // A page beyond the last one (an old link, or a list that shrank) opens the last page
          if (!result.items.length && result.total > 0 && result.page > 1) {
            setPage(Math.ceil(result.total / result.page_size))
            return
          }
          setData(result)
          keep(result)
          setError(false)
          setDenied(false)
        })
        .catch((problem) => {
          if (controller.signal.aborted) return
          // A list the reader may no longer read leaves the page and the memory (UX task 3.0)
          if (refused(problem)) {
            drop()
            setData(null)
            setDenied(true)
          }
          setError(true)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request, keep, drop, attempt])

  /** UC-2.6, 1a1: the target comes back unverified, so the list reloads with its new status. */
  const restore = useCallback(async (target: Target) => {
    try {
      await restoreTarget(target.id)
      toast.success(`${target.name} is restored. Add credentials and verify its ownership again.`)
      setAttempt((count) => count + 1)
      // The restored target leaves this tab, and with its row the focus: it goes to the tabs
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [])

  function sortBy(column: SortKey) {
    if (column === sort) setDirection((now) => (now === "asc" ? "desc" : "asc"))
    else {
      setSort(column)
      setDirection(FIRST_DIRECTION[column])
    }
    setPage(1)
  }
  const sortProps = { sort, direction, onSort: sortBy }

  const filtered = Boolean(search.trim() || type || environment || (ownership && tab === "active") || shield)
  const clearFilters = useCallback(() => {
    setSearch("")
    setType("")
    setEnvironment("")
    setOwnership("")
    setShield("")
    setPage(1)
  }, [])
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const register = canManage ? (
    <Button asChild className="h-9 gap-1.5 hover:bg-primary-hover">
      <Link href="/targets/new">
        <Plus aria-hidden="true" />
        Register target
      </Link>
    </Button>
  ) : undefined

  /** A target without a score: not tested yet, and the way to make it testable when there is one. */
  function notScored(target: Target, row: TargetRiskRow | undefined) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 text-[13px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          {row ? "Not scored · no runs" : "Not scored"}
        </span>
        {target.status === "unverified" && canVerify && (
          <Link
            href={`/targets/${target.id}/verify`}
            className="inline-flex min-h-6 items-center text-link hover:underline"
          >
            Verify ownership
          </Link>
        )}
      </div>
    )
  }

  /** The "more" menu of a target, in a row of the table and in the corner of a card. */
  function actionsMenu(target: TargetListItem, round = false) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${target.name}`}
            className={
              round
                ? "size-8 rounded-full bg-white/70 hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
                : undefined
            }
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/targets/${target.id}/edit`}>
              <Pencil aria-hidden="true" />
              {canManage ? "Edit" : "View settings"}
            </Link>
          </DropdownMenuItem>
          {canCampaign && target.status === "verified" && (
            <DropdownMenuItem asChild>
              <Link href={`/campaigns/new?target=${target.id}`}>
                <Rocket aria-hidden="true" />
                Create campaign
              </Link>
            </DropdownMenuItem>
          )}
          {canManage && target.status === "archived" && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void restore(target)
              }}
            >
              <RotateCcw aria-hidden="true" />
              Restore target
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  /** The round button at the foot of a card: the one thing most worth doing next with this target. */
  function quickAction(target: TargetListItem) {
    const round = GLASS_ROUND
    if (target.status === "verified" && canCampaign) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`/campaigns/new?target=${target.id}`}
              className={round}
              aria-label={`Create campaign for ${target.name}`}
            >
              <Rocket className="size-5" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Create campaign</TooltipContent>
        </Tooltip>
      )
    }
    if (target.status === "unverified" && canVerify) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`/targets/${target.id}/verify`}
              className={round}
              aria-label={`Verify ownership of ${target.name}`}
            >
              <ShieldCheck className="size-5" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Verify ownership</TooltipContent>
        </Tooltip>
      )
    }
    if (target.status === "archived" && canManage) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={round}
              aria-label={`Restore ${target.name}`}
              onClick={() => void restore(target)}
            >
              <RotateCcw className="size-5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Restore target</TooltipContent>
        </Tooltip>
      )
    }
    return null
  }

  const filters = (
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <label className="relative block w-full sm:w-72">
        <span className="sr-only">Search targets</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search targets"
          className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </label>
      <FilterSelect
        label="Type"
        value={type}
        onChange={(v) => {
          setType(v)
          setPage(1)
        }}
        options={Object.entries(TYPE_LABEL).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      <FilterSelect
        label="Environment"
        value={environment}
        onChange={(v) => {
          setEnvironment(v)
          setPage(1)
        }}
        options={Object.entries(ENVIRONMENT_LABEL).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      {tab === "active" && (
        <FilterSelect
          label="Ownership"
          value={ownership}
          onChange={(v) => {
            setOwnership(v)
            setPage(1)
          }}
          options={[
            { value: "verified", label: "Verified" },
            { value: "unverified", label: "Unverified" },
          ]}
        />
      )}
      <FilterSelect
        label="Sentra Shield"
        value={shield}
        onChange={(v) => {
          setShield(v)
          setPage(1)
        }}
        options={Object.entries(SHIELD_LABEL).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      {view === "cards" && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort
          <select
            value={`${sort}:${direction}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":")
              setSort(key as SortKey)
              setDirection(dir as SortDirection)
              setPage(1)
            }}
            className="h-9 rounded-[7px] border border-input bg-card px-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <option value="risk:desc">Risk score, highest first</option>
            <option value="risk:asc">Risk score, lowest first</option>
            <option value="name:asc">Name, A to Z</option>
            <option value="name:desc">Name, Z to A</option>
            <option value="last_run:desc">Last run, latest first</option>
            <option value="last_run:asc">Last run, oldest first</option>
          </select>
        </label>
      )}
      <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
        {data ? `${data.total} ${data.total === 1 ? "target" : "targets"}` : ""}
      </span>
      <ViewSwitch value={view} onChange={setView} />
    </div>
  )

  const panel = (
    <section
      aria-label={tab === "active" ? "Active targets" : "Archived targets"}
      className="@container/targets rounded-[10px] border bg-card"
    >
      {filters}

      {error && (
        <div className="p-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              {denied
                ? "You can no longer see the targets of this organization. Ask an Organization Administrator for access."
                : "The targets could not be loaded."}
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-foreground"
                onClick={() => {
                  setDenied(false)
                  setAttempt((n) => n + 1)
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {riskFailed && !error && (
        <div className="p-4 pb-0">
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The risk scores could not be loaded.
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-foreground"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {!data && !error && (
        <div className="space-y-2 p-4" role="status" aria-label="Loading targets">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {data && data.total === 0 && (
        <div className="p-4">
          {filtered ? (
            <EmptyState
              title="No targets match these filters"
              description="Change the filters."
              action={
                <Button variant="outline" className="h-9" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : tab === "archived" ? (
            <EmptyState title="No archived targets" description="Archived targets appear here." />
          ) : (
            <EmptyState
              title="No targets yet"
              description={
                canManage ? "Register an application you own." : "An AI Application Developer registers targets."
              }
              action={register}
            />
          )}
        </div>
      )}

      {data && data.total > 0 && (
        <>
          {/* Fixed widths on the header's cells, each measured on its longest content; the
              target's name takes what is left, and a hidden header cell takes its column along */}
          {view === "cards" ? (
            <ul className="grid gap-4 bg-muted/40 p-4 @min-[44rem]/targets:grid-cols-2 @min-[64rem]/targets:grid-cols-3 @min-[88rem]/targets:grid-cols-4">
              {data.items.map((target) => {
                const row = risk?.[target.id]
                return (
                  <li key={target.id} className="min-w-0">
                    <TargetCard
                      target={target}
                      row={row}
                      risk={riskFailed ? "failed" : !risk ? "loading" : "ready"}
                      notScored={notScored(target, row)}
                      menu={hasActions ? actionsMenu(target, true) : undefined}
                      quick={quickAction(target)}
                    />
                  </li>
                )
              })}
            </ul>
          ) : (
            <Table className="table-fixed">
              <TableHeader className="bg-muted">
                <TableRow>
                  <SortHeader column="name" label="Target" {...sortProps} />
                  <TableHead scope="col" className={cn("w-[116px] text-xs", SHOW.wide)}>
                    Type
                  </TableHead>
                  <TableHead scope="col" className={cn("w-[112px] text-xs", SHOW.wide)}>
                    Environment
                  </TableHead>
                  <TableHead scope="col" className={cn("w-[112px] text-xs", SHOW.state)}>
                    Ownership
                  </TableHead>
                  <SortHeader column="risk" label="Risk score" className="w-[112px]" {...sortProps} />
                  <TableHead scope="col" className="w-[160px] text-xs">
                    Open findings
                  </TableHead>
                  <SortHeader
                    column="last_run"
                    label="Last campaign run"
                    className={cn("w-[104px] whitespace-normal", SHOW.run)}
                    {...sortProps}
                  />
                  <TableHead scope="col" className={cn("w-[136px] text-xs", SHOW.state)}>
                    Sentra Shield
                  </TableHead>
                  <TableHead scope="col" className={cn("w-[56px] text-xs", SHOW.run)}>
                    Owner
                  </TableHead>
                  {hasActions && (
                    <TableHead className="w-12 text-xs">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((target) => {
                  const row = risk?.[target.id]
                  const lastRun = row?.last_run_at ? formatDate(row.last_run_at) : "No run yet"
                  return (
                    <TableRow key={target.id}>
                      <TableCell className="py-2.5 whitespace-normal">
                        <Link
                          href={`/targets/${target.id}`}
                          className="inline-block min-h-6 text-[13px] leading-6 font-medium text-link hover:underline"
                        >
                          {target.name}
                        </Link>
                      </TableCell>
                      <TableCell className={SHOW.wide}>
                        <span className="text-[13px]">{TYPE_LABEL[target.type]}</span>
                      </TableCell>
                      <TableCell className={SHOW.wide}>
                        <EnvironmentBadge environment={target.environment} />
                      </TableCell>
                      <TableCell className={SHOW.state}>
                        <OwnershipBadge status={target.status} />
                      </TableCell>
                      {riskFailed ? (
                        // The scores are unknown: say so, and let nothing call this target "Not scored"
                        <>
                          <TableCell colSpan={3} className={cn("whitespace-normal", SHOW.run)}>
                            <span className="text-[13px] text-muted-foreground">Risk score unavailable</span>
                          </TableCell>
                          <TableCell colSpan={2} className="whitespace-normal @min-[56rem]/targets:hidden">
                            <span className="text-[13px] text-muted-foreground">Risk score unavailable</span>
                          </TableCell>
                        </>
                      ) : !risk ? (
                        <>
                          <TableCell>
                            <Skeleton className="h-8 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-28" />
                          </TableCell>
                          <TableCell className={SHOW.run}>
                            <Skeleton className="h-5 w-14" />
                          </TableCell>
                        </>
                      ) : row && row.score !== null ? (
                        <>
                          <TableCell>
                            <RiskScore score={row.score} band={row.band ?? "none"} className="min-w-0" />
                          </TableCell>
                          <TableCell>
                            <SeverityCountsStrip counts={row.open_by_severity} className="gap-2" />
                          </TableCell>
                          <TableCell className={cn("text-[13px]", SHOW.run)}>{lastRun}</TableCell>
                        </>
                      ) : (
                        // Not tested yet: one cell across the score, the findings and the last run
                        // (Screen 16), or across the first two while the last run's column is hidden
                        <>
                          <TableCell colSpan={3} className={cn("whitespace-normal", SHOW.run)}>
                            {notScored(target, row)}
                          </TableCell>
                          <TableCell colSpan={2} className="whitespace-normal @min-[56rem]/targets:hidden">
                            {notScored(target, row)}
                          </TableCell>
                        </>
                      )}
                      <TableCell className={cn("whitespace-normal", SHOW.state)}>
                        <ShieldStatus shield={target.shield} />
                      </TableCell>
                      <TableCell className={SHOW.run}>
                        {target.owner && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Avatar tabIndex={0} className="size-8">
                                <AvatarFallback className="text-xs font-medium">
                                  {initials(target.owner.name)}
                                </AvatarFallback>
                                <span className="sr-only">Registered by {target.owner.name}</span>
                              </Avatar>
                            </TooltipTrigger>
                            <TooltipContent>Registered by {target.owner.name}</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      {hasActions && <TableCell className="text-right">{actionsMenu(target)}</TableCell>}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          <nav aria-label="Pages" className="flex items-center justify-end gap-3 border-t px-4 py-2.5 text-sm">
            <span className="tabular text-muted-foreground">
              Page {data.page} of {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </section>
  )

  return (
    <>
      <PageHeader
        title="Targets"
        description="Applications you may test."
        action={<HeaderActions register={register} />}
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab)
          setPage(1)
        }}
        className="gap-4"
      >
        <TabsList variant="line" aria-label="Targets" className="h-10 w-full justify-start gap-6 border-b px-0">
          {(["active", "archived"] as const).map((value) => (
            <TabsTrigger key={value} value={value} className="flex-none gap-2 px-0.5">
              {value === "active" ? "Active" : "Archived"}
              <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {data ? data.counts[value] : "–"}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {(["active", "archived"] as const).map((value) => (
          <TabsContent
            key={value}
            value={value}
            className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {panel}
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}
