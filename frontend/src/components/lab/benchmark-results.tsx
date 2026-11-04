"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleSlash, Info, Table2, TriangleAlert } from "lucide-react"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type Agreement,
  type Evaluation,
  type Figure,
  type StrategyMetrics,
  benchmarkEvaluation,
  figureSpread,
  figureValue,
  share,
} from "@/lib/lab"
import { cn } from "@/lib/utils"

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

/** The metrics in the order the comparison table shows them (UC-11.5 step 4). */
const ORDER = [
  "discovery_rate",
  "false_positive_rate",
  "false_negative_rate",
  "attempts_per_discovery",
  "minutes_per_discovery",
  "attack_success_rate",
  "tokens",
  "cost",
]

function figureOf(strategy: StrategyMetrics, key: string): Figure | undefined {
  return strategy.figures.find((figure) => figure.key === key)
}

/** "38% ± 4", or the reason there is no value. */
function Value({ figure }: { figure: Figure | undefined }) {
  if (!figure || figure.mean === null) {
    return (
      <span className="text-muted-foreground" title={figure?.note ?? undefined}>
        —
      </span>
    )
  }
  return (
    <span className="tabular">
      {figureValue(figure, figure.mean)}
      {figure.sd !== null && (
        <span className="ml-1 text-muted-foreground">{figureSpread(figure)}</span>
      )}
    </span>
  )
}

/**
 * One metric as a dot per completed repetition with the mean marked, on one scale for every
 * strategy (UC-11.5 step 6). It is a picture of the same numbers the table holds, so the table
 * below is its text alternative.
 */
function DotPlot({ label, figures }: { label: string; figures: { key: string; figure: Figure }[] }) {
  const all = figures.flatMap(({ figure }) => figure.values)
  if (all.length === 0) return null
  const low = Math.min(...all)
  const high = Math.max(...all)
  const pad = (high - low || Math.abs(high) || 1) * 0.15
  const from = Math.max(0, low - pad) // none of these metrics can be negative
  const to = high + pad
  const at = (value: number) => ((value - from) / (to - from)) * 100
  const first = figures[0].figure
  const said = figures
    .map(({ key, figure }) =>
      figure.mean === null
        ? `strategy ${key} has no value`
        : `strategy ${key} mean ${figureValue(figure, figure.mean)} over ${figure.repetitions} repetitions, from ${figureValue(figure, Math.min(...figure.values))} to ${figureValue(figure, Math.max(...figure.values))}`,
    )
    .join("; ")

  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="mt-2 space-y-1" role="img" aria-label={`${label}: ${said}.`}>
        {figures.map(({ key, figure }) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-xs font-medium text-muted-foreground">{key}</span>
            <div className="relative h-7 min-w-0 flex-1 rounded-[5px] border bg-muted/30">
              {figure.values.map((value, index) => (
                <span
                  key={index}
                  className={cn(
                    "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                    figures[0].key === key ? "border border-foreground/60" : "bg-primary",
                  )}
                  style={{ left: `${at(value)}%` }}
                />
              ))}
              {figure.mean !== null && (
                <span
                  className="absolute top-1 bottom-1 w-0.5 -translate-x-1/2 bg-foreground"
                  style={{ left: `${at(figure.mean)}%` }}
                />
              )}
            </div>
            <span className="tabular w-20 shrink-0 text-right text-xs">
              {figure.mean === null ? "—" : figureValue(figure, figure.mean)}
            </span>
          </div>
        ))}
      </div>
      <p className="tabular mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{figureValue(first, from, first.mean ?? high)}</span>
        <span>{figureValue(first, to, first.mean ?? high)}</span>
      </p>
    </div>
  )
}

