"use client"

import { useState } from "react"

import { Gauge, ClassicPie, Donut, Isometric, Nested, Rings, Rose, Sunburst, type Branch, type Progress, type Slice } from "@/components/risk/radial/radial-charts"
import { ChartCard } from "@/components/sentra/chart-card"
import { SEVERITY_LABEL, type Severity } from "@/components/sentra/severity-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { FINDING_STATUS_LABEL, type FindingStatus } from "@/lib/findings"
import { CLOSED_STATUSES, COUNTED, OPEN_STATUSES, type RiskDashboard as Dashboard } from "@/lib/risk"

/** The eight styles, in the order of the picker. */
const STYLES = [
  { id: "pie", label: "Pie", read: "Each slice is a share of the open findings; a slice moves out when you point at it or tab to it. Select a slice to open its findings." },
  { id: "donut", label: "Donut", read: "Each part of the ring is a share of the open findings; the middle says the total or the part you are on. Select a part to open its findings." },
  { id: "tilted", label: "3D ring", read: "The same ring with depth, tilted. It is a way of looking, not more data: the legend and the table have the numbers. Select a part to open its findings." },
  { id: "gauge", label: "Gauge", read: "Half a ring for the same shares, for a place with little height. Select a part, or a name under it, to open its findings." },
  { id: "nested", label: "Two rings", read: "The outer ring is the open findings by severity, the inner ring the same findings by status. Select a part of either to open its findings." },
  { id: "rose", label: "Rose", read: "Every severity has the same angle, and each petal's area is proportional to its count, so a small count stays small but easy to select. Areas are hard to compare by eye: read the numbers too." },
  { id: "rings", label: "Rings", read: "Each ring is how much of its own whole a measure is; the line under its name says which whole. They are not parts of one total." },
  { id: "sunburst", label: "Sunburst", read: "The inner ring is the OWASP categories (the number in a part is the category's), the outer ring each one's severities. Press an inner part to zoom into its category; a part of the outer ring opens its findings." },
] as const
type StyleId = (typeof STYLES)[number]["id"]

const STORAGE = "sentra.dashboard.breakdown"
// Colours of what is not a severity are the series colours of globals.css: none is red, orange, amber
// or grey, which belong to the severities. A category keeps its colour whatever the filters leave.
const series = (n: number) => `var(--series-${((n - 1) % 8) + 1})`
const STATUS_COLOUR: Record<string, string> = {
  new: series(1),
  requires_confirmation: "var(--confirm)", // the product's own colour for "requires confirmation"
  confirmed: series(2),
  reopened: series(5),
}

const pct = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100))

/**
 * The Breakdown of the dashboard (FR-7.4 (M7), UC-7.3): the open findings in eight chart styles, one at a time, in the
 * product's one chart card, with its Chart and Table. Every number is one the dashboard already has
 * (the severities, the statuses, the categories, the queues); the style is a choice of the person's,
 * remembered on this browser. Nothing here replaces the trends, which are a different question.
 */
