"use client"

import { useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts"

import { CHART_FOCUS, SCORE_LINES } from "@/components/risk/chart-series"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { BAND_LABEL, type RiskBand, type RiskMethod, type ScoreSeries } from "@/lib/risk"

/** The bands of a risk score (FR-7.2, M7), shaded behind the lines and named on the right. The
 * page asks the API for them; these are the same values, for the moment before it answers. */
const FALLBACK: RiskMethod["bands"] = [
  { band: "critical", severity: "critical", from: 75, to: 100 },
  { band: "high", severity: "high", from: 50, to: 74 },
  { band: "medium", severity: "medium", from: 25, to: 49 },
  { band: "low", severity: "low", from: 1, to: 24 },
]
const FILL: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
}
// Right of the plot: first where each line ends now, then the band names (as the design draws it)
const BAND_COLUMN = 34
const RIGHT = 96
const HEIGHT = 200
const LABEL_GAP = 14 // px: an end label closer than this to another one is left to the legend

type Row = { at: number } & Record<string, number | string | boolean | null>

const time = (iso: string) => new Date(iso).getTime()
const shortDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

/**
 * One row per moment a score was calculated, from the start of the period to now. A score holds
 * until it is calculated again, so each line is a step line through real calculations: nothing
 * is interpolated. The last calculation before the period is where a line starts.
 */
export function scoreRows(series: ScoreSeries[], from: number, to: number): Row[] {
  const moments = new Set<number>([from, to])
  for (const one of series) for (const point of one.points) moments.add(Math.max(from, time(point.at)))
  return [...moments]
    .sort((a, b) => a - b)
    .map((at) => {
      const row: Row = { at }
      series.forEach((one, index) => {
        const reached = one.points.filter((point) => Math.max(from, time(point.at)) <= at)
        row[`s${index}`] = reached.length ? reached[reached.length - 1].score : null
        // The band that calculation gave, as the API says it, not worked out again here
        row[`s${index}_band`] = reached.length ? reached[reached.length - 1].band : null
        row[`s${index}_calculated`] = one.points.some((point) => !point.before_period && time(point.at) === at)
      })
      return row
    })
}

function TrendTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number | null; payload?: Row }[]
  label?: number
  series: ScoreSeries[]
}) {
  if (!active || !payload?.length || label === undefined) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-medium">{shortDate(label)}</p>
      <ul className="space-y-1">
        {payload
          .filter((item) => item.value !== null && item.value !== undefined)
          .map((item) => {
            const index = Number(String(item.dataKey).slice(1))
            const line = SCORE_LINES[index]
            return (
              <li key={String(item.dataKey)} className="flex items-center gap-2">
                <svg width="18" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="18" y2="3" stroke={line.color} strokeWidth="2" strokeDasharray={line.dash} />
                </svg>
                <span className="tabular font-semibold">{item.value}</span>
                <span className="text-muted-foreground">
                  {BAND_LABEL[(item.payload?.[`s${index}_band`] as RiskBand | null) ?? "none"]} ·{" "}
                  {series[index]?.target.name}
                </span>
              </li>
            )
          })}
      </ul>
    </div>
  )
}

/**
 * "Risk score over time" (Screen 42; UC-7.3 step 5): the scores of up to three targets across the
 * period, against the bands of FR-7.2 (M7). The chart can be read with the keyboard — focus it, then
 * the arrow keys move from one calculation to the next and the tooltip says what each line was —
 * and Escape closes the tooltip (WCAG 1.4.13). Nothing moves on its own.
 */
