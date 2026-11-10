"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"

import { FLOW, SCORE_LINES, flowHref } from "@/components/risk/chart-series"
import { ChartCard, type ChartState } from "@/components/sentra/chart-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BAND_LABEL, type RiskMethod, type ScoreSeries, type TrendBucket, type Trends, getRiskMethod } from "@/lib/risk"
import { formatDate } from "@/lib/targets"

// The charting library is loaded only here, after the page itself; the space it will take is
// held meanwhile, so nothing below it jumps.
const placeholder = () => <div className="h-[200px]" aria-hidden="true" />
const ScoreTrend = dynamic(() => import("@/components/risk/score-trend"), { ssr: false, loading: placeholder })
const FindingsFlow = dynamic(() => import("@/components/risk/findings-flow"), { ssr: false, loading: placeholder })

const day = (iso: string) => new Date(iso).getTime()
const DAY = 24 * 60 * 60 * 1000

/** A trend needs two calculations of one target, or one from before the period to compare with. */
function scoreState(scores: ScoreSeries[]): ChartState {
  if (scores.length === 0) return "empty"
  const history = scores.some((one) => one.points.length > 1 || one.points.some((point) => point.before_period))
  return history ? "ready" : "too-little"
}

// A table that can scroll sideways on a narrow screen is a stop for the keyboard (WCAG 2.1.1).
const frame = (label: string) => ({
  tabIndex: 0,
  role: "group",
  "aria-label": label,
  className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
})

function ScoreTable({ scores }: { scores: ScoreSeries[] }) {
  return (
    <Table container={frame("Risk score over time, as a table")}>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="text-xs">Target</TableHead>
          <TableHead scope="col" className="text-xs">Calculated</TableHead>
          <TableHead scope="col" className="text-xs">Score</TableHead>
          <TableHead scope="col" className="text-xs">Band</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scores.flatMap((one) =>
          one.points.map((point) => (
            <TableRow key={`${one.target.id}-${point.at}`}>
              <TableCell className="text-[13px]">{one.target.name}</TableCell>
              <TableCell className="text-[13px] whitespace-nowrap">
                {formatDate(point.at)}
                {point.before_period && <span className="block text-xs text-muted-foreground">before the period</span>}
              </TableCell>
              <TableCell className="tabular text-[13px]">{point.score}</TableCell>
              <TableCell className="text-[13px]">{BAND_LABEL[point.band]}</TableCell>
            </TableRow>
          )),
        )}
      </TableBody>
    </Table>
  )
}

