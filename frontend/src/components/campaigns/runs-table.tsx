"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  END_REASON_LABEL,
  RUNNING_STATUSES,
  RUN_STATUS_LABEL,
  type RunOverviewItem,
  formatCount,
} from "@/lib/campaigns"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const TONE: Record<string, string> = {
  running: "text-success",
  paused: "text-warning",
  queued: "text-muted-foreground",
  completed: "text-foreground",
  stopped: "text-destructive",
  cancelled: "text-destructive",
}

/** Where a run is: a bar while it goes on, the reason once it has ended (UC-5.6 steps 2 and 5). */
export function RunProgress({ run }: { run: RunOverviewItem }) {
  const planned = run.attempt_budget || 1
  const percent = Math.min(100, Math.round((run.attempts_sent / planned) * 100))
  if (!RUNNING_STATUSES.includes(run.status)) {
    // A block, so that it stands under the run it belongs to and not against it (Screen 33).
    return (
      <span className="block text-[13px] text-muted-foreground">
        {END_REASON_LABEL[run.end_reason ?? ""] ?? RUN_STATUS_LABEL[run.status]}
      </span>
    )
  }
  return (
    <div className="min-w-24">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn("h-full rounded-full", run.status === "paused" ? "bg-warning" : "bg-primary")}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
      <span className="tabular text-xs text-muted-foreground">
        {formatCount(run.attempts_sent)} of {formatCount(run.attempt_budget)} attempts
      </span>
    </div>
  )
}

/** The runs of a campaign or of the whole organization (Screen 33 and the campaign page). */
export function RunsTable({
  runs,
  campaignCode,
  showCampaign = true,
}: {
  runs: RunOverviewItem[]
  /** For a campaign's own runs, whose rows carry no campaign. */
  campaignCode?: string
  showCampaign?: boolean
}) {
  return (
    <Table
      container={{
        tabIndex: 0,
        role: "group",
        "aria-label": "Campaign runs",
        className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      }}
    >
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="text-xs">Run</TableHead>
          {showCampaign && <TableHead className="text-xs">Campaign</TableHead>}
          <TableHead className="text-xs">Status</TableHead>
          <TableHead className="text-xs">Progress</TableHead>
          <TableHead className="text-xs">Started</TableHead>
          <TableHead className="text-xs">
            <span className="sr-only">Monitor</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const code = run.campaign?.code ?? campaignCode ?? ""
          return (
            <TableRow key={run.id}>
              <TableCell className="py-2.5">
                <Link
                  href={`/campaigns/${code}/runs/${run.number}`}
                  className="font-mono text-[13px] text-link hover:underline"
                >
                  {run.code}
                </Link>
              </TableCell>
              {showCampaign && (
                <TableCell className="text-[13px]">
                  {run.campaign ? run.campaign.name : "—"}
                  {run.target && <div className="text-xs text-muted-foreground">{run.target.name}</div>}
                </TableCell>
              )}
              <TableCell className={cn("text-[13px]", TONE[run.status])}>{RUN_STATUS_LABEL[run.status]}</TableCell>
              <TableCell>
                <RunProgress run={run} />
              </TableCell>
              <TableCell className="text-[13px]">
                {run.started_at ? formatDateTime(run.started_at) : "Not started"}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm" className="h-8">
                  <Link href={`/campaigns/${code}/runs/${run.number}`}>
                    {RUNNING_STATUSES.includes(run.status) ? "Open monitor" : "Open"}
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
