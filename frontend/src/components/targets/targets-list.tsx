"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Rocket, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect } from "@/components/sentra/filter-select"
import { RiskScore, SeverityCountsStrip } from "@/components/sentra/risk-score"
import { EnvironmentBadge, OwnershipBadge } from "@/components/targets/target-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSession } from "@/components/session-provider"
import { refused, useKeptAnswer, useKeptScroll } from "@/hooks/use-kept-list"
import { useCan } from "@/lib/permissions"
import { type TargetRiskRow, getRiskDashboard, notScoredText } from "@/lib/risk"
import { initials } from "@/lib/session"
import {
  ENVIRONMENT_LABEL,
  TYPE_LABEL,
  type Target,
  type TargetList,
  formatDate,
  listTargets,
  restoreTarget,
} from "@/lib/targets"

const PAGE_SIZE = 20
type Tab = "active" | "archived"

/** Screen 16: the organization's targets, the entry to UC-2.1 to UC-2.7. */
export function TargetsList() {
  const organization = useSession().organization
  const canManage = useCan("manage_targets")
  const canCampaign = useCan("manage_campaigns") // "Create campaign" on a target (UC-5.1 trigger)
  const canVerify = useCan("verify_targets") // the inline "Verify ownership" of an unverified target
  const [tab, setTab] = useState<Tab>("active")
  const hasActions = (canManage || canCampaign) && (tab === "active" || canManage === true)
  const [search, setSearch] = useState("")
  const [type, setType] = useState("")
  const [environment, setEnvironment] = useState("")
  const [ownership, setOwnership] = useState("")
  const [page, setPage] = useState(1)
  // What the API is asked for: also the key of the answer kept for Back (UX task 3.0)
  const request = (() => {
    const params = new URLSearchParams({ tab, page: String(page), page_size: String(PAGE_SIZE) })
    if (search.trim()) params.set("search", search.trim())
    if (type) params.set("type", type)
    if (environment) params.set("environment", environment)
    if (ownership) params.set("ownership", ownership)
    return params.toString()
  })()
  const [kept, keep, drop] = useKeptAnswer<TargetList>(`targets?${request}`)
  const [keptRisk, keepRisk, dropRisk] = useKeptAnswer<Record<string, TargetRiskRow>>("targets-risk")
  const [data, setData] = useState<TargetList | null>(kept)
  const [risk, setRisk] = useState<Record<string, TargetRiskRow> | null>(keptRisk)
  // The tab and filters aren't in the address yet (task 4.5), so Back opens the first view, and
  // brings the reader back to where they were only if they left from it
  useKeptScroll("targets", `targets?${request}`, data !== null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // The risk score and the open findings of every target come from Module 7, in one request.
  useEffect(() => {
    const controller = new AbortController()
    getRiskDashboard(undefined, controller.signal)
      .then((dashboard) => {
        const rows = Object.fromEntries(dashboard.targets.map((row) => [row.id, row]))
        setRisk(rows)
        keepRisk(rows)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return // a cancelled request keeps what is shown
        if (refused(problem)) dropRisk()
        setRisk({})
      })
    return () => controller.abort()
  }, [attempt, keepRisk, dropRisk])

  useEffect(() => {
    const controller = new AbortController()
    // Wait briefly while the user is typing, then ask the API once.
    const timer = setTimeout(() => {
      listTargets(new URLSearchParams(request), controller.signal)
        .then((result) => {
          setData(result)
          keep(result)
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const filtered = Boolean(search.trim() || type || environment || ownership)
  const clearFilters = useCallback(() => {
    setSearch("")
    setType("")
    setEnvironment("")
    setOwnership("")
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

  const panel = (
    <section aria-label={tab === "active" ? "Active targets" : "Archived targets"} className="rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search targets</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <FilterSelect
          label="Environment"
          value={environment}
          onChange={(v) => {
            setEnvironment(v)
            setPage(1)
          }}
          options={Object.entries(ENVIRONMENT_LABEL).map(([value, label]) => ({ value, label }))}
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
        <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
          {data ? `${data.total} ${data.total === 1 ? "target" : "targets"}` : ""}
        </span>
      </div>

      {error && (
        <div className="p-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The targets could not be loaded.
              <Button variant="outline" size="sm" className="h-9 text-foreground" onClick={() => setAttempt((n) => n + 1)}>
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
              description="Remove some filters or change the search."
              action={
                <Button variant="outline" className="h-9" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : tab === "archived" ? (
            <EmptyState title="No archived targets" description="Targets that are no longer tested appear here." />
          ) : (
            <EmptyState
              title="No targets yet"
              description={
                canManage
                  ? "Register an AI application that your organization owns or is allowed to test."
                  : "An AI Application Developer of your organization registers the applications to test."
              }
              action={register}
            />
          )}
        </div>
      )}

      {data && data.total > 0 && (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="text-xs">Target</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Environment</TableHead>
                  <TableHead className="text-xs">Ownership</TableHead>
                  <TableHead className="text-xs">Risk Score</TableHead>
                  <TableHead className="text-xs">Open findings</TableHead>
                  <TableHead className="text-xs">Last campaign run</TableHead>
                  <TableHead className="text-xs">Owner</TableHead>
                  {hasActions && (
                    <TableHead className="w-12 text-xs">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="py-2.5">
                      <Link
                        href={`/targets/${target.id}`}
                        className="text-[13px] font-medium text-link hover:underline"
                      >
                        {target.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{target.endpoint_host}</div>
                    </TableCell>
                    <TableCell className="text-[13px]">{TYPE_LABEL[target.type]}</TableCell>
                    <TableCell>
                      <EnvironmentBadge environment={target.environment} />
                    </TableCell>
                    <TableCell>
                      <OwnershipBadge status={target.status} />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const row = risk?.[target.id]
                        if (!risk) return <Skeleton className="h-8 w-24" />
                        if (!row || row.score === null) {
                          return (
                            <div className="space-y-1">
                              <span className="text-[13px] text-muted-foreground">
                                {row ? notScoredText(row.not_scored_reason) : "Not scored"}
                              </span>
                              {target.status === "unverified" && canVerify && (
                                <Link
                                  href={`/targets/${target.id}/verify`}
                                  className="block text-[13px] text-link hover:underline"
                                >
                                  Verify ownership
                                </Link>
                              )}
                            </div>
                          )
                        }
                        return <RiskScore score={row.score} band={row.band ?? "none"} />
                      })()}
                    </TableCell>
                    <TableCell>
                      {risk?.[target.id] ? (
                        <SeverityCountsStrip counts={risk[target.id].open_by_severity} />
                      ) : (
                        <span className="text-[13px] text-muted-foreground">–</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {risk?.[target.id]?.last_run_at ? (
                        formatDate(risk[target.id].last_run_at as string)
                      ) : (
                        <span className="text-muted-foreground">No run yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {target.owner && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Avatar tabIndex={0} className="size-8">
                              <AvatarFallback className="text-xs font-medium">{initials(target.owner.name)}</AvatarFallback>
                              <span className="sr-only">{target.owner.name}</span>
                            </Avatar>
                          </TooltipTrigger>
                          <TooltipContent>Registered by {target.owner.name}</TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    {hasActions && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${target.name}`}>
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
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav aria-label="Pages" className="flex items-center justify-end gap-3 border-t px-4 py-2.5 text-sm">
            <span className="tabular text-muted-foreground">
              Page {data.page} of {pages}
            </span>
            <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
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
        description={`AI applications ${organization?.name ?? "your organization"} is allowed to test.`}
        action={register}
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
          <TabsContent key={value} value={value} className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {panel}
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}
