"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Bug, Radar, Wrench, type LucideIcon } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useCountUp } from "@/hooks/use-count-up"
import { ACTIVE, type Autopilot, STAGES, STATUS_LABEL } from "@/lib/autopilot"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

function Stat({ icon: Icon, value, label, index }: { icon: LucideIcon; value: number; label: string; index: number }) {
  const shown = useCountUp(value, 800)
  return (
    <div className="ap-rise rounded-2xl border border-border bg-card p-4" style={{ "--i": index } as React.CSSProperties}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {label}
      </div>
      <p className="tabular mt-3 text-3xl font-semibold leading-none">{shown}</p>
    </div>
  )
}

/** How long ago, in words: "just now", "12 min ago", "3 h ago", or the date after a day. */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return formatDateTime(iso)
}

const STATUS_TONE: Record<Autopilot["status"], { chip: string; dot: string }> = {
  running: { chip: "border-primary/40 bg-primary/10 text-primary", dot: "bg-primary ap-live" },
  waiting: { chip: "border-warning/50 bg-warning/10 text-warning", dot: "bg-warning" },
  completed: { chip: "border-success/40 bg-success/10 text-success", dot: "bg-success" },
  failed: { chip: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  stopped: { chip: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
}

/** Five small segments, one per stage: green where it is done, coloured where it is now. */
function Segments({ run }: { run: Autopilot }) {
  const current = run.stage === "done" ? STAGES.length : STAGES.findIndex((s) => s.stage === run.stage)
  return (
    <span className="flex gap-1" aria-hidden="true">
      {STAGES.map((stage, index) => {
        const done = index < current || run.status === "completed"
        const here = index === current && run.status !== "completed"
        return (
          <span
            key={stage.stage}
            className={cn(
              "h-1.5 w-8 rounded-full",
              done && "bg-success",
              here && run.status === "running" && "bg-primary ap-shimmer",
              here && run.status === "waiting" && "bg-warning",
              here && (run.status === "failed" || run.status === "stopped") && "bg-destructive",
              !done && !here && "bg-muted",
            )}
          />
        )
      })}
    </span>
  )
}

function stageLabel(run: Autopilot): string {
  if (run.stage === "done") return "All stages"
  return STAGES.find((s) => s.stage === run.stage)?.label ?? run.stage
}

type Filter = "all" | "active" | "finished"

/** The organization's assessments, newest first, with four numbers on top and a filter. */
export function AutopilotList({ runs, failed }: { runs: Autopilot[] | null; failed: boolean }) {
  const [filter, setFilter] = useState<Filter>("all")
  const [now] = useState(() => Date.now())

  if (failed) return <p className="text-sm text-destructive">The assessments could not be loaded. Reload the page.</p>
  if (runs === null) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No assessment yet"
        description="Start the autopilot on a verified target and it will appear here."
      />
    )
  }

  const active = runs.filter((run) => ACTIVE.includes(run.status)).length
  const findings = runs.reduce((sum, run) => sum + (run.summary?.findings ?? 0), 0)
  const proposals = runs.reduce((sum, run) => sum + (run.summary?.proposals ?? 0), 0)
  const shown = runs.filter((run) =>
    filter === "all" ? true : filter === "active" ? ACTIVE.includes(run.status) : !ACTIVE.includes(run.status),
  )

  return (
    <section aria-labelledby="runs-heading" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Radar} value={runs.length} label="Assessments" index={0} />
        <Stat icon={Radar} value={active} label="Active now" index={1} />
        <Stat icon={Bug} value={findings} label="Findings found" index={2} />
        <Stat icon={Wrench} value={proposals} label="Proposals drafted" index={3} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="runs-heading" className="text-base font-semibold">
          Assessments
        </h2>
        <div role="group" aria-label="Show" className="inline-flex rounded-full border border-border bg-card p-0.5">
          {(["all", "active", "finished"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">
          Nothing to show with this filter.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((run, index) => (
            <li key={run.id} className="ap-rise" style={{ "--i": index } as React.CSSProperties}>
              <Link
                href={`/autopilot/${run.id}`}
                className="llm-card group flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-border bg-card p-4 outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-36">
                  <span className="block text-sm font-semibold">{run.code}</span>
                  <span className="block text-sm text-muted-foreground">{run.target_name}</span>
                </span>
                <span className="flex flex-1 flex-col gap-1.5">
                  <Segments run={run} />
                  <span className="text-xs text-muted-foreground">{stageLabel(run)}</span>
                </span>
                <span
                  className={cn(
                    "inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium",
                    STATUS_TONE[run.status].chip,
                  )}
                >
                  <span className={cn("size-2 rounded-full", STATUS_TONE[run.status].dot)} aria-hidden="true" />
                  {STATUS_LABEL[run.status]}
                </span>
                <span className="tabular w-24 text-right text-xs text-muted-foreground">{ago(run.created_at, now)}</span>
                <ArrowRight
                  className="ap-arrow size-4 text-muted-foreground transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
