"use client"

import { useId, useState } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

/** What a chart can show: its data, nothing at all, or too little to draw a trend from. */
export type ChartState = "ready" | "empty" | "too-little"

/**
 * The one card every chart of Sentra sits in, so all of them read the same way: a title, the unit
 * of what is drawn, a switch between the chart and a table with the same numbers, a sentence that
 * says how to read it, and an honest sentence instead of an empty plot. The table is the chart's
 * equivalent for keyboard and screen-reader users and for anybody who wants the exact numbers
 * (WCAG 1.1.1, 1.4.1), so it is never hidden behind a hover.
 *
 * The chart itself is passed in, so a page loads the charting library only where it draws one.
 */
export function ChartCard({
  title,
  unit,
  howToRead,
  state = "ready",
  emptyText,
  tooLittleText,
  table,
  legend,
  children,
  className,
}: {
  title: string
  /** What the axis measures, in words: "Risk score, 0 to 100" */
  unit: string
  /** One sentence under the chart: what a mark means and what to look for */
  howToRead?: React.ReactNode
  state?: ChartState
  emptyText?: string
  /** Shown instead of a chart that would be a single dot, with the table under it */
  tooLittleText?: string
  table: React.ReactNode
  legend?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const id = useId()
  const [view, setView] = useState<"chart" | "table">("chart")
  return (
    <section aria-labelledby={`${id}-title`} className={cn("@container/chart flex min-w-0 flex-col rounded-[10px] border bg-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold">
            {title}
          </h2>
          <p className="text-[13px] text-muted-foreground">{unit}</p>
        </div>
        {state === "ready" && (
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(next) => next && setView(next as "chart" | "table")}
            variant="outline"
            aria-label={`Show ${title.toLowerCase()} as`}
          >
            <ToggleGroupItem value="chart" className="h-8 px-3 text-[13px]">
              Chart
            </ToggleGroupItem>
            <ToggleGroupItem value="table" className="h-8 px-3 text-[13px]">
              Table
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      <div className="flex flex-1 flex-col px-4 pt-3 pb-4">
        {state === "empty" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : state === "too-little" ? (
          <>
            <p className="pt-4 pb-3 text-sm font-medium">{tooLittleText}</p>
            {table}
          </>
        ) : view === "table" ? (
          table
        ) : (
          <>
            {children}
            {legend}
          </>
        )}
        {state === "ready" && howToRead && <p className="mt-3 text-[13px] text-text-secondary">{howToRead}</p>}
      </div>
    </section>
  )
}
