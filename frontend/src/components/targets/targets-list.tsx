"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Search } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect } from "@/components/sentra/filter-select"
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
import { useCan } from "@/lib/permissions"
import { initials } from "@/lib/session"
import { ENVIRONMENT_LABEL, TYPE_LABEL, type TargetList, listTargets } from "@/lib/targets"

const PAGE_SIZE = 20
type Tab = "active" | "archived"

/** Screen 16: the organization's targets, the entry to UC-2.1 to UC-2.7. */
export function TargetsList() {
  const organization = useSession().organization
  const canManage = useCan("manage_targets")
  const [tab, setTab] = useState<Tab>("active")
  const [search, setSearch] = useState("")
  const [type, setType] = useState("")
  const [environment, setEnvironment] = useState("")
  const [ownership, setOwnership] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<TargetList | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    // Wait briefly while the user is typing, then ask the API once.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ tab, page: String(page), page_size: String(PAGE_SIZE) })
      if (search.trim()) params.set("search", search.trim())
      if (type) params.set("type", type)
      if (environment) params.set("environment", environment)
      if (ownership) params.set("ownership", ownership)
      listTargets(params, controller.signal)
        .then((result) => {
          setData(result)
          setError(false)
        })
        .catch(() => !controller.signal.aborted && setError(true))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [tab, search, type, environment, ownership, page, attempt])

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
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
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
                  <TableHead className="text-xs">Owner</TableHead>
                  {canManage && tab === "active" && (
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
                      <div className="text-[13px] font-medium">{target.name}</div>
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
                    {canManage && tab === "active" && (
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
                                Edit
                              </Link>
                            </DropdownMenuItem>
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
