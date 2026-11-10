import { useEffect } from "react"

import type { ScoreSeries, TrendBucket } from "@/lib/risk"

/**
 * The series of the dashboard's charts, kept apart from the charts themselves so a page can name
 * them (legends, tables) without loading the charting library. One colour per data set across
 * Sentra, each at least 3:1 on the card in both themes (WCAG 1.4.11).
 */

/** The three lines of "Risk score over time": colour and pattern together, never colour alone
 * (WCAG 1.4.1). The first chart colour and two neutral inks, as the design draws them. */
export const SCORE_LINES = [
  { color: "var(--chart-1)", dash: undefined, pattern: "solid" },
  { color: "var(--foreground)", dash: "6 4", pattern: "dashed" },
  { color: "var(--muted-foreground)", dash: "2 3", pattern: "dotted" },
] as const

/** Findings coming and going, wherever Sentra counts them. */
export const FLOW = {
  new: { label: "New", color: "var(--chart-1)" },
  closed: { label: "Closed", color: "var(--chart-2)" },
} as const

/** The findings behind a bar of "New and closed findings": those first seen in its part of the
 * period, or closed in it, with the dashboard's own filters. */
export function flowHref(bucket: TrendBucket, key: "new" | "closed", filterQuery: string): string {
  const from = encodeURIComponent(bucket.starts_at)
  const until = encodeURIComponent(bucket.ends_at)
  return key === "new"
    ? `/findings?view=all&first_seen_from=${from}&first_seen_until=${until}${filterQuery}`
    : `/findings?view=closed&closed_from=${from}&closed_until=${until}${filterQuery}`
}

/** The keyboard reaches a chart; this shows where it is (WCAG 2.4.7). shadcn's wrapper hides the
 * outline of the drawing, so the frame gets it back while it has the focus. */
export const CHART_FOCUS =
  "[&_.recharts-surface:focus-visible]:outline-solid [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-ring"

/** One row of "Risk score over time" per moment a score was calculated, from the start of the
 * period to now. A score holds until it is calculated again, so each line is a step line through
 * real calculations: nothing is interpolated. The last calculation before the period is where a
 * line starts. `s0` is the first line's score at that moment, `s0_band` its band and
 * `s0_calculated` whether a calculation happened right then. */
export type ScoreRow = { at: number } & Record<string, number | string | boolean | null>

const time = (iso: string) => new Date(iso).getTime()

export function scoreRows(series: ScoreSeries[], from: number, to: number): ScoreRow[] {
  const moments = new Set<number>([from, to])
  for (const one of series) for (const point of one.points) moments.add(Math.max(from, time(point.at)))
  return [...moments]
    .sort((a, b) => a - b)
    .map((at) => {
      const row: ScoreRow = { at }
      series.forEach((one, index) => {
        const reached = one.points.filter((point) => Math.max(from, time(point.at)) <= at)
        const last = reached[reached.length - 1]
        row[`s${index}`] = last ? last.score : null
        row[`s${index}_band`] = last ? last.band : null
        row[`s${index}_calculated`] = one.points.some((point) => !point.before_period && time(point.at) === at)
      })
      return row
    })
}

/**
 * Takes the place of a floating tooltip: it draws nothing, and only tells the page which data
 * point the pointer or the arrow keys are on. The page shows that point's values in the legend
 * under the chart, where they stay until Escape or "Back to now". So the values can be hovered,
 * stay put and can be dismissed (WCAG 1.4.13), and nothing covers the chart.
 */
export function ActiveReporter<T>({
  active,
  payload,
  onActive,
}: {
  active?: boolean
  payload?: { payload?: T }[]
  onActive: (row: T) => void
}) {
  const row = active ? payload?.[0]?.payload : undefined
  useEffect(() => {
    if (row) onActive(row)
  }, [row, onActive])
  return null
}
