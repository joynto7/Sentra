"use client"

import { useRouter } from "next/navigation"
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts"

import { ActiveReporter, CHART_FOCUS, FLOW, flowHref } from "@/components/risk/chart-series"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import type { TrendBucket } from "@/lib/risk"

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

/**
 * "New and closed findings" (Screen 42; UC-7.3 step 5): per part of the period, the findings that
 * were first seen and the ones that were closed, with the number on every bar as the screen asks.
 * The bars are thin and grow from one baseline. Point at a part, or focus the chart and use the
 * arrow keys, and the legend under it shows that part's numbers as links (`onActive`); a click on
 * a bar opens its findings (UC-7.3 step 6).
 */
export default function FindingsFlow({
  buckets,
  filterQuery,
  onActive,
}: {
  buckets: TrendBucket[]
  filterQuery: string
  onActive: (bucket: TrendBucket) => void
}) {
  const router = useRouter()
  const config: ChartConfig = { new: FLOW.new, closed: FLOW.closed }
  const rows = buckets.map((bucket) => ({ ...bucket, label: shortDate(bucket.starts_at) }))
  const summary = buckets.map((b) => `${shortDate(b.starts_at)}: ${b.new} new, ${b.closed} closed`).join("; ")
  return (
    <ChartContainer config={config} className={`aspect-auto h-[200px] w-full ${CHART_FOCUS}`}>
      <BarChart
        data={rows}
        margin={{ top: 20, right: 4, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="22%"
        accessibilityLayer
        title="New and closed findings"
        desc={`Findings first seen and closed per part of the period: ${summary}. The arrow keys move from one part to the next, and the legend below gives its numbers. The same numbers are in the table view.`}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          content={<ActiveReporter<TrendBucket> onActive={onActive} />}
          isAnimationActive={false}
        />
        {(["new", "closed"] as const).map((key) => (
          <Bar
            key={key}
            dataKey={key}
            name={FLOW[key].label}
            fill={FLOW[key].color}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            cursor="pointer"
            // A bar opens its findings (UC-7.3 step 6); the legend and the table view have the same as links
            onClick={(entry: { payload?: TrendBucket }) => entry.payload && router.push(flowHref(entry.payload, key, filterQuery))}
          >
            <LabelList dataKey={key} position="top" offset={4} className="fill-foreground text-xs" />
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}
