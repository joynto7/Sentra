import type { TrendBucket } from "@/lib/risk"

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