export default function ScoreTrend({
  series,
  from,
  to,
  bands,
}: {
  series: ScoreSeries[]
  from: number
  to: number
  bands: RiskMethod["bands"] | null
}) {
  // A band reaches up to where the next one starts, so the shading has no gaps
  const shaded = [...(bands ?? FALLBACK)]
    .sort((a, b) => a.from - b.from)
    .map((one, index, all) => ({
      band: one.band as RiskBand,
      from: index === 0 ? 0 : one.from,
      to: index === all.length - 1 ? 100 : all[index + 1].from,
    }))
  const [quiet, setQuiet] = useState(false)
  const rows = scoreRows(series, from, to)
  const config: ChartConfig = Object.fromEntries(
    series.map((one, index) => [`s${index}`, { label: one.target.name, color: SCORE_LINES[index].color }]),
  )
  // The end labels say where each line is now; two that would touch leave theirs to the legend.
  const placed: number[] = []
  const showEnd = series.map((one) => {
    const now = one.score ?? null
    if (now === null) return false
    const y = (1 - now / 100) * HEIGHT
    if (placed.some((other) => Math.abs(other - y) < LABEL_GAP)) return false
    placed.push(y)
    return true
  })
  const span = Math.max(1, to - from)
  const ticks = [0, 1, 2, 3].map((step) => from + (span * step) / 3)
  const summary = series
    .map((one) => `${one.target.name}: ${one.score ?? "no score"} ${one.band ? BAND_LABEL[one.band] : ""}`.trim())
    .join("; ")

  return (
    <div
      onKeyDown={(event) => event.key === "Escape" && setQuiet(true)}
      onPointerMove={() => quiet && setQuiet(false)}
      onFocus={() => quiet && setQuiet(false)}
    >
      <ChartContainer config={config} className={`aspect-auto h-[200px] w-full ${CHART_FOCUS}`}>
        <LineChart
          data={rows}
          margin={{ top: 8, right: RIGHT, bottom: 0, left: 0 }}
          accessibilityLayer
          title="Risk score over time"
          desc={`Risk scores across the period, now: ${summary}. The same numbers are in the table view.`}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {shaded.map((one) => (
            <ReferenceArea
              key={one.band}
              yAxisId="score"
              y1={one.from}
              y2={one.to}
              fill={FILL[one.band] ?? "var(--muted)"}
              fillOpacity={0.07}
              ifOverflow="hidden"
              label={(props: { viewBox?: { x?: number; y?: number; width?: number; height?: number } }) => {
                const box = props.viewBox ?? {}
                return (
                  <text
                    x={(box.x ?? 0) + (box.width ?? 0) + BAND_COLUMN}
                    y={(box.y ?? 0) + (box.height ?? 0) / 2 + 4}
                    className="fill-muted-foreground text-xs"
                  >
                    {BAND_LABEL[one.band]}
                  </text>
                )
              }}
            />
          ))}
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={[from, to]}
            ticks={ticks}
            tickFormatter={shortDate}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-strong)" }}
          />
          <YAxis
            yAxisId="score"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={30}
          />
          <Tooltip
            active={quiet ? false : undefined}
            cursor={{ stroke: "var(--border-strong)" }}
            content={<TrendTooltip series={series} />}
            isAnimationActive={false}
          />
          {series.map((one, index) => (
            <Line
              key={one.target.id}
              yAxisId="score"
              dataKey={`s${index}`}
              name={one.target.name}
              type="stepAfter"
              stroke={SCORE_LINES[index].color}
              strokeWidth={2}
              strokeDasharray={SCORE_LINES[index].dash}
              connectNulls={false}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number; payload?: Row }) =>
                props.payload?.[`s${index}_calculated`] && props.cx !== undefined && props.cy !== undefined ? (
                  <circle
                    key={`${index}-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill={SCORE_LINES[index].color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ) : (
                  <g key={`${index}-${props.index}`} />
                )
              }
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
              label={(props: { x?: number | string; y?: number | string; index?: number; value?: string | number | boolean | null }) =>
                showEnd[index] && props.index === rows.length - 1 && props.value != null ? (
                  <text
                    key={`end-${index}`}
                    x={Number(props.x) + 6}
                    y={Number(props.y) + 4}
                    className="fill-foreground text-xs font-semibold"
                  >
                    {props.value}
                  </text>
                ) : (
                  <g key={`end-${index}-${props.index}`} />
                )
              }
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  )
}
