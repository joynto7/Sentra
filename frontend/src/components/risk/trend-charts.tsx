"use client"

import dynamic from "next/dynamic"
import Link from "next/link"

import { FLOW, SCORE_LINES } from "@/components/risk/chart-series"
import { ChartCard, type ChartState } from "@/components/sentra/chart-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BAND_LABEL, type ScoreSeries, type Trends } from "@/lib/risk"
import { formatDate } from "@/lib/targets"

// The charting library is loaded only here, after the page itself; the space it will take is
// held meanwhile, so nothing below it jumps.
const placeholder = () => <div className="h-[200px]" aria-hidden="true" />
const ScoreTrend = dynamic(() => import("@/components/risk/score-trend"), { ssr: false, loading: placeholder })
const FindingsFlow = dynamic(() => import("@/components/risk/findings-flow"), { ssr: false, loading: placeholder })

const day = (iso: string) => new Date(iso).getTime()

/** A trend needs two calculations of one target, or one from before the period to compare with. */
function scoreState(scores: ScoreSeries[]): ChartState {
  if (scores.length === 0) return "empty"
  const history = scores.some((one) => one.points.length > 1 || one.points.some((point) => point.before_period))
  return history ? "ready" : "too-little"
}

function ScoreTable({ scores }: { scores: ScoreSeries[] }) {
  return (
    <Table>
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

function FlowTable({ buckets }: { buckets: Trends["buckets"] }) {
  return (
    <Table>
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
            <TableCell className="tabular text-[13px]">{bucket.new}</TableCell>
            <TableCell className="tabular text-[13px]">{bucket.closed}</TableCell>
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
 * little to draw.
 */
export function TrendCharts({ trends, periodDays }: { trends: Trends; periodDays: number }) {
  const buckets = trends.buckets
  const from = buckets.length ? day(buckets[0].starts_at) : 0
  const to = buckets.length ? day(buckets[buckets.length - 1].ends_at) : 1
  const perDays = Math.round(periodDays / Math.max(1, buckets.length))
  const totals = {
    new: buckets.reduce((sum, bucket) => sum + bucket.new, 0),
    closed: buckets.reduce((sum, bucket) => sum + bucket.closed, 0),
  }
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
                <Link href={`/targets/${one.target.id}`} className="text-link hover:underline">
                  {one.target.name}
                </Link>
                <span className="tabular text-muted-foreground">
                  {one.score ?? "—"} {one.band ? BAND_LABEL[one.band] : ""}
                </span>
              </li>
            ))}
          </ul>
        }
        howToRead="Each step is a new calculation, after a run, a triage decision or a retest; the shading marks the bands."
      >
        <ScoreTrend series={scores} from={from} to={to} />
      </ChartCard>

      <ChartCard
        title="New and closed findings"
        unit={`Findings per ${perDays} days · ${periodDays} days`}
        state={totals.new + totals.closed === 0 ? "empty" : "ready"}
        emptyText={`No finding was opened or closed in the last ${periodDays} days.`}
        table={<FlowTable buckets={buckets} />}
        legend={
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Bars">
            {(["new", "closed"] as const).map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: FLOW[key].color }} aria-hidden="true" />
                {FLOW[key].label}
                <span className="tabular text-muted-foreground">· {totals[key]}</span>
              </li>
            ))}
          </ul>
        }
        howToRead={`Closed means fixed and verified, a false positive or merged. ${netSentence(trends.net_change)}`}
      >
        <FindingsFlow buckets={buckets} />
      </ChartCard>
    </div>
  )
}
