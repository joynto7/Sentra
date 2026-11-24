"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, Search } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { type DashboardScope, ReportDialog } from "@/components/reports/report-dialog"
import { ReportCard } from "@/components/reports/report-card"
import { ReportDetails } from "@/components/reports/report-details"
import { StatusChip, scopeText } from "@/components/reports/report-parts"
import { atWithZone } from "@/components/reports/report-plan"
import { ScheduleCard } from "@/components/reports/schedule-card"
import { ViewSwitch, useStoredView } from "@/components/sentra/view-switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  FREQUENCY_LABEL,
  type Report,
  type ReportList,
  type Schedule,
  TYPE_LABEL,
  changeSchedule,
  deleteSchedule,
  downloadUrl,
  listReports,
  runSchedule,
  scopeOptions,
} from "@/lib/reports"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

const POLL = 2000

/**
 * Screen 52 (UC-9.1, UC-9.2): the reports the organization has, and the schedules that produce
 * them. A report that is being written says so and the page follows it; one that found nothing
 * says that instead of offering a file; a ready one offers the download with its checksum.
 */
export function ReportsPage() {
  const canGenerate = useCan("generate_reports")
  const [data, setData] = useState<ReportList | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // When the list was read: what is overdue is judged against it, not against a clock read while rendering
  const [readAt, setReadAt] = useState(0)
  /** null while it is closed; a schedule to edit it (UC-9.2, 4a), `scheduled` to start as one. */
  const [dialog, setDialog] = useState<{
    schedule?: Schedule
    scheduled?: boolean
    /** The settings of a report being made again */
    preset?: DashboardScope
  } | null>(null)
  const [deleting, setDeleting] = useState<Schedule | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState("reports")
  const [view, setView] = useStoredView("reports")
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState<"all" | "executive" | "technical">("all")
  const [state, setState] = useState<"all" | "ready" | "attention">("all")
  const [newest, setNewest] = useState(true)
  const [open, setOpen] = useState<Report | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listReports(controller.signal)
      .then((found) => {
        setData(found)
        setReadAt(Date.now())
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  // While a worker writes a report, the page follows it until it is ready (UC-9.1 step 4).
  const writing = data?.rows.some((row) => row.status === "generating") ?? false
  useEffect(() => {
    if (!writing) return
    const timer = setInterval(reload, POLL)
    return () => clearInterval(timer)
  }, [writing, reload])

  async function act(id: string, what: () => Promise<unknown>, done: string) {
    setBusy(id)
    try {
      await what()
      toast.success(done)
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "That didn't work. Try again.")
    } finally {
      setBusy(null)
    }
  }

  /** Opens the dialog with the settings of a report that exists. Nothing is generated until its button is pressed. */
  async function reuse(report: Report) {
    setBusy(report.id)
    try {
      let target_id: string | null = null
      if (report.scope === "target") {
        const found = (await scopeOptions()).targets.find((one) => one.name === report.target)
        if (!found) {
          toast.error("The target of this report is not available to you any more, so its settings can't be used again.")
          return
        }
        target_id = found.id
      }
      const days =
        report.period_from && report.period_to
          ? Math.round((Date.parse(report.period_to) - Date.parse(report.period_from)) / 86_400_000)
          : 90
      setDialog({
        preset: {
          target_id,
          period_days: days > 0 ? days : 90,
          category: report.category,
          label: scopeText(report),
          from: `the settings of ${report.code}`,
          type: report.type,
          format: report.format,
        },
      })
    } catch {
      toast.error("The settings could not be read. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const reports = data?.rows ?? []
  const schedules = data?.schedules ?? []
  const attention = reports.filter((row) => row.status === "failed" || row.status === "empty")
  const words = search.trim().toLowerCase()
  const shown = reports
    .filter((row) => kind === "all" || row.type === kind)
    .filter((row) => state === "all" || (state === "ready" ? row.status === "ready" : row.status === "failed" || row.status === "empty"))
    .filter((row) => !words || `${row.code} ${scopeText(row)} ${row.requested_by ?? ""} ${row.format}`.toLowerCase().includes(words))
    .sort((a, b) => (newest ? 1 : -1) * (Date.parse(b.created_at) - Date.parse(a.created_at)))
  const latest = reports.reduce<Report | null>(
    (top, row) => (top === null || Date.parse(row.created_at) > Date.parse(top.created_at) ? row : top),
    null,
  )
  const activeSchedules = schedules.filter((one) => one.status === "active").length

  return (
    <>
      <PageHeader
        title="Reports"
        description="Executive and technical reports."
        action={
          canGenerate ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-9" onClick={() => setDialog({ scheduled: true })}>
                Schedule report
              </Button>
              <Button className="h-9 hover:bg-primary-hover" onClick={() => setDialog({})}>
                Generate report
              </Button>
            </div>
          ) : undefined
        }
      />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The reports could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the reports">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {data && (
        <>
          {/* What the organization has, as four tiles that are also the shortcuts to it */}
          <ul className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "All reports",
                value: reports.length,
                note: latest ? `Latest ${formatDate(latest.created_at)}` : "None yet",
                on: tab === "reports" && state === "all",
                go: () => {
                  setTab("reports")
                  setState("all")
                },
              },
              {
                label: "Ready to download",
                value: reports.filter((row) => row.status === "ready").length,
                note: "With a file",
                on: tab === "reports" && state === "ready",
                go: () => {
                  setTab("reports")
                  setState("ready")
                },
              },
              {
                label: "Need a look",
                value: attention.length,
                note: "Failed or no results",
                on: tab === "reports" && state === "attention",
                go: () => {
                  setTab("reports")
                  setState("attention")
                },
              },
              {
                label: "Active schedules",
                value: activeSchedules,
                note: `${schedules.length} in all`,
                on: tab === "schedules",
                go: () => setTab("schedules"),
              },
            ].map((tile) => (
              <li key={tile.label}>
                <button
                  type="button"
                  aria-pressed={tile.on}
                  onClick={tile.go}
                  className={cn(
                    "flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
                    tile.on ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
                  )}
                >
                  <span className="text-xs text-muted-foreground">{tile.label}</span>
                  <span className="tabular mt-1 text-3xl leading-none font-semibold">{tile.value}</span>
                  <span className="mt-2 text-xs text-muted-foreground">{tile.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="reports">Reports ({reports.length})</TabsTrigger>
              <TabsTrigger value="schedules">Schedules ({schedules.length})</TabsTrigger>
            </TabsList>

            <TabsContent
              value="reports"
              className="mt-0 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {reports.length === 0 ? (
                <EmptyState
                  title="No report yet"
                  description={canGenerate ? "Generate a report." : "Reports appear here."}
                  action={
                    canGenerate ? (
                      <Button className="h-9 hover:bg-primary-hover" onClick={() => setDialog({})}>
                        Generate report
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <section aria-labelledby="reports" className="min-w-0 rounded-[10px] border bg-card">
                  <h2 id="reports" className="sr-only">
                    Reports
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 border-b p-3">
                    <label className="relative block w-full sm:w-64">
                      <span className="sr-only">Search reports</span>
                      <Search
                        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by code, scope or person"
                        className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      />
                    </label>
                    <div role="group" aria-label="Type" className="flex gap-1.5">
                      {(["all", "executive", "technical"] as const).map((one) => (
                        <button
                          key={one}
                          type="button"
                          aria-pressed={kind === one}
                          onClick={() => setKind(one)}
                          className={cn(
                            "h-8 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            kind === one
                              ? "border-transparent bg-primary text-primary-foreground"
                              : "bg-card text-text-secondary hover:text-foreground",
                          )}
                        >
                          {one === "all" ? "All types" : TYPE_LABEL[one]}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      Sort
                      <select
                        value={newest ? "new" : "old"}
                        onChange={(event) => setNewest(event.target.value === "new")}
                        className="h-9 rounded-[7px] border border-input bg-card px-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <option value="new">Newest first</option>
                        <option value="old">Oldest first</option>
                      </select>
                    </label>
                    <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
                      {shown.length} of {reports.length}
                    </span>
                    <ViewSwitch value={view} onChange={setView} />
                  </div>

                  {shown.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No report matches.{" "}
                      <button
                        type="button"
                        className="text-link underline underline-offset-2"
                        onClick={() => {
                          setSearch("")
                          setKind("all")
                          setState("all")
                        }}
                      >
                        Clear the filters
                      </button>
                    </div>
                  ) : view === "cards" ? (
                    <ul className="grid gap-4 bg-muted/40 p-4 sm:grid-cols-2 xl:grid-cols-3">
                      {shown.map((report) => (
                        <li key={report.id} className="min-w-0">
                          <ReportCard
                            report={report}
                            canReuse={Boolean(canGenerate)}
                            busy={busy === report.id}
                            onOpen={() => setOpen(report)}
                            onReuse={() => void reuse(report)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Table
                      container={{
                        tabIndex: 0,
                        role: "group",
                        "aria-label": "Reports",
                        className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      }}
                    >
                      <TableHeader className="bg-muted">
                        <TableRow>
                          <TableHead scope="col" className="text-xs">
                            Report
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Covers
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Made
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Status
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((report) => (
                          <TableRow key={report.id} className="cursor-pointer" onClick={() => setOpen(report)}>
                            <TableCell className="py-3 whitespace-normal">
                              <span className="block font-mono text-[13px] font-medium">{report.code}</span>
                              <span className="block text-xs text-muted-foreground">
                                {TYPE_LABEL[report.type]} · {report.format.toUpperCase()}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[16rem] py-3 text-[13px] whitespace-normal">
                              {scopeText(report)}
                              {report.period_from && report.period_to && (
                                <span className="block text-xs text-muted-foreground">
                                  {formatDate(report.period_from)} – {formatDate(report.period_to)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-3 text-[13px]">
                              <span className="block whitespace-nowrap">{formatDate(report.created_at)}</span>
                              <span className="block text-xs text-muted-foreground">{report.requested_by ?? "Sentra"}</span>
                            </TableCell>
                            <TableCell className="py-3 whitespace-normal">
                              <StatusChip report={report} />
                            </TableCell>
                            <TableCell className="py-3 text-right" onClick={(event) => event.stopPropagation()}>
                              <span className="flex flex-wrap items-center justify-end gap-2">
                                {canGenerate && report.scope !== "campaign_run" && report.status !== "generating" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-full"
                                    disabled={busy === report.id}
                                    aria-label={`${report.status === "failed" ? "Try again with" : "Use again"} the settings of ${report.code}`}
                                    onClick={() => void reuse(report)}
                                  >
                                    {report.status === "failed" ? "Try again" : "Use again"}
                                  </Button>
                                )}
                                {report.status === "ready" && report.checksum ? (
                                  <Button asChild size="sm" className="h-8 rounded-full">
                                    <a href={downloadUrl(report.code)} download>
                                      <Download className="size-3.5" aria-hidden="true" />
                                      Download
                                    </a>
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">No file</span>
                                )}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <p className="border-t p-3 text-[13px] text-muted-foreground">
                    Reports open only after login. Scheduled reports are delivered as links, never as attachments.
                  </p>
                </section>
              )}
            </TabsContent>

            <TabsContent
              value="schedules"
              className="mt-0 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {schedules.length === 0 ? (
                <EmptyState
                  title="No schedule yet"
                  description={
                    canGenerate
                      ? "Schedule reports after runs."
                      : "A schedule produces a report after every campaign run of a target, weekly or monthly. A Security Analyst or a Security Manager sets one up."
                  }
                  action={
                    canGenerate ? (
                      <Button className="h-9 hover:bg-primary-hover" onClick={() => setDialog({ scheduled: true })}>
                        Schedule report
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <section aria-labelledby="schedules" className="min-w-0 rounded-[10px] border bg-card">
                  <h2 id="schedules" className="sr-only">
                    Schedules
                  </h2>
                  <div className="flex items-center justify-between gap-2 border-b p-3">
                    <p className="tabular text-sm text-muted-foreground">
                      {schedules.length} {schedules.length === 1 ? "schedule" : "schedules"} · {activeSchedules} active
                    </p>
                    <ViewSwitch value={view} onChange={setView} />
                  </div>
                  {view === "cards" ? (
                    <ul className="grid gap-4 bg-muted/40 p-4 sm:grid-cols-2 xl:grid-cols-3">
                      {schedules.map((schedule) => (
                        <li key={schedule.id} className="min-w-0">
                          <ScheduleCard
                            schedule={schedule}
                            readAt={readAt}
                            canManage={canGenerate}
                            busy={busy === schedule.id}
                            onToggle={() =>
                              act(
                                schedule.id,
                                () => changeSchedule(schedule.id, { status: schedule.status === "paused" ? "active" : "paused" }),
                                schedule.status === "paused" ? "The schedule is active again." : "The schedule is paused.",
                              )
                            }
                            onRun={() => act(schedule.id, () => runSchedule(schedule.id), "Sentra is writing the report.")}
                            onEdit={() => setDialog({ schedule })}
                            onDelete={() => setDeleting(schedule)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Table
                      container={{
                        tabIndex: 0,
                        role: "group",
                        "aria-label": "Schedules",
                        className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      }}
                    >
                      <TableHeader className="bg-muted">
                        <TableRow>
                          <TableHead scope="col" className="text-xs">
                            Schedule
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Scope
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Frequency
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Recipients
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            Next report
                          </TableHead>
                          <TableHead scope="col" className="text-xs">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schedules.map((schedule) => (
                          <TableRow key={schedule.id}>
                            <TableCell className="max-w-xs whitespace-normal">
                              <span className="block text-[13px] font-medium">{schedule.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {TYPE_LABEL[schedule.type]} · {schedule.format.toUpperCase()} ·{" "}
                                {schedule.status === "paused" ? "Paused" : "Active"}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[12rem] text-[13px] whitespace-normal">{scopeText(schedule)}</TableCell>
                            <TableCell className="text-[13px]">{FREQUENCY_LABEL[schedule.frequency]}</TableCell>
                            <TableCell className="max-w-[12rem] text-[13px] whitespace-normal">
                              {schedule.recipients.map((one) => one.name).join(", ") || "—"}
                            </TableCell>
                            <TableCell className="max-w-[14rem] text-[13px] whitespace-normal">
                              {schedule.status === "paused" ? (
                                "Paused"
                              ) : schedule.next_run_at ? (
                                new Date(schedule.next_run_at).getTime() < readAt - 5 * 60_000 ? (
                                  <>
                                    <span className="font-medium text-warning">Overdue</span>
                                    <span className="block text-xs text-muted-foreground">
                                      Was due {atWithZone(new Date(schedule.next_run_at))} and has not been produced.
                                    </span>
                                  </>
                                ) : (
                                  atWithZone(new Date(schedule.next_run_at))
                                )
                              ) : (
                                "After the next campaign run"
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {canGenerate && (
                                <span className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    aria-label={`Edit ${schedule.name}`}
                                    onClick={() => setDialog({ schedule })}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    disabled={busy === schedule.id}
                                    aria-label={`Run ${schedule.name} now`}
                                    onClick={() => act(schedule.id, () => runSchedule(schedule.id), "Sentra is writing the report.")}
                                  >
                                    Run now
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    disabled={busy === schedule.id}
                                    aria-label={`${schedule.status === "paused" ? "Resume" : "Pause"} ${schedule.name}`}
                                    onClick={() =>
                                      act(
                                        schedule.id,
                                        () =>
                                          changeSchedule(schedule.id, {
                                            status: schedule.status === "paused" ? "active" : "paused",
                                          }),
                                        schedule.status === "paused" ? "The schedule is active again." : "The schedule is paused.",
                                      )
                                    }
                                  >
                                    {schedule.status === "paused" ? "Resume" : "Pause"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    aria-label={`Delete ${schedule.name}`}
                                    onClick={() => setDeleting(schedule)}
                                  >
                                    Delete
                                  </Button>
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <p className="border-t p-3 text-[13px] text-muted-foreground">Changes apply from the next report.</p>
                </section>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <ReportDetails
        report={open}
        canReuse={Boolean(canGenerate)}
        busy={open !== null && busy === open.id}
        onClose={() => setOpen(null)}
        onReuse={(report) => void reuse(report)}
      />

      <ReportDialog
        open={dialog !== null}
        members={data?.members ?? []}
        schedule={dialog?.schedule ?? null}
        startScheduled={dialog?.scheduled}
        preset={dialog?.preset}
        onClose={() => setDialog(null)}
        onDone={reload}
      />

      {/* UC-9.2, 4a: the schedule goes, the reports it produced stay — so it is asked first. */}
      <Dialog open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Delete this schedule?</DialogTitle>
            <DialogDescription>
              “{deleting?.name}” stops producing reports and its recipients hear nothing more. The reports it has already produced stay in
              the list and can still be downloaded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep it
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="h-9"
              disabled={busy === deleting?.id}
              onClick={() => {
                const schedule = deleting
                if (!schedule) return
                setDeleting(null)
                act(schedule.id, () => deleteSchedule(schedule.id), "The schedule is deleted. Its reports stay.")
              }}
            >
              Delete schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