export function BreakdownCharts({ data, filterQuery, targetQuery }: { data: Dashboard; filterQuery: string; targetQuery: string }) {
  // The choice is a convenience of this browser; the page works without it. The panel only ever
  // renders after the dashboard's answer has come, in the browser, so reading it here is safe.
  const [style, setStyle] = useState<StyleId>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE)
      return STYLES.some((one) => one.id === saved) ? (saved as StyleId) : "donut"
    } catch {
      return "donut"
    }
  })
  const choose = (next: StyleId) => {
    setStyle(next)
    try {
      window.localStorage.setItem(STORAGE, next)
    } catch {}
  }

  const total = data.open_total
  const open = `/findings?view=open${filterQuery}`
  const severities: Slice[] = COUNTED.map((severity) => ({
    id: severity,
    label: SEVERITY_LABEL[severity as Severity],
    count: data.open_by_severity[severity] ?? 0,
    color: `var(--severity-${severity === "informational" ? "info" : severity})`,
    href: `${open}&severity=${severity}`,
    severity: severity as Severity,
  }))
  const statuses: Slice[] = OPEN_STATUSES.map((status) => ({
    id: status,
    label: FINDING_STATUS_LABEL[status as FindingStatus],
    count: data.by_status[status] ?? 0,
    color: STATUS_COLOUR[status],
    href: status === "requires_confirmation" ? `/findings?view=requires_confirmation${filterQuery}` : `/findings?view=open&status=${status}${filterQuery}`,
  }))
  const closedTotal = CLOSED_STATUSES.reduce((sum, status) => sum + (data.by_status[status] ?? 0), 0)
  const since = encodeURIComponent(data.changes.since)
  const rings: Progress[] = [
    { id: "triage", label: "Awaiting triage", count: data.awaiting_triage, of: total, base: `of the ${total} open`, color: series(1), href: `/findings?view=awaiting_triage${filterQuery}` },
    { id: "remediation", label: "Awaiting remediation", count: data.awaiting_remediation, of: total, base: `of the ${total} open`, color: series(2), href: `/findings?view=awaiting_remediation${filterQuery}` },
    {
      id: "fixed",
      label: "Fixed and verified",
      count: data.by_status.fixed_and_verified ?? 0,
      of: closedTotal,
      base: `of the ${closedTotal} closed in the last ${data.period_days} days`,
      color: series(4),
      href: `/findings?view=closed&status=fixed_and_verified&closed_from=${since}${filterQuery}`,
    },
  ]
  // The category the page is narrowed to is the only one it shows
  const rows = data.by_category.filter((row) => row.open_total > 0 && (!data.category || row.code === data.category))
  const branches: Branch[] = rows.map((row) => ({
    id: row.code,
    label: `${row.code}${row.name ? ` ${row.name}` : ""}`,
    total: row.open_total,
    color: series(Number(row.code.replace(/\D/g, "")) || 1),
    parts: COUNTED.map((severity) => ({
      id: severity,
      label: SEVERITY_LABEL[severity as Severity],
      count: row.open_by_severity[severity] ?? 0,
      color: `var(--severity-${severity === "informational" ? "info" : severity})`,
      href: "",
    })),
  }))
  const current = STYLES.find((one) => one.id === style)!
  const what = "open findings"

  const table =
    style === "rings" ? (
      <Table container={{ className: "rounded-[7px]" }}>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead className="text-xs">Measure</TableHead>
            <TableHead className="text-right text-xs">Findings</TableHead>
            <TableHead className="text-xs">Out of</TableHead>
            <TableHead className="text-right text-xs">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rings.map((ring) => (
            <TableRow key={ring.id}>
              <TableCell className="text-[13px]">{ring.label}</TableCell>
              <TableCell className="tabular text-right text-[13px]">{ring.count}</TableCell>
              <TableCell className="text-[13px] whitespace-normal">{ring.base}</TableCell>
              <TableCell className="tabular text-right text-[13px]">{pct(ring.count, ring.of)} %</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : style === "sunburst" ? (
      <Table container={{ className: "rounded-[7px]" }}>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead className="text-xs">Category</TableHead>
            <TableHead className="text-right text-xs">Open</TableHead>
            {COUNTED.map((severity) => (
              <TableHead key={severity} className="text-right text-xs">
                {SEVERITY_LABEL[severity as Severity]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((branch) => (
            <TableRow key={branch.id}>
              <TableCell className="text-[13px] whitespace-normal">{branch.label}</TableCell>
              <TableCell className="tabular text-right text-[13px] font-medium">{branch.total}</TableCell>
              {branch.parts.map((part) => (
                <TableCell key={part.id} className="tabular text-right text-[13px] text-text-secondary">
                  {part.count}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : (
      <div className="grid gap-3 @min-[40rem]/dash:grid-cols-2">
        <SliceTable caption="By severity" first="Severity" slices={severities} total={total} />
        {style === "nested" && <SliceTable caption="By status" first="Status" slices={statuses} total={total} />}
      </div>
    )

  return (
    <ChartCard
      title="Breakdown"
      unit={style === "rings" ? "Findings out of their own whole" : style === "sunburst" ? "Open findings by OWASP category and severity" : style === "nested" ? "Open findings by severity and by status" : "Open findings by severity"}
      howToRead={current.read}
      state={total === 0 ? "empty" : "ready"}
      emptyText="Nothing is open for these filters, so there is nothing to break down. Choose another target or category, or reset the filters."
      table={table}
    >
      <div className="mb-3">
        <ToggleGroup type="single" value={style} onValueChange={(next) => next && choose(next as StyleId)} variant="outline" aria-label="Chart style" className="flex flex-wrap">
          {STYLES.map((one) => (
            <ToggleGroupItem key={one.id} value={one.id} className="h-8 px-3 text-[13px]">
              {one.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {style === "pie" && <ClassicPie slices={severities} total={total} what={what} />}
      {style === "donut" && <Donut slices={severities} total={total} what={what} />}
      {style === "tilted" && <Isometric slices={severities} total={total} what={what} />}
      {style === "gauge" && <Gauge slices={severities} total={total} what={what} />}
      {style === "nested" && <Nested slices={severities} inner={statuses} total={total} what={what} />}
      {style === "rose" && <Rose slices={severities} total={total} what={what} />}
      {style === "rings" && <Rings rings={rings} />}
      {style === "sunburst" && (
        <Sunburst
          branches={branches}
          what={what}
          linkFor={(code, severity) => `/findings?view=open&category=${code}${severity ? `&severity=${severity}` : ""}${targetQuery}`}
        />
      )}
    </ChartCard>
  )
}

function SliceTable({ caption, first, slices, total }: { caption: string; first: string; slices: Slice[]; total: number }) {
  return (
    <Table container={{ className: "rounded-[7px]" }}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="text-xs">{first}</TableHead>
          <TableHead className="text-right text-xs">Open findings</TableHead>
          <TableHead className="text-right text-xs">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {slices.map((slice) => (
          <TableRow key={slice.id}>
            <TableCell className="text-[13px]">{slice.label}</TableCell>
            <TableCell className="tabular text-right text-[13px]">{slice.count}</TableCell>
            <TableCell className="tabular text-right text-[13px]">{pct(slice.count, total)} %</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="text-[13px] font-medium">All open findings</TableCell>
          <TableCell className="tabular text-right text-[13px] font-medium">{total}</TableCell>
          <TableCell className="tabular text-right text-[13px]">100 %</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
