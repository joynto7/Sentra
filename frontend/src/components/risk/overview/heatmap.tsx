"use client"

import { useRef, useState } from "react"
import Link from "next/link"

import { ChartCard } from "@/components/sentra/chart-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { type HeatCell, type RiskDashboard } from "@/lib/risk"
import { cn } from "@/lib/utils"

type Measure = "new" | "closed" | "net"
const MEASURES: { id: Measure; label: string; read: string }[] = [
  { id: "new", label: "New", read: "Findings first seen in that part of the period. Darker is more." },
  { id: "closed", label: "Closed", read: "Findings closed in that part of the period, fixed, false positive or merged. Darker is more." },
  { id: "net", label: "Net", read: "New minus closed. Red with a plus: more came than closed. Green with a minus: more closed than came." },
]
const STORAGE = "sentra.dashboard.heatmap"

const short = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const value = (cell: HeatCell, measure: Measure) => (measure === "new" ? cell.new : measure === "closed" ? cell.closed : cell.new - cell.closed)
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0")

function paint(n: number, measure: Measure, most: number): { background?: string; color?: string } {
  if (n === 0) return {}
  const share = Math.abs(n) / Math.max(1, most)
  const hue = measure === "new" ? "var(--primary)" : measure === "closed" ? "var(--success)" : n > 0 ? "var(--destructive)" : "var(--success)"
  // A tint of the hue over the card, never more than 45 %, so the number in it keeps its contrast
  // with the same ink in both themes (WCAG 1.4.3)
  const strength = Math.round(10 + 35 * share)
  return { background: `color-mix(in oklab, ${hue} ${strength}%, var(--card))`, color: "var(--foreground)" }
}

/**
 * Which target had how many findings come and go in which part of the period (FR-7.4 (M7),
 * UC-7.3 step 5): one row per target, one column per twelfth of the period, one of three measures.
 * Every cell with a number opens the findings it counts, with the target and the dates. Counted
 * from the findings' own dates; nothing is estimated.
 */
