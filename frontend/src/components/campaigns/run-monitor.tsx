"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleAlert, Pause, Play, Square } from "lucide-react"
import { toast } from "sonner"

import { RunEventsFeed } from "@/components/campaigns/run-events-feed"
import { useRunEvents } from "@/components/campaigns/use-run-events"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { SeverityCountsStrip } from "@/components/sentra/risk-score"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  ATTEMPT_STATUS_LABEL,
  type AttemptStatus,
  END_REASON_LABEL,
  RUN_STATUS_LABEL,
  type RunDetail,
  formatCount,
  getRun,
  pauseRun,
  resumeRun,
  stopRun,
} from "@/lib/campaigns"
import {
  FINDING_STATUS_LABEL,
  IN_RUN_LABEL,
  type FindingItem,
  type InRunCounts,
  listFindings,
} from "@/lib/findings"
import { useCan } from "@/lib/permissions"
import type { SeverityCounts } from "@/lib/risk"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const ACTIVE = ["queued", "running", "paused"]
const TICK_MS = 1000

/** "31 min", "2 h 29 min": how long something has been going on, or how long is left. */
function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-[10px] border bg-card p-5", className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="tabular mt-1 text-xl font-semibold">{value}</div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

/** The status of a run, as a chip with a live dot while it is going on. */
function StatusChip({ status }: { status: RunDetail["status"] }) {
  const tone =
    status === "running"
      ? "border-success/40 text-success"
      : status === "paused"
        ? "border-warning/60 text-warning"
        : status === "completed"
          ? "border-success/40 text-success"
          : status === "queued"
            ? "border-border-strong text-muted-foreground"
            : "border-destructive/40 text-destructive"
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium", tone)}>
      {status === "running" && <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden="true" />}
      {RUN_STATUS_LABEL[status]}
    </span>
  )
}

/**
 * Screen 36, the live campaign monitor (UC-5.6 Monitor Campaign Run and UC-5.7 Control Campaign
 * Run): what the run is doing, its attempts, findings and warnings as they happen, and the
 * controls its roles may use. Every member of the organization may watch it (NFR-3.3).
 */