function FlowTable({ buckets, filterQuery }: { buckets: Trends["buckets"]; filterQuery: string }) {
  const cell = (bucket: TrendBucket, key: "new" | "closed") =>
    bucket[key] > 0 ? (
      <Link
        href={flowHref(bucket, key, filterQuery)}
        className="inline-flex min-h-6 min-w-6 items-center text-link hover:underline"
        aria-label={`${bucket[key]} ${key === "new" ? "first seen" : "closed"} from ${formatDate(bucket.starts_at)} to ${formatDate(bucket.ends_at)}`}
      >
        {bucket[key]}
      </Link>
    ) : (
      <span className="text-muted-foreground">0</span>
    )
  return (
    <Table container={frame("New and closed findings, as a table")}>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="text-xs">From</TableHead>
          <TableHead scope="col" className="text-xs">To</TableHead>
          <TableHead scope="col" className="text-xs">New</TableHead>
          <TableHead scope="col" className="text-xs">Closed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((bucket) => (
          <TableRow key={bucket.starts_at}>
            <TableCell className="text-[13px] whitespace-nowrap">{formatDate(bucket.starts_at)}</TableCell>
            <TableCell className="text-[13px] whitespace-nowrap">{formatDate(bucket.ends_at)}</TableCell>
            <TableCell className="tabular text-[13px]">{cell(bucket, "new")}</TableCell>
            <TableCell className="tabular text-[13px]">{cell(bucket, "closed")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** What the period did to the number of open findings, in words that carry their own direction. */
function netSentence(net: number): string {
  if (net === 0) return "As many findings were closed as came in."
  return net > 0
    ? `${net} more ${net === 1 ? "finding" : "findings"} came in than were closed.`
    : `${-net} more ${net === -1 ? "finding was" : "findings were"} closed than came in.`
}

/**
 * The trends of Screen 42 (UC-7.3 step 5), as two chart cards side by side: how the risk scores
 * of the highest-scoring targets moved across the period, and how many findings came and went.
 * Each card can show its numbers as a table, and says so honestly when there is nothing or too
 * little to draw. Every count opens the findings it counts (step 6): a bar, a table cell, a total.
 */
export function TrendCharts({
  trends,
  periodDays,
  filterQuery,
}: {
  trends: Trends
  periodDays: number
  /** `&target_id=…&category=…`: what the dashboard is narrowed to */
  filterQuery: string
}) {
  const [bands, setBands] = useState<RiskMethod["bands"] | null>(null)
  useEffect(() => {
    // The bands come from the code that scores (FR-7.2, M7), so the shading can't drift from it
    const controller = new AbortController()
    getRiskMethod(controller.signal)
      .then((method) => setBands(method.bands))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const buckets = trends.buckets
  const from = buckets.length ? day(buckets[0].starts_at) : 0
  const to = buckets.length ? day(buckets[buckets.length - 1].ends_at) : 1
  const perDays = buckets.length ? Math.round((day(buckets[0].ends_at) - day(buckets[0].starts_at)) / DAY) : periodDays
  const totals = {
    new: buckets.reduce((sum, bucket) => sum + bucket.new, 0),
    closed: buckets.reduce((sum, bucket) => sum + bucket.closed, 0),
  }
  const whole: TrendBucket | null = buckets.length
    ? { starts_at: buckets[0].starts_at, ends_at: buckets[buckets.length - 1].ends_at, new: totals.new, closed: totals.closed }
    : null
  const scores = trends.scores
  const lines = scoreState(scores)

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard
        title="Risk score over time"
        unit={
          scores.length > 1
            ? `0 to 100 · the ${scores.length} highest-scoring targets · ${periodDays} days`
            : `0 to 100 · ${periodDays} days`
        }
        state={lines}
        emptyText="No target has a risk score yet."
        tooLittleText="The trend starts after the next run: each target has been scored once so far."
        table={<ScoreTable scores={scores} />}
        legend={
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Lines">
            {scores.map((one, index) => (
              <li key={one.target.id} className="flex items-center gap-1.5">
                <svg width="22" height="8" aria-hidden="true">
                  <line
                    x1="0"
                    y1="4"
                    x2="22"
                    y2="4"
                    stroke={SCORE_LINES[index].color}
                    strokeWidth="2"
                    strokeDasharray={SCORE_LINES[index].dash}
                  />
                </svg>
                <span className="sr-only">{SCORE_LINES[index].pattern} line:</span>
                <Link href={`/targets/${one.target.id}`} className="inline-flex min-h-6 items-center text-link hover:underline">
                  {one.target.name}
                </Link>
                <Link
                  href={`/findings?view=open&target_id=${one.target.id}`}
                  className="tabular inline-flex min-h-6 items-center text-muted-foreground hover:underline"
                  aria-label={`${one.score ?? "No score"} ${one.band ? BAND_LABEL[one.band] : ""}: the open findings of ${one.target.name}`}
                >
                  {one.score ?? "—"} {one.band ? BAND_LABEL[one.band] : ""}
                </Link>
              </li>
            ))}
          </ul>
        }
        howToRead="Each step is a new calculation, after a run, a triage decision or a retest; the shading marks the bands."
      >
        <ScoreTrend series={scores} from={from} to={to} bands={bands} />
      </ChartCard>

      <ChartCard
        title="New and closed findings"
        unit={`Findings per ${perDays} days · ${periodDays} days`}
        state={totals.new + totals.closed === 0 ? "empty" : "ready"}
        emptyText={`No finding was opened or closed in the last ${periodDays} days.`}
        table={<FlowTable buckets={buckets} filterQuery={filterQuery} />}
        legend={
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Bars">
            {(["new", "closed"] as const).map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: FLOW[key].color }} aria-hidden="true" />
                {FLOW[key].label}
                {whole && totals[key] > 0 ? (
                  <Link
                    href={flowHref(whole, key, filterQuery)}
                    className="tabular inline-flex min-h-6 items-center text-muted-foreground hover:underline"
                    aria-label={`${totals[key]} ${key === "new" ? "first seen" : "closed"} in the last ${periodDays} days`}
                  >
                    · {totals[key]}
                  </Link>
                ) : (
                  <span className="tabular text-muted-foreground">· {totals[key]}</span>
                )}
              </li>
            ))}
          </ul>
        }
        howToRead={`Closed means fixed and verified, a false positive or merged. ${netSentence(trends.net_change)} Select a bar for its findings.`}
      >
        <FindingsFlow buckets={buckets} filterQuery={filterQuery} />
      </ChartCard>
    </div>
  )
}