export function Heatmap({ data, className }: { data: RiskDashboard; className?: string }) {
  const [measure, setMeasure] = useState<Measure>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE)
      return MEASURES.some((one) => one.id === saved) ? (saved as Measure) : "new"
    } catch {
      return "new"
    }
  })
  const choose = (next: Measure) => {
    setMeasure(next)
    try {
      window.localStorage.setItem(STORAGE, next)
    } catch {}
  }
  const wrap = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ row: number; column: number; left: number; top: number } | null>(null)
  const { rows, columns } = data.overview
  const most = Math.max(1, ...rows.flatMap((row) => row.cells.map((cell) => Math.abs(value(cell, measure)))))
  const category = data.category ? `&category=${data.category}` : ""
  const everything = rows.flatMap((row) => row.cells)
  const empty = everything.every((cell) => cell.new === 0 && cell.closed === 0)
  const current = MEASURES.find((one) => one.id === measure)!
  const range = (column: number) => `${short(columns[column].starts_at)} to ${short(columns[column].ends_at)}`
  const hrefFor = (row: number, column: number) => {
    const part = columns[column]
    const target = `&target_id=${rows[row].target.id}${category}`
    return measure === "closed"
      ? `/findings?view=closed&closed_from=${encodeURIComponent(part.starts_at)}&closed_until=${encodeURIComponent(part.ends_at)}${target}`
      : `/findings?view=all&first_seen_from=${encodeURIComponent(part.starts_at)}&first_seen_until=${encodeURIComponent(part.ends_at)}${target}`
  }
  const show = (row: number, column: number, element: HTMLElement) => {
    const frame = wrap.current
    if (!frame) return
    const a = element.getBoundingClientRect()
    const b = frame.getBoundingClientRect()
    setTip({ row, column, left: Math.min(Math.max(a.left - b.left + a.width / 2, 110), b.width - 110), top: a.top - b.top })
  }
  return (
    <ChartCard
      className={className}
      title="Findings by target over time"
      unit={`Each column is a twelfth of the last ${data.period_days} days`}
      howToRead={`${current.read} Select a cell to open its findings.`}
      state={rows.length === 0 || empty ? "empty" : "ready"}
      emptyText={rows.length === 0 ? "No target to show for these filters." : "No finding came or closed in this period for these filters."}
      table={
        <Table container={{ tabIndex: 0, role: "group", "aria-label": "Findings by target over time, as a table", className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" }}>
          <caption className="caption-bottom px-3 py-2 text-left text-xs text-muted-foreground">Each cell is new / closed, from the date in the column up to the next.</caption>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead scope="col" className="text-xs">Target</TableHead>
              {columns.map((column) => (
                <TableHead key={column.starts_at} scope="col" className="text-right text-xs whitespace-nowrap">
                  {short(column.starts_at)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.target.id}>
                <TableCell className="text-[13px] whitespace-normal">{row.target.name}</TableCell>
                {row.cells.map((cell, column) => (
                  <TableCell key={column} className="tabular text-right text-[13px] whitespace-nowrap">
                    {cell.new} / {cell.closed}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <div className="mb-3">
        <ToggleGroup type="single" value={measure} onValueChange={(next) => next && choose(next as Measure)} variant="outline" aria-label="Measure of the heatmap" className="flex flex-wrap">
          {MEASURES.map((one) => (
            <ToggleGroupItem key={one.id} value={one.id} className="h-8 px-3 text-[13px]">
              {one.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div ref={wrap} className="relative" onPointerLeave={() => setTip(null)}>
        <div className="grid grid-cols-[repeat(12,minmax(0,1fr))] items-center gap-x-0.5 gap-y-1 @min-[40rem]/chart:grid-cols-[minmax(6.5rem,11rem)_repeat(12,minmax(0,1fr))] @min-[40rem]/chart:gap-x-1" role="group" aria-label={`${current.label} findings by target, in ${columns.length} parts of the period`}>
          <span aria-hidden="true" className="hidden @min-[40rem]/chart:block" />
          {columns.map((column, index) => (
            <span key={column.starts_at} className="tabular justify-self-start text-[11px] whitespace-nowrap text-muted-foreground" aria-hidden="true">
              {index % 3 === 0 ? short(column.starts_at) : ""}
            </span>
          ))}
          {rows.map((row, r) => (
            <div key={row.target.id} className="contents">
              <Link href={`/targets/${row.target.id}`} title={row.target.name} className="col-span-full mt-1 truncate rounded-[4px] py-1 pr-2 text-[13px] text-link @min-[40rem]/chart:col-span-1 @min-[40rem]/chart:mt-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {row.target.name}
              </Link>
              {row.cells.map((cell, column) => {
                const n = value(cell, measure)
                const style = paint(n, measure, most)
                const spoken = `${row.target.name}, ${range(column)}: ${cell.new} new, ${cell.closed} closed, net ${signed(cell.new - cell.closed)}.`
                const face = (
                  <span className="tabular text-[11px] font-medium" aria-hidden="true">
                    {n === 0 ? "" : measure === "net" ? signed(n) : n}
                  </span>
                )
                const base = "grid h-8 min-w-0 place-items-center rounded-[5px] bg-muted/60"
                const opened = measure === "closed" ? cell.closed : cell.new
                return opened > 0 ? (
                  <Link
                    key={column}
                    href={hrefFor(r, column)}
                    aria-label={`${spoken} Open the ${opened} ${measure === "closed" ? "closed" : "new"} findings.`}
                    style={style}
                    onPointerEnter={(event) => show(r, column, event.currentTarget)}
                    onFocus={(event) => show(r, column, event.currentTarget)}
                    onBlur={() => setTip(null)}
                    className={cn(base, "outline-offset-2 hover:ring-2 hover:ring-foreground/40 focus-visible:outline-2 focus-visible:outline-ring")}
                  >
                    {face}
                  </Link>
                ) : (
                  <span key={column} className={base} style={style} role="img" aria-label={spoken}>
                    {face}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
        {tip && (
          <div role="status" className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-full rounded-[8px] border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md" style={{ left: tip.left, top: tip.top - 6 }}>
            <p className="font-semibold">{rows[tip.row].target.name}</p>
            <p className="text-muted-foreground">{range(tip.column)}</p>
            <p className="tabular mt-1">
              {rows[tip.row].cells[tip.column].new} new · {rows[tip.row].cells[tip.column].closed} closed · net {signed(rows[tip.row].cells[tip.column].new - rows[tip.row].cells[tip.column].closed)}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
        <span>{measure === "net" ? "More closed" : "Fewer"}</span>
        <span
          className="h-2 w-28 rounded-full"
          style={{
            background:
              measure === "net"
                ? "linear-gradient(90deg, color-mix(in oklab, var(--success) 45%, var(--card)), var(--muted), color-mix(in oklab, var(--destructive) 45%, var(--card)))"
                : `linear-gradient(90deg, color-mix(in oklab, ${measure === "new" ? "var(--primary)" : "var(--success)"} 10%, var(--card)), color-mix(in oklab, ${measure === "new" ? "var(--primary)" : "var(--success)"} 45%, var(--card)))`,
          }}
        />
        <span>{measure === "net" ? "More new" : `More (up to ${most})`}</span>
      </div>
    </ChartCard>
  )
}