export function RunMonitor({ code, number }: { code: string; number: number }) {
  const canPause = useCan("pause_campaign_runs")
  const canStop = useCan("stop_campaign_runs")
  const [run, setRun] = useState<RunDetail | null>(null)
  // Whether the live stream may open: once the run is loaded, it follows the events from the
  // start of the run's stream, so a monitor that opens in the middle of a run still shows what
  // has happened (UC-5.6 step 3). The stream keeps the newest events of the last day.
  const [streamFrom, setStreamFrom] = useState<string | null | undefined>(undefined)
  const [notFound, setNotFound] = useState(false)
  const [findings, setFindings] = useState<FindingItem[]>([])
  // Of this run's findings: how many it found, saw again with the same root cause (FR-6.6) or
  // reopened as a regression (Screen 37's KPI row).
  const [inRun, setInRun] = useState<InRunCounts | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<"pause" | "resume" | "stop" | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [reason, setReason] = useState("")

  usePageCrumbs([{ label: code, href: `/campaigns/${code}` }, { label: run?.code ?? `Run ${number}` }])

  const loadRun = useCallback(() => {
    getRun(code, number)
      .then((loaded) => {
        setRun(loaded)
        setStreamFrom(null)
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [code, number])

  const loadFindings = useCallback(
    (runId: string) => {
      listFindings(new URLSearchParams({ run_id: runId, page_size: "25" }))
        .then((page) => {
          setFindings(page.items)
          setInRun(page.in_run_counts)
        })
        .catch(() => undefined)
    },
    [],
  )

  useEffect(loadRun, [loadRun])

  const runId = run?.id
  useEffect(() => {
    if (runId) loadFindings(runId)
  }, [runId, loadFindings])

  const ended = run !== null && !ACTIVE.includes(run.status)

  const onStatus = useCallback(() => {
    loadRun()
    if (runId) loadFindings(runId)
  }, [loadRun, loadFindings, runId])

  const { events, connected, reconnected } = useRunEvents({
    code,
    number,
    after: streamFrom,
    ended,
    onStatus,
    onFinding: useCallback(() => {
      if (runId) loadFindings(runId)
    }, [runId, loadFindings]),
    onReload: onStatus,
  })

  useEffect(() => {
    if (ended) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ended])

  async function control(what: "pause" | "resume" | "stop") {
    setBusy(what)
    try {
      const action = what === "pause" ? pauseRun : what === "resume" ? resumeRun : null
      const updated = action ? await action(code, number) : await stopRun(code, number, reason.trim())
      setRun(updated)
      setConfirmStop(false)
      setReason("")
      toast.success(
        what === "pause"
          ? "The run pauses before its next attempt"
          : what === "resume"
            ? "The run continues"
            : "The run stops within five seconds",
      )
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "That didn't work. Try again.")
    } finally {
      setBusy(null)
    }
  }

  if (notFound) {
    return (
      <EmptyState
        title="Campaign run not found"
        description="It doesn't exist, or it belongs to another organization."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/campaigns">Back to campaigns</Link>
          </Button>
        }
      />
    )
  }
  if (!run) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the campaign run">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const planned = run.attempts_planned || run.attempt_budget
  const percent = planned ? Math.min(100, Math.round((run.attempts_sent / planned) * 100)) : 0
  const severities = findings.reduce<SeverityCounts>(
    (counts, finding) => ({ ...counts, [finding.severity]: (counts[finding.severity] ?? 0) + 1 }),
    { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
  )
  const windowLeft = run.window_ends_at ? new Date(run.window_ends_at).getTime() - now : null
  const started = run.started_at ? new Date(run.started_at).getTime() : null
  const elapsed = started ? (run.ended_at ? new Date(run.ended_at).getTime() : now) - started : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Campaign run {run.code}</h1>
            <StatusChip status={run.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/campaigns/${run.campaign.code}`} className="text-link underline underline-offset-2">
              {run.campaign.name}
            </Link>{" "}
            ·{" "}
            <Link href={`/targets/${run.target.id}`} className="text-link underline underline-offset-2">
              {run.target.name}
            </Link>
            {run.started_at ? ` · started ${formatDateTime(run.started_at)}` : ""}
            {elapsed !== null ? ` · ${duration(elapsed)} ${ended ? "in all" : "elapsed"}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canPause && run.status === "running" && (
            <Button variant="outline" className="h-9 gap-1.5" disabled={busy !== null} onClick={() => void control("pause")}>
              <Pause aria-hidden="true" />
              Pause
            </Button>
          )}
          {canPause && run.status === "paused" && (
            <Button className="h-9 gap-1.5 hover:bg-primary-hover" disabled={busy !== null} onClick={() => void control("resume")}>
              <Play aria-hidden="true" />
              Resume
            </Button>
          )}
          {canStop && ACTIVE.includes(run.status) && (
            <Button
              variant="outline"
              className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5"
              disabled={busy !== null}
              onClick={() => setConfirmStop(true)}
            >
              <Square aria-hidden="true" />
              Stop
            </Button>
          )}
        </div>
      </div>

      <section aria-label="Progress" className="space-y-3 rounded-[10px] border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            <span className="tabular font-semibold">{formatCount(run.attempts_sent)}</span> of{" "}
            <span className="tabular">{formatCount(planned)}</span> planned attempts
            <span className="tabular text-muted-foreground"> ({percent} %)</span>
          </p>
          <p className="tabular text-sm text-muted-foreground">
            Budget {formatCount(run.attempts_sent)} of {formatCount(run.attempt_budget)}
          </p>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Attempts sent"
        >
          <div
            className={cn("h-full rounded-full", run.status === "paused" ? "bg-warning" : "bg-primary")}
            style={{ width: `${Math.max(percent, 1)}%` }}
          />
        </div>
        <p className="text-sm text-text-secondary">{run.status_message}</p>
        {run.status === "queued" && run.queue_position !== null && (
          <p className="text-sm text-muted-foreground">
            Waiting for a worker · place {run.queue_position} in the queue.
          </p>
        )}
        {run.pause_kind === "automatic" && run.wake_at && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Sentra paused the run itself and tries again at {formatDateTime(run.wake_at)}.
          </p>
        )}
        {run.extension_errors.length > 0 && (
          <p className="text-sm text-warning">
            An extension could not evaluate every attempt: {run.extension_errors.map((e) => e.extension).join(", ")}.
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Attempts sent"
          value={formatCount(run.attempts_sent)}
          note={`${formatCount(run.attempts_replied)} replied · ${formatCount(run.attempts_failed)} failed`}
        />
        <Kpi
          label={ended ? "Findings" : "Findings so far"}
          value={formatCount(findings.length)}
          note={<SeverityCountsStrip counts={severities} />}
        />
        {ended ? (
          <Kpi
            label="New · seen again · reopened"
            value={inRun ? `${inRun.new} · ${inRun.seen_again} · ${inRun.reopened}` : "–"}
            note="New weaknesses, the same root cause again (FR-6.6), and fixed ones that came back"
          />
        ) : (
          <Kpi label="Request rate" value={`${run.request_rate}/min`} note="Never faster than the target's safe rate" />
        )}
        <Kpi label="LLM cost" value={`$${run.cost_usd.toFixed(2)}`} note="What this run has used so far" />
        <Kpi
          label="Time window"
          value={windowLeft === null ? "Any time" : windowLeft > 0 ? `${duration(windowLeft)} left` : "Closed"}
          note={windowLeft === null ? "The campaign set no window" : "The run pauses when it closes"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <RunEventsFeed events={events} connected={connected} reconnected={reconnected} ended={ended} />

          {run.summary && (
            <Card title="Summary">
              <p className="text-sm">
                {END_REASON_LABEL[run.end_reason ?? ""] ?? run.status_message}
                {run.ended_by ? ` · ended by ${run.ended_by}` : ""}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {Object.entries(run.summary.attempts)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => (
                    <div key={status} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{ATTEMPT_STATUS_LABEL[status as AttemptStatus]}</dt>
                      <dd className="tabular">{formatCount(count)}</dd>
                    </div>
                  ))}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">LLM cost</dt>
                  <dd className="tabular">${run.summary.cost_usd.toFixed(2)}</dd>
                </div>
              </dl>
              {run.summary.skipped_tests.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Tests that were skipped</p>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {run.summary.skipped_tests.map((test) => (
                      <li key={test.code}>
                        <span className="font-mono text-xs">{test.code}</span> {test.name} — {test.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <Card title={`Findings in this run (${findings.length})`}>
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing found yet.</p>
            ) : (
              <ul className="space-y-2">
                {findings.map((finding) => (
                  <li key={finding.code} className="rounded-[7px] border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/findings/${finding.code}`} className="font-mono text-xs text-link hover:underline">
                        {finding.code}
                      </Link>
                      <SeverityBadge severity={finding.severity} />
                      {finding.in_run && (
                        <span className="rounded border px-1.5 text-[11px] text-muted-foreground">
                          {IN_RUN_LABEL[finding.in_run]}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{finding.category}</span>
                    </div>
                    <p className="mt-1 text-sm">{finding.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {finding.repetitions ? `${finding.repetitions.label} reproduced it` : "Not measured yet"}
                      {finding.owner ? ` · ${finding.owner.name}` : ""}
                      {" · "}
                      {FINDING_STATUS_LABEL[finding.status]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Tests in this run">
            <ul className="space-y-2">
              {run.tests.map((test) => (
                <li key={test.code} className="text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs">{test.code}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      {test.status === "planned" ? `${formatCount(test.attempts)} attempts` : "Skipped"}
                    </span>
                  </div>
                  <p className={cn("text-[13px]", test.status === "skipped" && "text-muted-foreground")}>{test.name}</p>
                  {test.reason && <p className="text-xs text-muted-foreground">{test.reason}</p>}
                </li>
              ))}
              {run.tests.length === 0 && <li className="text-sm text-muted-foreground">The plan is being made.</li>}
            </ul>
          </Card>

          <Card title="Versions used">
            <p className="text-sm text-text-secondary">
              The run keeps the versions it started with, so a later change to a suite or a test doesn&apos;t change
              it (FR-4.5).
            </p>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Test suites</dt>
                <dd className="tabular">{Array.isArray(run.versions.suites) ? run.versions.suites.length : 0}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Tests</dt>
                <dd className="tabular">{Array.isArray(run.versions.tests) ? run.versions.tests.length : 0}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Launched by</dt>
                <dd>{run.launched_by ?? "a former member"}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Stop {run.code}?</DialogTitle>
            <DialogDescription>
              All further attempts stop within five seconds. Attempts already sent are still evaluated, and findings
              are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="stop-reason">Reason (optional)</Label>
            <Input
              id="stop-reason"
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              placeholder="The target is being deployed"
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              It is recorded in the audit log and told to whoever launched the run.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep running
              </Button>
            </DialogClose>
            <Button variant="destructive" className="h-9" disabled={busy !== null} onClick={() => void control("stop")}>
              {busy === "stop" ? "Stopping…" : "Stop run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
