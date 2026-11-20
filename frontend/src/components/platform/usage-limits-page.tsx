"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleCheck, CirclePause, Info, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { LimitsPanel } from "@/components/platform/limits-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  type Limit,
  type OrganizationUsage,
  type UsageOverview,
  against,
  usageOverview,
} from "@/lib/usage-limits"
import { cn } from "@/lib/utils"

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })

/** A limit as the table shows it: the amounts, a bar, and in words what the bar means, because a
 * colour is never the only carrier of meaning (WCAG 1.4.1). */
function Used({ limit, nextMonth }: { limit: Limit; nextMonth: string }) {
  const tone = limit.reached ? "bg-destructive" : limit.warning ? "bg-warning" : "bg-primary"
  return (
    <div className="min-w-32">
      <div className="tabular flex items-baseline gap-1.5 text-sm">
        {against(limit)}
        {(limit.warning || limit.reached) && (
          <TriangleAlert
            className={cn("size-3.5 shrink-0", limit.reached ? "text-destructive" : "text-warning")}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, limit.percent)}%` }} />
      </div>
      <p
        className={cn(
          "mt-1 text-xs",
          limit.reached ? "font-medium text-destructive" : limit.warning ? "font-medium text-warning" : "text-muted-foreground",
        )}
      >
        {limit.reached
          ? `Limit reached — no new runs until ${nextMonth}`
          : `${limit.percent}%${limit.warning ? " — warned" : ""}`}
      </p>
    </div>
  )
}

function Status({ organization }: { organization: OrganizationUsage }) {
  if (organization.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        Active
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
      <CirclePause className="size-4 shrink-0" aria-hidden="true" />
      Limited
    </span>
  )
}

/**
 * Screen 61: every organization's usage this month against its monthly limits (FR-10.4, UC-10.6),
 * for Platform Administrators. Only usage and limits are shown, never an organization's own data
 * (NFR-3.3).
 */
export function UsageLimitsPage() {
  const [data, setData] = useState<UsageOverview | null>(null)
  const [error, setError] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [editing, setEditing] = useState<OrganizationUsage | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    usageOverview(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [reloads])

  const reload = useCallback(() => setReloads((n) => n + 1), [])
  const limited = data?.organizations.filter((organization) => organization.status === "limited").length ?? 0
  const warned =
    data?.organizations.filter((organization) => organization.limits.some((limit) => limit.warning)).length ?? 0

  return (
    <div className="min-w-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Usage this month against each organization&apos;s limits.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            The organizations could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the organizations">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          {(limited > 0 || warned > 0) && (
            <Alert role="status" className="mb-4">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                {limited > 0 &&
                  `${limited} organization${limited === 1 ? "" : "s"} reached a limit and starts no new runs. `}
                {warned > 0 && `${warned} ${warned === 1 ? "is" : "are"} close to one and ${warned === 1 ? "has" : "have"} been warned.`}
              </AlertDescription>
            </Alert>
          )}

          <section aria-label="Organizations and usage limits" className="rounded-[10px] border bg-card">
            {data.organizations.length === 0 ? (
              <EmptyState
                title="No organization yet"
                description="An organization appears here as soon as someone creates one."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead className="w-20">Members</TableHead>
                      <TableHead>Campaigns</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>LLM cost</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-24 text-right">Limits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.organizations.map((organization) => (
                      <TableRow key={organization.id}>
                        <TableCell className="align-top font-medium">
                          {organization.name}
                          {organization.limits.every((limit) => !limit.custom) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="mt-1 flex w-fit items-center gap-1 text-xs font-normal text-muted-foreground">
                                  <Info className="size-3.5" aria-hidden="true" />
                                  Platform defaults
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                No limit has been set for this organization, so the platform&apos;s defaults apply.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell className="tabular align-top">{organization.members}</TableCell>
                        {organization.limits.map((limit) => (
                          <TableCell key={limit.kind} className="align-top">
                            <Used limit={limit} nextMonth={organization.next_month} />
                            {limit.warned_at && (
                              <span className="sr-only">
                                Warned on {DAY.format(new Date(limit.warned_at))}.
                              </span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="align-top">
                          <Status organization={organization} />
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button variant="outline" size="sm" onClick={() => setEditing(organization)}>
                            Edit
                            <span className="sr-only"> the limits of {organization.name}</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {data.notice}
          </p>

          <LimitsPanel
            organization={editing}
            overview={data}
            onClose={() => setEditing(null)}
            onSaved={(organization) => {
              toast.success(`${organization.name}'s limits are saved.`, {
                description: "They apply from the next campaign run and the next attempt.",
              })
              reload()
            }}
          />
        </>
      )}
    </div>
  )
}
