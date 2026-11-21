"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  CircleCheck,
  CirclePause,
  CircleSlash,
  Clock,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  BENCHMARK_STATUS_LABEL,
  type BenchmarkDetail,
  REPETITION_LABEL,
  type Repetition,
  costRange,
  duration,
  pauseBenchmark,
  readBenchmark,
  resumeBenchmark,
  startBenchmark,
  stopBenchmark,
} from "@/lib/lab"
import { cn } from "@/lib/utils"

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

/** "4 h 05 min", "26 min" — how long the experiment has been going, or how long it took. */
function elapsed(from: string | null, to: string | null): string {
  if (!from) return "Not started"
  const minutes = Math.max(0, Math.round((new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`
}

const TILE: Record<Repetition["status"], { icon: typeof CircleCheck; tone: string }> = {
  planned: { icon: Clock, tone: "text-muted-foreground" },
  resetting: { icon: Loader2, tone: "text-muted-foreground" },
  running: { icon: Loader2, tone: "text-primary" },
  completed: { icon: CircleCheck, tone: "text-success" },
  incomplete: { icon: CircleSlash, tone: "text-warning" },
}

/** One repetition as a tile: an icon and the state in words (WCAG 1.4.1), with how far through
 * its attempt budget it is while it runs. */
function Tile({ row, budget }: { row: Repetition; budget: number }) {
  const { icon: Icon, tone } = TILE[row.status]
  const spinning = row.status === "running" || row.status === "resetting"
  const share = budget > 0 ? Math.min(100, Math.round((row.attempts_sent / budget) * 100)) : 0
  return (
    <div className="rounded-[7px] border p-2">
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}>
        <Icon className={cn("size-3.5 shrink-0", spinning && "animate-spin")} aria-hidden="true" />
        {REPETITION_LABEL[row.status]}
        {row.status === "running" && <span className="tabular font-normal">{share} %</span>}
      </p>
      {row.status === "incomplete" && row.reason && (
        <p className="mt-0.5 text-xs text-muted-foreground">{row.reason}</p>
      )}
      {row.attempts_sent > 0 && (
        <p className="tabular mt-0.5 text-xs text-muted-foreground">
          {row.attempts_sent.toLocaleString("en-GB")} attempts
        </p>
      )}
      {row.campaign_run_id && row.status !== "planned" && (
        <span className="sr-only">Campaign run started {row.started_at ?? ""}</span>
      )}
    </div>
  )
}

/**
 * Screen 67: how a benchmark run is going (FR-11.3, UC-11.4). Every cell says its state in words,
 * the order is explained, and a pause says exactly why it happened.
 */
export function BenchmarkProgress({ code }: { code: string }) {
  const [data, setData] = useState<BenchmarkDetail | null>(null)
  const [error, setError] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState(false)
  usePageCrumbs([{ label: code }])

  useEffect(() => {
    const controller = new AbortController()
    readBenchmark(code, controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [code, reloads])

  const reload = useCallback(() => setReloads((n) => n + 1), [])
  const going = data?.status === "running"

  // While it runs, the page asks again, so the matrix follows the experiment (UC-11.4 step 6).
  useEffect(() => {
    if (!going) return
    const timer = setTimeout(reload, 4000)
    return () => clearTimeout(timer)
  }, [going, reload, reloads])

  async function act(what: "start" | "pause" | "resume" | "stop") {
    setBusy(true)
    try {
      const after = await {
        start: startBenchmark,
        pause: pauseBenchmark,
        resume: resumeBenchmark,
        stop: stopBenchmark,
      }[what](code)
      setData(after)
      toast.success(`${code} is ${BENCHMARK_STATUS_LABEL[after.status].toLowerCase()}.`, {
        description: after.status_message || undefined,
      })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "That could not be done.")
    } finally {
      setBusy(false)
    }
  }

  const rows = data?.repetition_rows ?? []
  const pairs = [
    ...new Map(
      rows.map((row) => [
        `${row.target_id}:${row.strategy_key}`,
        { target_id: row.target_id, target_name: row.target_name, strategy_key: row.strategy_key },
      ]),
    ).values(),
  ]
  const repetitions = [...new Set(rows.map((row) => row.repetition))].sort((a, b) => a - b)
  const current = rows.find((row) => row.status === "running" || row.status === "resetting")
  const attempts = rows.reduce((sum, row) => sum + row.attempts_sent, 0)
  const cost = rows.reduce((sum, row) => sum + Number(row.cost_usd), 0)

  return (
    <div className="min-w-0">
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            This benchmark run could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-4" role="status" aria-label="Loading the benchmark run">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      )}

      {data && (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">
                {data.code} — {data.name}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <Badge variant="outline">{BENCHMARK_STATUS_LABEL[data.status]}</Badge>
                <span className="tabular">
                  {data.runs_done} of {data.runs_total} campaign runs complete
                </span>
                {data.baseline_code && <span>· baseline {data.baseline_code}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(data.status === "completed" || data.status === "stopped") && (
                <>
                  <Button asChild variant="outline">
                    <Link href={`/lab/benchmarks/${data.code}/labelling`}>Labelling</Link>
                  </Button>
                  <Button asChild>
                    <Link href={`/lab/benchmarks/${data.code}/results`}>Results</Link>
                  </Button>
                </>
              )}
              {data.status === "draft" && (
                <Button onClick={() => void act("start")} disabled={busy}>
                  {busy ? "Starting…" : "Start"}
                </Button>
              )}
              {data.status === "running" && (
                <Button variant="outline" onClick={() => void act("pause")} disabled={busy}>
                  Pause
                </Button>
              )}
              {data.status === "paused" && (
                <Button onClick={() => void act("resume")} disabled={busy}>
                  Resume
                </Button>
              )}
              {(data.status === "running" || data.status === "paused") && (
                <Button variant="outline" onClick={() => void act("stop")} disabled={busy}>
                  Stop
                </Button>
              )}
            </div>
          </div>

          {data.status === "paused" && (
            <Alert role="alert" className="mb-4 border-warning">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                <span className="font-medium">Paused.</span> {data.status_message} No run starts on a
                lab target that wasn&apos;t reset.
              </AlertDescription>
            </Alert>
          )}
          {data.status !== "paused" && data.status_message && (
            <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground" aria-live="polite">
              {going ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <CirclePause className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              {data.status_message}
            </p>
          )}

          <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            The campaign runs go in a random, interleaved order, and each one starts from a freshly
            reset lab target.
          </p>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section aria-label="Repetitions" className="min-w-0 rounded-[10px] border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Lab target and strategy by repetition</h2>
              </div>
              {/* The matrix scrolls sideways on a narrow screen, so it is a region a keyboard can
                  reach and scroll (axe: scrollable-region-focusable). */}
              <div
                role="region"
                aria-label="Repetitions by lab target, strategy and repetition"
                tabIndex={0}
                className="overflow-x-auto p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <table className="w-full min-w-[32rem] border-separate border-spacing-1 text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="text-left text-xs font-medium text-muted-foreground">
                        Lab target · strategy
                      </th>
                      {repetitions.map((number) => (
                        <th
                          key={number}
                          scope="col"
                          className="text-left text-xs font-medium text-muted-foreground"
                        >
                          Repetition {number}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((pair) => (
                      <tr key={`${pair.target_id}:${pair.strategy_key}`}>
                        <th scope="row" className="pr-3 text-left align-top text-sm font-medium">
                          {pair.target_name}
                          <span className="block text-xs font-normal text-muted-foreground">
                            Strategy {pair.strategy_key}
                          </span>
                        </th>
                        {repetitions.map((number) => {
                          const row = rows.find(
                            (r) =>
                              r.target_id === pair.target_id &&
                              r.strategy_key === pair.strategy_key &&
                              r.repetition === number,
                          )
                          return (
                            <td key={number} className="align-top">
                              {row ? <Tile row={row} budget={data.attempt_budget} /> : null}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="min-w-0 space-y-4">
              <section aria-label="Current run" className="rounded-[10px] border bg-card p-4">
                <h2 className="text-sm font-semibold">Current run</h2>
                {current ? (
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Lab target</dt>
                      <dd>{current.target_name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Strategy and repetition</dt>
                      <dd>
                        {current.strategy_key} · repetition {current.repetition}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">State</dt>
                      <dd>{REPETITION_LABEL[current.status]}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No campaign run is going right now.
                  </p>
                )}
              </section>

              <section aria-label="So far" className="rounded-[10px] border bg-card p-4">
                <h2 className="text-sm font-semibold">So far</h2>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-muted-foreground">Attempts</dt>
                    <dd className="tabular">{attempts.toLocaleString("en-GB")}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-muted-foreground">LLM cost</dt>
                    <dd className="tabular">${cost.toFixed(2)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-muted-foreground">Started</dt>
                    <dd className="tabular">
                      {data.started_at ? WHEN.format(new Date(data.started_at)) : "Not yet"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-muted-foreground">Elapsed</dt>
                    <dd className="tabular">{elapsed(data.started_at, data.ended_at)}</dd>
                  </div>
                </dl>
              </section>

              <section aria-label="Configuration" className="rounded-[10px] border bg-card p-4">
                <h2 className="text-sm font-semibold">Fixed when it started</h2>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Budget per run</dt>
                    <dd className="tabular">{data.attempt_budget.toLocaleString("en-GB")} attempts</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Repetitions</dt>
                    <dd className="tabular">{data.repetitions}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">LLM judge</dt>
                    <dd>{data.judge_every_attempt ? "Every attempt" : "As each test says"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Estimate</dt>
                    <dd className="tabular">
                      {costRange(
                        data.estimate.llm_cost_low_usd ?? null,
                        data.estimate.llm_cost_high_usd ?? null,
                      )}
                      {data.estimate.minutes ? ` · ${duration(data.estimate.minutes)}` : ""}
                    </dd>
                  </div>
                  {data.versions.models && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Models</dt>
                      <dd className="space-y-0.5">
                        {Object.entries(data.versions.models)
                          .filter(([, model]) => model)
                          .map(([task, model]) => (
                            <span key={task} className="block font-mono text-xs">
                              {model}
                            </span>
                          ))}
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  <Link href="/lab" className="text-primary underline underline-offset-2">
                    Back to the Security Lab
                  </Link>
                </p>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
