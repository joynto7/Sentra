"use client"

import { useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"

import { ChartCard } from "@/components/sentra/chart-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FINDING_STATUS_LABEL, type FindingStatus } from "@/lib/findings"
import { type RiskDashboard } from "@/lib/risk"

type Leaf = { id: string; label: string; count: number; href: string; color: string }
type Group = { id: string; label: string; href: string; color: string; leaves: Leaf[] }

const NODE = 12
const ROW_GAP = 10
const MIN = 7
const FONT = 12

/**
 * Where the findings stand (UC-7.3 step 3): all the findings the page counts, split into those
 * awaiting triage, awaiting remediation and closed in the period, and each of those into its
 * statuses. It is the state now, not a flow over time, and the card says so. Point at, or tab to,
 * a node or a band to follow it; select one to open its findings.
 */
export function Flow({ data, filterQuery, className }: { data: RiskDashboard; filterQuery: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(520)
  const [active, setActive] = useState<string | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const read = () => setWidth(Math.max(280, Math.round(element.getBoundingClientRect().width)))
    read()
    const watch = new ResizeObserver(read)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])

  const count = (status: string) => data.by_status[status] ?? 0
  const since = encodeURIComponent(data.changes.since)
  const leaf = (status: FindingStatus, color: string, href: string): Leaf => ({
    id: status,
    label: FINDING_STATUS_LABEL[status],
    count: count(status),
    href,
    color,
  })
  const closedHref = (status: string) => `/findings?view=closed&status=${status}&closed_from=${since}${filterQuery}`
  const groups: Group[] = [
    {
      id: "triage",
      label: "Awaiting triage",
      href: `/findings?view=awaiting_triage${filterQuery}`,
      color: "var(--series-1)",
      leaves: [leaf("new", "var(--series-1)", `/findings?view=open&status=new${filterQuery}`), leaf("requires_confirmation", "var(--confirm)", `/findings?view=requires_confirmation${filterQuery}`)],
    },
    {
      id: "remediation",
      label: "Awaiting remediation",
      href: `/findings?view=awaiting_remediation${filterQuery}`,
      color: "var(--series-2)",
      leaves: [leaf("confirmed", "var(--series-2)", `/findings?view=open&status=confirmed${filterQuery}`), leaf("reopened", "var(--series-5)", `/findings?view=open&status=reopened${filterQuery}`)],
    },
    {
      id: "closed",
      label: `Closed in ${data.period_days} days`,
      href: `/findings?view=closed&closed_from=${since}${filterQuery}`,
      color: "var(--series-4)",
      leaves: [leaf("fixed_and_verified", "var(--series-4)", closedHref("fixed_and_verified")), leaf("false_positive", "var(--series-7)", closedHref("false_positive")), leaf("merged", "var(--series-8)", closedHref("merged"))],
    },
  ]
    .map((group) => ({ ...group, leaves: group.leaves.filter((one) => one.count > 0) }))
    .filter((group) => group.leaves.length > 0)
  const total = groups.reduce((sum, group) => sum + group.leaves.reduce((s, one) => s + one.count, 0), 0)
  const leaves = groups.flatMap((group) => group.leaves)

  // Layout: three columns of nodes, each as tall as its count, with a gap between neighbours
  const compact = width < 420
  const inner = Math.max(120, leaves.length * 30)
  const scale = (inner - ROW_GAP * (leaves.length - 1)) / Math.max(1, total)
  const height = (value: number) => Math.max(MIN, value * scale)
  const colX = [0, (width - NODE) * (compact ? 0.26 : 0.3), width - NODE - (compact ? 150 : 160)]
  let y = 0
  const placed = groups.map((group) => {
    const leafNodes = group.leaves.map((one) => {
      const node = { ...one, y, h: height(one.count) }
      y += node.h + ROW_GAP
      return node
    })
    const top = leafNodes[0].y
    const bottom = leafNodes[leafNodes.length - 1].y + leafNodes[leafNodes.length - 1].h
    const sum = group.leaves.reduce((s, one) => s + one.count, 0)
    const h = Math.min(bottom - top, height(sum))
    return { ...group, leafNodes, y: top + (bottom - top - h) / 2, h, sum }
  })
  const drawn = Math.max(y - ROW_GAP, 1)
  const rootH = Math.min(drawn, height(total) + ROW_GAP * (groups.length - 1))
  const rootY = (drawn - rootH) / 2

  const ribbon = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) => {
    const mid = (x0 + x1) / 2
    return `M${x0} ${y0} C${mid} ${y0},${mid} ${y1},${x1} ${y1} L${x1} ${y1 + h1} C${mid} ${y1 + h1},${mid} ${y0 + h0},${x0} ${y0 + h0} Z`
  }
  const dim = (...ids: string[]) => (active === null || ids.includes(active) ? 1 : 0.25)
  const note = active
    ? (() => {
        const group = groups.find((one) => one.id === active)
        if (group) return `${group.label}: ${group.leaves.reduce((s, one) => s + one.count, 0)} of ${total}`
        const one = leaves.find((l) => l.id === active)
        return one ? `${one.label}: ${one.count} of ${total}` : ""
      })()
    : `All ${total} findings the page counts`

  let rootOffset = 0
  return (
    <ChartCard
      className={className}
      title="Where the findings stand"
      unit={`${total} findings: open now, and closed in the last ${data.period_days} days`}
      howToRead="The state now, not a flow over time. Select a node to open its findings."
      state={total === 0 ? "empty" : "ready"}
      emptyText="No finding is open or closed in this period for these filters."
      table={
        <Table container={{ className: "rounded-[7px]" }}>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="text-xs">Group</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right text-xs">Findings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap((group) =>
              group.leaves.map((one) => (
                <TableRow key={one.id}>
                  <TableCell className="text-[13px]">{group.label}</TableCell>
                  <TableCell className="text-[13px]">{one.label}</TableCell>
                  <TableCell className="tabular text-right text-[13px]">{one.count}</TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      }
    >
      <p className="mb-2 text-[13px] font-medium" aria-live="polite">
        {note}
      </p>
      <div ref={box} className="w-full">
        <svg width={width} height={drawn + 4} role="group" aria-label={`The ${total} findings by what they wait for and by status`} className="block overflow-visible">
          {placed.map((group) => {
            const x0 = colX[0] + NODE
            const y0 = rootY + rootOffset
            const h0 = (group.sum / total) * rootH
            rootOffset += h0
            let leafOffset = 0
            return (
              <g key={group.id}>
                <path d={ribbon(x0, y0, h0, colX[1], group.y, group.h)} fill={group.color} opacity={0.22 * dim(group.id, ...group.leaves.map((l) => l.id))} />
                {group.leafNodes.map((one) => {
                  const part = (one.count / group.sum) * group.h
                  const from = group.y + leafOffset
                  leafOffset += part
                  return <path key={one.id} d={ribbon(colX[1] + NODE, from, part, colX[2], one.y, one.h)} fill={one.color} opacity={0.28 * dim(group.id, one.id)} />
                })}
              </g>
            )
          })}
          <rect x={colX[0]} y={rootY} width={NODE} height={rootH} rx="3" fill="var(--foreground)" opacity="0.75" />
          <text x={colX[0] + NODE + 6} y={rootY + 14} className="fill-foreground font-medium" fontSize={FONT} style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>
            All findings
          </text>
          <text x={colX[0] + NODE + 6} y={rootY + 29} className="tabular fill-text-secondary" fontSize={FONT} style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>
            {total}
          </text>
          {placed.map((group) => (
            <g key={group.id}>
              <Link
                href={group.href}
                aria-label={`${group.label}: ${group.sum} of ${total} findings. Open them.`}
                onMouseEnter={() => setActive(group.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(group.id)}
                onBlur={() => setActive(null)}
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
              >
                <rect x={colX[1]} y={group.y} width={NODE} height={group.h} rx="3" fill={group.color} />
                <rect x={colX[1] - 4} y={group.y - 4} width={NODE + 8} height={group.h + 8} fill="transparent" />
                <text x={colX[1] + NODE + 6} y={group.y + group.h / 2 - 2} fontSize={FONT} className="fill-foreground font-medium" style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>
                  {group.label.replace(`Closed in ${data.period_days} days`, "Closed")}
                </text>
                <text x={colX[1] + NODE + 6} y={group.y + group.h / 2 + 12} fontSize={FONT} className="tabular fill-text-secondary" style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>
                  {group.sum}
                </text>
              </Link>
              {group.leafNodes.map((one) => (
                <Link
                  key={one.id}
                  href={one.href}
                  aria-label={`${one.label}: ${one.count} of ${total} findings. Open them.`}
                  onMouseEnter={() => setActive(one.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(one.id)}
                  onBlur={() => setActive(null)}
                  className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
                >
                  <rect x={colX[2]} y={one.y} width={NODE} height={one.h} rx="3" fill={one.color} />
                  <rect x={colX[2] - 4} y={one.y - 4} width={width - colX[2] + 4} height={Math.max(one.h, 26) + 8} fill="transparent" />
                  <text x={colX[2] + NODE + 8} y={one.y + Math.max(one.h, 20) / 2 - 1} fontSize={FONT} className="fill-foreground" dominantBaseline="middle">
                    {one.label}
                    <tspan className="tabular fill-text-secondary font-medium"> · {one.count}</tspan>
                  </text>
                </Link>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </ChartCard>
  )
}
