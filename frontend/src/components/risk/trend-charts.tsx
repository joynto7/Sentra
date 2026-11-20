"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BAND_LABEL, type RiskBand, type ScoreSeries, type Trends } from "@/lib/risk"
import { formatDate } from "@/lib/targets"

// A series is told apart by the shape of its line, not by its colour (NFR-4.3, WCAG 1.4.1).
const DASHES = ["", "7 4", "2 4"]
const LINE = "var(--chart-line, var(--foreground))"
// The bands of FR-7.2 as the lines of the right axis, so a score can be read against them.
const BANDS: { band: RiskBand; from: number }[] = [
  { band: "critical", from: 75 },
  { band: "high", from: 50 },
  { band: "medium", from: 25 },
  { band: "low", from: 1 },
]
const WIDTH = 720
const HEIGHT = 220
const PAD = { left: 34, right: 96, top: 12, bottom: 26 }

const day = (iso: string) => new Date(iso).getTime()

/** The risk score of each target over the period, as a step line through its calculations. */
function ScoreChart({ series, from, to }: { series: ScoreSeries[]; from: number; to: number }) {
  const titleId = useId()
  const x = (at: string) => {
    const span = Math.max(1, to - from)
    const share = Math.min(1, Math.max(0, (day(at) - from) / span))
    return PAD.left + share * (WIDTH - PAD.left - PAD.right)
  }
  const y = (score: number) => PAD.top + (1 - score / 100) * (HEIGHT - PAD.top - PAD.bottom)
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-56 w-full"
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>
        Risk score over the period:{" "}
        {series.map((one) => `${one.target.name} ends at ${one.score ?? "no score"}`).join(", ")}
      </title>
      {BANDS.map((band) => (
        <g key={band.band}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(band.from)}
            y2={y(band.from)}
            stroke="var(--border)"
            strokeDasharray="2 4"
          />
          <text x={WIDTH - PAD.right + 6} y={y(band.from) + 4} className="fill-muted-foreground text-[11px]">
            {BAND_LABEL[band.band]} {band.from}
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--border)" />
      <text x={4} y={y(100) + 4} className="fill-muted-foreground text-[11px]">
        100
      </text>
      <text x={10} y={y(0) + 4} className="fill-muted-foreground text-[11px]">
        0
      </text>
      {series.map((one, index) => (
        <g key={one.target.id}>
          <polyline
            points={one.points.map((point) => `${x(point.at)},${y(point.score)}`).join(" ")}
            fill="none"
            stroke={LINE}
            strokeWidth={1.75}
            strokeDasharray={DASHES[index % DASHES.length]}
            strokeLinejoin="round"
          />
          {one.points.map((point) => (
            <circle key={point.at} cx={x(point.at)} cy={y(point.score)} r={3} fill={LINE} />
          ))}
          {one.points.length > 0 && (
            <text
              x={x(one.points[one.points.length - 1].at) - 6}
              y={y(one.points[one.points.length - 1].score) - 7}
              textAnchor="end"
              className="fill-foreground text-[11px] font-medium"
            >
              {one.points[one.points.length - 1].score}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

/** New and closed findings per part of the period, with the number printed on every bar. */
function FindingsChart({ buckets }: { buckets: Trends["buckets"] }) {
  const titleId = useId()
  const most = Math.max(1, ...buckets.flatMap((bucket) => [bucket.new, bucket.closed]))
  const width = (WIDTH - PAD.left - 16) / Math.max(1, buckets.length)
  const height = (value: number) => (value / most) * (HEIGHT - PAD.top - PAD.bottom - 14)
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-56 w-full"
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>
        New and closed findings per part of the period:{" "}
        {buckets.map((b) => `${formatDate(b.starts_at)}: ${b.new} new, ${b.closed} closed`).join("; ")}
      </title>
      <line
        x1={PAD.left}
        x2={WIDTH - 16}
        y1={HEIGHT - PAD.bottom}
        y2={HEIGHT - PAD.bottom}
        stroke="var(--border)"
      />
      {buckets.map((bucket, index) => {
        const left = PAD.left + index * width
        const bar = (value: number, offset: number, pattern: string | undefined) => (
          <>
            <rect
              x={left + offset}
              y={HEIGHT - PAD.bottom - height(value)}
              width={width / 3}
              height={height(value)}
              fill={pattern ? `url(#${pattern})` : LINE}
              stroke={LINE}
              strokeWidth={pattern ? 1 : 0}
            />
            <text
              x={left + offset + width / 6}
              y={HEIGHT - PAD.bottom - height(value) - 4}
              textAnchor="middle"
              className="fill-foreground text-[11px]"
            >
              {value}
            </text>
          </>
        )
        return (
          <g key={bucket.starts_at}>
            {bar(bucket.new, width / 8, undefined)}
            {bar(bucket.closed, width / 8 + width / 3 + 4, "closed-bars")}
            <text
              x={left + width / 2}
              y={HEIGHT - PAD.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {formatDate(bucket.starts_at).replace(/ \d{4}$/, "")}
            </text>
          </g>
        )
      })}
      <defs>
        {/* Closed findings are hatched, so the two bars differ without colour (WCAG 1.4.1). */}
        <pattern id="closed-bars" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="var(--card)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke={LINE} strokeWidth="1.5" />
        </pattern>
      </defs>
    </svg>
  )
}

/**
 * The trends of Screen 42 (UC-7.3 step 5): how the risk scores moved across the period, and how
 * many findings came and went. Both charts can be read as tables, which hold the same numbers, so
 * the page works for keyboard and screen-reader users too (NFR-4.3).
 */
export function TrendCharts({ trends, periodDays }: { trends: Trends; periodDays: number }) {
  const [asTables, setAsTables] = useState(false)
  const buckets = trends.buckets
  const from = buckets.length ? day(buckets[0].starts_at) : 0
  const to = buckets.length ? day(buckets[buckets.length - 1].ends_at) : 1
  const nothing = trends.scores.length === 0 && buckets.every((b) => b.new === 0 && b.closed === 0)

  return (
    <section aria-labelledby="trends" className="min-w-0 rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <h2 id="trends" className="text-[15px] font-semibold">
          Trends · last {periodDays} days
        </h2>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setAsTables((on) => !on)}>
          {asTables ? "View as charts" : "View as tables"}
        </Button>
      </div>
      {nothing ? (
        <p className="p-4 text-sm text-muted-foreground">
          Nothing changed in this period: no risk score was calculated and no finding was opened or closed.
        </p>
      ) : (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium">Risk score over time</h3>
            {trends.scores.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No risk score was calculated in this period.</p>
            ) : asTables ? (
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="text-xs">
                      Target
                    </TableHead>
                    <TableHead scope="col" className="text-xs">
                      When
                    </TableHead>
                    <TableHead scope="col" className="text-xs">
                      Score
                    </TableHead>
                    <TableHead scope="col" className="text-xs">
                      Band
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trends.scores.flatMap((one) =>
                    one.points.map((point) => (
                      <TableRow key={`${one.target.id}-${point.at}`}>
                        <TableCell className="text-[13px]">{one.target.name}</TableCell>
                        <TableCell className="text-[13px] whitespace-nowrap">
                          {formatDate(point.at)}
                          {point.before_period && (
                            <span className="block text-xs text-muted-foreground">before the period</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-[13px]">{point.score}</TableCell>
                        <TableCell className="text-[13px]">{BAND_LABEL[point.band]}</TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            ) : (
              <>
                <ScoreChart series={trends.scores} from={from} to={to} />
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {trends.scores.map((one, index) => (
                    <li key={one.target.id} className="flex items-center gap-1.5">
                      <svg width="22" height="8" aria-hidden="true">
                        <line
                          x1="0"
                          y1="4"
                          x2="22"
                          y2="4"
                          stroke={LINE}
                          strokeWidth="1.75"
                          strokeDasharray={DASHES[index % DASHES.length]}
                        />
                      </svg>
                      {one.target.name}{" "}
                      <span className="tabular text-muted-foreground">
                        {one.score ?? "—"} {one.band ? BAND_LABEL[one.band] : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium">New and closed findings</h3>
            {asTables ? (
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="text-xs">
                      From
                    </TableHead>
                    <TableHead scope="col" className="text-xs">
                      New
                    </TableHead>
                    <TableHead scope="col" className="text-xs">
                      Closed
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.map((bucket) => (
                    <TableRow key={bucket.starts_at}>
                      <TableCell className="text-[13px] whitespace-nowrap">
                        {formatDate(bucket.starts_at)}
                      </TableCell>
                      <TableCell className="tabular text-[13px]">{bucket.new}</TableCell>
                      <TableCell className="tabular text-[13px]">{bucket.closed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <>
                <FindingsChart buckets={buckets} />
                <p className="mt-1 text-[13px] text-text-secondary">
                  Solid bars are findings that were opened, hatched bars findings that were closed —
                  fixed and verified, a false positive or merged.{" "}
                  {trends.net_change === 0
                    ? "As many were closed as came in."
                    : trends.net_change < 0
                      ? `${-trends.net_change} fewer open findings than at the start of the period.`
                      : `${trends.net_change} more open findings than at the start of the period.`}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
