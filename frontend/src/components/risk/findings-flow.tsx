"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts"

import { FLOW } from "@/components/risk/chart-series"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import type { TrendBucket } from "@/lib/risk"

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

function FlowTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number; payload?: TrendBucket }[]
}) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-medium">
        {shortDate(bucket.starts_at)} – {shortDate(bucket.ends_at)}
      </p>
      <ul className="space-y-1">
        {(["new", "closed"] as const).map((key) => (
          <li key={key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-[2px]" style={{ background: FLOW[key].color }} aria-hidden="true" />
            <span className="tabular font-semibold">{bucket[key]}</span>
            <span className="text-muted-foreground">{FLOW[key].label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "New and closed findings" (Screen 42; UC-7.3 step 5): per part of the period, the findings that
 * were first seen and the ones that were closed, with the number on every bar as the screen asks.
 * The bars are thin and grow from one baseline; the keyboard reaches every part of the period
 * through the chart's focus and the arrow keys, and Escape closes the tooltip (WCAG 1.4.13).
 */
export default function FindingsFlow({ buckets }: { buckets: TrendBucket[] }) {
  const [quiet, setQuiet] = useState(false)
  const config: ChartConfig = { new: FLOW.new, closed: FLOW.closed }
  const rows = buckets.map((bucket) => ({ ...bucket, label: shortDate(bucket.starts_at) }))
  const summary = buckets.map((b) => `${shortDate(b.starts_at)}: ${b.new} new, ${b.closed} closed`).join("; ")
  return (
    <div
      onKeyDown={(event) => event.key === "Escape" && setQuiet(true)}
      onPointerMove={() => quiet && setQuiet(false)}
      onFocus={() => quiet && setQuiet(false)}
    >
      <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
        <BarChart
          data={rows}
          margin={{ top: 20, right: 4, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="22%"
          accessibilityLayer
          title="New and closed findings"
          desc={`Findings first seen and closed per part of the period: ${summary}. The same numbers are in the table view.`}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
          <Tooltip
            active={quiet ? false : undefined}
            cursor={{ fill: "var(--muted)" }}
            content={<FlowTooltip />}
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
            >
              <LabelList dataKey={key} position="top" offset={4} className="fill-foreground text-xs" />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  )
}