/** Precision and recall of one detection against the blind labels, on a scale of 0 to 1. */
function AgreementRow({ row }: { row: Agreement }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{row.label}</h3>
      <dl className="mt-1.5 space-y-1.5">
        {(["precision", "recall"] as const).map((what) => (
          <div key={what} className="flex items-center gap-3">
            <dt className="w-16 shrink-0 text-xs text-muted-foreground capitalize">{what}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${what} ${share(row[what])} of 1`}
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    row.key === "combined" ? "bg-primary" : "bg-muted-foreground",
                  )}
                  style={{ width: `${row[what] ?? 0}%` }}
                />
              </span>
              <span className="tabular w-10 text-right text-sm">{share(row[what])}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Screen 69: what a benchmark run measured (FR-11.4, UC-11.5 steps 4-6 with 4a and 6a). Every
 * figure is a mean over the repetitions that finished, with its spread, and the page says how
 * many repetitions each one rests on.
 */
export function BenchmarkResults({ code }: { code: string }) {
  const [data, setData] = useState<Evaluation | null>(null)
  const [error, setError] = useState(false)
  const [asTable, setAsTable] = useState(false)
  usePageCrumbs([{ label: code, href: `/lab/benchmarks/${code}` }, { label: "Results" }])

  useEffect(() => {
    const controller = new AbortController()
    benchmarkEvaluation(code, controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [code])

  const strategies = data?.strategies ?? []
  const completed = strategies.map((strategy) => strategy.completed)
  const perStrategy =
    completed.length === 0
      ? "0"
      : Math.min(...completed) === Math.max(...completed)
        ? `${completed[0]}`
        : `${Math.min(...completed)}–${Math.max(...completed)}`
  const labels = data?.agreement[0]?.labelled ?? 0
  const shown = ORDER.filter((key) =>
    strategies.some((strategy) => (figureOf(strategy, key)?.values.length ?? 0) > 0),
  )

  return (
    <div className="min-w-0">
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>These results could not be loaded.</AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-4" role="status" aria-label="Loading the results">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <>
          <div className="mb-4">
            <h1 className="text-2xl font-semibold tracking-tight">{data.code} — Results</h1>
            <p className="tabular mt-1 text-sm text-muted-foreground">
              {data.documented.length} lab target{data.documented.length === 1 ? "" : "s"} ·{" "}
              {strategies.length} strategies · {perStrategy} completed repetitions per strategy
              {data.ended_at
                ? ` · ${data.status === "completed" ? "completed" : "ended"} ${WHEN.format(new Date(data.ended_at))}`
                : " · still going"}
            </p>
          </div>

          <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Results are descriptive statistics over the completed repetitions; statistical tests are
            applied to the exported data.
          </p>

          {data.missing.length > 0 && (
            <Alert role="status" className="mb-4 border-warning">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                <span className="font-medium">These results are incomplete.</span>
                <ul className="mt-1 list-inside list-disc">
                  {data.missing.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <Link
                  href={`/lab/benchmarks/${code}/labelling`}
                  className="mt-2 inline-block text-primary underline underline-offset-2"
                >
                  Label the sample
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {strategies.length === 0 ? (
            <EmptyState
              title="This benchmark run has measured nothing yet"
              description="Its figures appear once its campaign runs have ended."
            />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                <section
                  aria-label="Strategy comparison"
                  className="min-w-0 rounded-[10px] border bg-card"
                >
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-semibold">Strategy comparison (RQ1)</h2>
                  </div>
                  <div
                    role="region"
                    aria-label="Metrics by strategy"
                    tabIndex={0}
                    className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <table className="w-full min-w-[28rem] text-sm">
                      <thead>
                        <tr className="border-b">
                          <th
                            scope="col"
                            className="px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            Metric · mean ± standard deviation
                          </th>
                          {strategies.map((strategy) => (
                            <th
                              key={strategy.key}
                              scope="col"
                              className="px-4 py-2 text-right text-xs font-medium"
                            >
                              {strategy.key} {strategy.name}
                              {strategy.adaptive_agent && (
                                <span className="block font-normal text-muted-foreground">
                                  adaptive agent
                                </span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ORDER.map((key) => {
                          const first = strategies
                            .map((strategy) => figureOf(strategy, key))
                            .find(Boolean)
                          if (!first) return null
                          return (
                            <tr key={key} className="border-b last:border-0">
                              <th scope="row" className="px-4 py-2 text-left font-normal">
                                {first.label}
                              </th>
                              {strategies.map((strategy) => (
                                <td key={strategy.key} className="px-4 py-2 text-right">
                                  <Value figure={figureOf(strategy, key)} />
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
                    {strategies
                      .filter((strategy) => strategy.incomplete > 0)
                      .map((strategy) => {
                        const why = strategy.rows.find(
                          (row) => row.status === "incomplete" && row.reason,
                        )?.reason
                        return (
                          <p key={strategy.key} className="flex items-start gap-1.5">
                            <CircleSlash className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            {strategy.incomplete} repetition
                            {strategy.incomplete === 1 ? "" : "s"} of strategy {strategy.key}{" "}
                            {strategy.incomplete === 1 ? "is" : "are"} excluded
                            {why ? `: ${why.toLowerCase()}` : "."}
                          </p>
                        )
                      })}
                    {data.documented.map((list) => (
                      <p key={list.target_id}>
                        Measured against {list.target_name}&apos;s documented list, version{" "}
                        {list.version} — {list.count} weakness{list.count === 1 ? "" : "es"}
                        {list.added_by_analyst > 0
                          ? `, ${list.added_by_analyst} added by an analyst`
                          : ""}
                        .
                      </p>
                    ))}
                  </div>
                </section>

                <section
                  aria-label="Detection reliability"
                  className="min-w-0 rounded-[10px] border bg-card"
                >
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-semibold">Detection reliability (RQ2)</h2>
                  </div>
                  <div className="space-y-4 px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      Agreement with the analyst&apos;s blind labels, based on {labels} label
                      {labels === 1 ? "" : "s"}.
                    </p>
                    {labels === 0 ? (
                      <p className="text-sm">
                        No attempt of the sample is labelled yet, so there is nothing to compare.
                      </p>
                    ) : (
                      <>
                        {data.agreement.map((row) => (
                          <AgreementRow key={row.key} row={row} />
                        ))}
                        <p className="text-xs text-muted-foreground">
                          Bars share one scale of 0–1.
                          {data.agreement[0].unsure > 0 &&
                            ` ${data.agreement[0].unsure} label${data.agreement[0].unsure === 1 ? " was" : "s were"} "unsure" and ${data.agreement[0].unsure === 1 ? "is" : "are"} left out.`}
                          {data.agreement.some((row) => row.without_verdict > 0) &&
                            " An attempt the detection gave no verdict for is left out of that row."}
                        </p>
                      </>
                    )}
                  </div>
                </section>
              </div>

              {data.baseline && (
                <section
                  aria-label="Against the baseline"
                  className="mt-4 min-w-0 rounded-[10px] border bg-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                    <h2 className="text-sm font-semibold">
                      Against {data.baseline.code} — {data.baseline.name}
                    </h2>
                    <Badge variant="outline">baseline</Badge>
                  </div>
                  <ul className="divide-y">
                    {data.baseline.rows.map((row) => (
                      <li
                        key={row.strategy_key}
                        className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <span>
                          {row.strategy_key} {row.strategy_name}
                        </span>
                        <span className="tabular text-muted-foreground">
                          attack success {row.baseline_rate === null ? "—" : `${row.baseline_rate}%`}{" "}
                          → {row.success_rate === null ? "—" : `${row.success_rate}%`}
                          {row.reduction !== null && (
                            <span className="ml-2 text-foreground">
                              {row.reduction >= 0 ? "−" : "+"}
                              {Math.abs(row.reduction)}%
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                    {data.baseline.note}
                  </p>
                </section>
              )}

              <section
                aria-label="Repetitions per metric"
                className="mt-4 min-w-0 rounded-[10px] border bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">Repetitions per metric</h2>
                  <Button variant="outline" size="sm" onClick={() => setAsTable((on) => !on)}>
                    <Table2 aria-hidden="true" />
                    {asTable ? "View as dots" : "View as table"}
                  </Button>
                </div>

                {shown.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    No repetition has finished yet, so there is nothing to plot.
                  </p>
                ) : asTable ? (
                  <div
                    role="region"
                    aria-label="Every repetition's value per metric"
                    tabIndex={0}
                    className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <table className="w-full min-w-[32rem] text-sm">
                      <thead>
                        <tr className="border-b">
                          <th
                            scope="col"
                            className="px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            Metric
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            Strategy
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            One value per completed repetition
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((key) =>
                          strategies.map((strategy) => {
                            const figure = figureOf(strategy, key)
                            if (!figure) return null
                            return (
                              <tr key={`${key}:${strategy.key}`} className="border-b last:border-0">
                                <th scope="row" className="px-4 py-2 text-left font-normal">
                                  {figure.label}
                                </th>
                                <td className="px-4 py-2">{strategy.key}</td>
                                <td className="tabular px-4 py-2">
                                  {figure.values.length === 0
                                    ? "—"
                                    : figure.values
                                        .map((value) => figureValue(figure, value))
                                        .join(", ")}
                                </td>
                              </tr>
                            )
                          }),
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-5 p-4 md:grid-cols-2">
                      {shown.map((key) => {
                        const figures = strategies
                          .map((strategy) => ({ key: strategy.key, figure: figureOf(strategy, key) }))
                          .filter((pair): pair is { key: string; figure: Figure } => Boolean(pair.figure))
                        return (
                          <DotPlot
                            key={key}
                            label={figures[0]?.figure.label ?? key}
                            figures={figures}
                          />
                        )
                      })}
                    </div>
                    <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                      Each dot is one completed repetition; the bar is the mean. The first strategy
                      is drawn as an outline and the others filled, and every row is labelled with
                      its strategy.
                    </p>
                  </>
                )}
              </section>
            </>
          )}

          <p className="mt-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <Link
              href={`/lab/benchmarks/${code}`}
              className="text-primary underline underline-offset-2"
            >
              Back to {code}
            </Link>
            <Link
              href={`/lab/benchmarks/${code}/labelling`}
              className="text-primary underline underline-offset-2"
            >
              Labelling
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
