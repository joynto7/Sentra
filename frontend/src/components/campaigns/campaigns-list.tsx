"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Search } from "lucide-react"

import { RunProgress, RunsTable } from "@/components/campaigns/runs-table"
import { EmptyState } from "@/components/layout/empty-state"
import { FilterSelect } from "@/components/sentra/filter-select"
import { EnvironmentBadge } from "@/components/targets/target-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type CampaignItem,
  RUNNING_STATUSES,
  RUN_STATUS_LABEL,
  type RunOverviewItem,
  formatCount,
  listCampaigns,
  listOrganizationRuns,
} from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { formatDate } from "@/lib/test-library"
import type { Environment } from "@/lib/targets"

/** "Create campaign" in the page header, for Security Analysts (FR-1.6). */
export function CreateCampaignButton() {
  const canCreate = useCan("manage_campaigns")
  if (!canCreate) return null
  return (
    <Button asChild className="h-9 shrink-0 hover:bg-primary-hover">
      <Link href="/campaigns/new">
        <Plus aria-hidden="true" />
        Create campaign
      </Link>
    </Button>
  )
}

/** Screen 33, the campaigns of the organization: the entry to UC-5.1 to UC-5.7. */
export function CampaignsList() {
  const canCreate = useCan("manage_campaigns")
  const [campaigns, setCampaigns] = useState<CampaignItem[] | null>(null)
  const [runs, setRuns] = useState<RunOverviewItem[]>([])
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState("")
  const [target, setTarget] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    listCampaigns()
      .then(setCampaigns)
      .catch(() => setFailed(true))
    // The organization's runs, newest first: the last run of each campaign and the runs tab.
    listOrganizationRuns(new URLSearchParams({ limit: "100" }), controller.signal)
      .then(setRuns)
      .catch(() => setRuns([]))
    return () => controller.abort()
  }, [])

  if (failed) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>The campaigns could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }
  if (!campaigns) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading campaigns">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title="No campaigns yet"
        description={
          canCreate
            ? "A campaign tests one verified target with the test suites you choose, within the limits you set."
            : "A Security Analyst creates the campaigns of your organization."
        }
        action={
          canCreate ? (
            <Button asChild className="h-9 hover:bg-primary-hover">
              <Link href="/campaigns/new">Create campaign</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  const lastRun = new Map<string, RunOverviewItem>()
  for (const run of runs) {
    const code = run.campaign?.code
    if (code && !lastRun.has(code)) lastRun.set(code, run)
  }
  const active = runs.filter((run) => RUNNING_STATUSES.includes(run.status))
  const text = search.trim().toLowerCase()
  const targets = Array.from(new Map(campaigns.filter((c) => c.target).map((c) => [c.target!.id, c.target!.name])))
  const shown = campaigns.filter(
    (c) =>
      (!target || c.target?.id === target) &&
      (!text || c.name.toLowerCase().includes(text) || c.code.toLowerCase().includes(text)),
  )

  const campaignsPanel = (
    <section aria-label="Campaigns" className="@container rounded-[10px] border bg-card">
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
        <FilterSelect label="Target" value={target} onChange={setTarget} options={targets.map(([value, label]) => ({ value, label }))} />
        <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
          {shown.length} of {campaigns.length} campaigns
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No campaigns match"
            description="Change the search or the target filter."
            action={
              <Button
                variant="outline"
                className="h-9"
                onClick={() => {
                  setSearch("")
                  setTarget("")
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="text-xs">Campaign</TableHead>
              <TableHead className="hidden text-xs @2xl:table-cell">Target</TableHead>
              <TableHead className="text-right text-xs">Test suites</TableHead>
              <TableHead className="hidden text-xs @3xl:table-cell">Limits</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="hidden text-xs @4xl:table-cell">Created by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((campaign) => (
              <TableRow key={campaign.code}>
                <TableCell className="min-w-56 py-2.5 whitespace-normal">
                  <Link href={`/campaigns/${campaign.code}`} className="text-[13px] font-medium hover:underline">
                    {campaign.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{campaign.code}</div>
                  <div className="text-xs text-muted-foreground @2xl:hidden">{campaign.target?.name}</div>
                </TableCell>
                <TableCell className="hidden whitespace-normal @2xl:table-cell">
                  <div className="text-[13px]">{campaign.target?.name ?? "–"}</div>
                  {campaign.target && <EnvironmentBadge environment={campaign.target.environment as Environment} />}
                </TableCell>
                <TableCell className="tabular text-right text-[13px]">{campaign.suite_count}</TableCell>
                <TableCell className="tabular hidden text-[13px] @3xl:table-cell">
                  {formatCount(campaign.attempt_budget)} attempts · {campaign.request_rate} per minute
                </TableCell>
                <TableCell>
                  {(() => {
                    const run = lastRun.get(campaign.code)
                    if (!run) {
                      return (
                        <>
                          <Badge variant="outline" className="font-normal">
                            Ready
                          </Badge>
                          <div className="mt-0.5 text-xs text-muted-foreground">Not run yet</div>
                        </>
                      )
                    }
                    return (
                      <div className="space-y-1">
                        <Link
                          href={`/campaigns/${campaign.code}/runs/${run.number}`}
                          className="text-[13px] text-link hover:underline"
                        >
                          {RUN_STATUS_LABEL[run.status]} · {run.code}
                        </Link>
                        <RunProgress run={run} />
                      </div>
                    )
                  })()}
                </TableCell>
                <TableCell className="hidden text-[13px] @4xl:table-cell">
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

  const chips: [string, number][] = [
    ["running", active.filter((run) => run.status === "running").length],
    ["paused", active.filter((run) => run.status === "paused").length],
    ["queued", active.filter((run) => run.status === "queued").length],
  ]

  return (
    <>
      {active.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Campaign runs going on now">
          {chips
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <li
                key={label}
                className="tabular inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium"
              >
                {count} {label}
              </li>
            ))}
        </ul>
      )}

      <Tabs defaultValue="campaigns" className="gap-4">
        <TabsList variant="line" aria-label="Campaigns and their runs" className="h-10 w-full justify-start gap-6 border-b px-0">
          <TabsTrigger value="campaigns" className="flex-none gap-2 px-0.5">
            Campaigns
            <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
              {campaigns.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex-none gap-2 px-0.5">
            Campaign runs
            <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{runs.length}</span>
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
            {runs.length === 0 ? (
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
