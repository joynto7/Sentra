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
