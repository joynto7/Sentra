"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { ChartCard } from "@/components/sentra/chart-card"
import { SEVERITY_LABEL } from "@/components/sentra/severity-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BAND_LABEL, type CategoryRow, type RiskBand, type RiskDashboard, type RiskMethod, getRiskMethod } from "@/lib/risk"
import { cn } from "@/lib/utils"

const SIZE = 300
const MID = SIZE / 2
const REACH = 96 // the outer ring
const LABEL = 118

const BAND_COLOUR: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
}

const point = (index: number, count: number, radius: number) => {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return { x: MID + Math.cos(angle) * radius, y: MID + Math.sin(angle) * radius, angle }
}

/** The radar: one axis per OWASP category in scope, as far out as it has open findings, on one scale. */
function Radar({ rows, chosen, targetQuery, onActive, active }: { rows: CategoryRow[]; chosen: string | null; targetQuery: string; onActive: (code: string | null) => void; active: string | null }) {
  const most = Math.max(1, ...rows.map((row) => row.open_total))
  const corners = rows.map((row, index) => point(index, rows.length, (row.open_total / most) * REACH))
  const shape = corners.map((corner, index) => `${index === 0 ? "M" : "L"}${corner.x.toFixed(1)} ${corner.y.toFixed(1)}`).join(" ") + " Z"
  const ring = (share: number) =>
    rows.map((_, index) => point(index, rows.length, REACH * share)).map((corner, index) => `${index === 0 ? "M" : "L"}${corner.x.toFixed(1)} ${corner.y.toFixed(1)}`).join(" ") + " Z"
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[320px] overflow-visible" role="group" aria-label={`Radar of the open findings in ${rows.length} OWASP categories, on one scale up to ${most}`}>
      {[0.25, 0.5, 0.75, 1].map((share) => (
        <path key={share} d={ring(share)} fill="none" stroke="var(--border)" strokeWidth="1" />
      ))}
      {rows.map((row, index) => {
        const end = point(index, rows.length, REACH)
        return <line key={row.code} x1={MID} y1={MID} x2={end.x} y2={end.y} stroke="var(--border)" strokeWidth="1" />
      })}
      <path d={shape} fill="var(--primary)" fillOpacity="0.16" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
      {rows.map((row, index) => {
        const corner = corners[index]
        const label = point(index, rows.length, LABEL)
        const here = active === row.code
        const anchor = Math.abs(Math.cos(label.angle)) < 0.2 ? "middle" : Math.cos(label.angle) > 0 ? "start" : "end"
        return (
          <Link
            key={row.code}
            href={`/findings?view=open&category=${row.code}${targetQuery}`}
            aria-label={`${row.code}${row.name ? ` ${row.name}` : ""}: ${row.open_total} open findings. Open them.`}
            onMouseEnter={() => onActive(row.code)}
            onMouseLeave={() => onActive(null)}
            onFocus={() => onActive(row.code)}
            onBlur={() => onActive(null)}
            className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
          >
            <circle cx={label.x} cy={label.y} r="22" fill="transparent" />
            <circle className="ring" cx={corner.x} cy={corner.y} r={here ? 7 : 5} fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
            <text
              x={label.x}
              y={label.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              className={cn("text-[11px] font-medium", here || chosen === row.code ? "fill-foreground" : "fill-text-secondary")}
              style={{ textDecoration: chosen === row.code ? "underline" : undefined }}
            >
              {row.code}
            </text>
          </Link>
        )
      })}
    </svg>
  )
}

/** 0 to 100 in the product's bands, with a mark for each target's score: each mark opens the target. */
function Scale({ data, bands }: { data: RiskDashboard; bands: RiskMethod["bands"] | null }) {
  const scored = data.targets.filter((row) => row.score !== null)
  return (
    <div className="mt-3">
      <div className="relative h-2.5 rounded-full bg-muted">
        {bands?.map((band) =>
          BAND_COLOUR[band.band] ? (
            <span
              key={band.band}
              aria-hidden="true"
              className="absolute inset-y-0 first:rounded-l-full last:rounded-r-full"
              style={{ left: `${band.from}%`, width: `${band.to - band.from + 1}%`, background: BAND_COLOUR[band.band], opacity: 0.85 }}
            />
          ) : null,
        )}
        {scored.map((row) => (
          <span
            key={row.id}
            aria-hidden="true"
            title={`${row.name}: ${row.score}`}
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow-sm"
            style={{ left: `${row.score}%` }}
          />
        ))}
      </div>
      <div className="tabular mt-1 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
      <ul className="mt-2">
        {[...scored]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 4)
          .map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 border-t py-0.5 text-[13px] first:border-t-0">
              <Link href={`/targets/${row.id}`} className="inline-flex min-h-6 min-w-0 items-center text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <span className="truncate">{row.name}</span>
              </Link>
              <span className="tabular shrink-0 font-medium">{row.score}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}

const days = (value: number) => `${value} ${value === 1 ? "day" : "days"}`

/**
 * The risk posture (FR-7.4 (M7), UC-7.3): where the open findings sit across the OWASP categories,
 * where every target's risk score sits in the product's bands, and what the period's history says
 * in plain sentences. Nothing is forecast; every sentence is arithmetic on numbers the page shows.
 */
export function Posture({ data, targetQuery, className }: { data: RiskDashboard; targetQuery: string; className?: string }) {
  const [method, setMethod] = useState<RiskMethod | null>(null)
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getRiskMethod(controller.signal)
      .then(setMethod)
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  const rows = data.by_category.filter((row) => row.status !== "out_of_scope" || row.open_total > 0)
  const scored = data.targets.filter((row) => row.score !== null)
  const worst = scored.reduce<(typeof scored)[number] | null>((top, row) => (top === null || (row.score ?? 0) > (top.score ?? 0) ? row : top), null)
  const bars = data.trends.buckets
  const came = bars.reduce((sum, bar) => sum + bar.new, 0)
  const went = bars.reduce((sum, bar) => sum + bar.closed, 0)
  const since = new Date(data.changes.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const overview = data.overview
  const on = rows.find((row) => row.code === active)
  const figures = [
    { label: `New since ${since}`, value: String(came) },
    { label: "Closed", value: String(went) },
    { label: "Time to confirm", value: overview.days_to_confirm !== null ? days(overview.days_to_confirm) : "none yet" },
    { label: "Time to fix", value: overview.days_to_fix !== null ? days(overview.days_to_fix) : "none yet" },
  ]
  return (
    <ChartCard
      className={className}
      title="Risk posture"
      unit="Open findings by OWASP category, and risk scores"
      howToRead="Select a point or a target to open it."
      state={data.open_total === 0 && scored.length === 0 ? "empty" : "ready"}
      emptyText="Nothing is open and no target is scored yet for these filters."
      table={
        <div className="grid gap-3">
          <Table container={{ className: "rounded-[7px]" }}>
            <caption className="sr-only">Open findings by OWASP category</caption>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-right text-xs">Open findings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="text-[13px] whitespace-normal">{row.code}{row.name ? ` ${row.name}` : ""}</TableCell>
                  <TableCell className="tabular text-right text-[13px]">{row.open_total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table container={{ className: "rounded-[7px]" }}>
            <caption className="sr-only">Risk score of every scored target</caption>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="text-xs">Target</TableHead>
                <TableHead className="text-right text-xs">Risk score</TableHead>
                <TableHead className="text-xs">Band</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scored.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-[13px] whitespace-normal">{row.name}</TableCell>
                  <TableCell className="tabular text-right text-[13px]">{row.score}</TableCell>
                  <TableCell className="text-[13px]">{row.band ? BAND_LABEL[row.band as RiskBand] : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      }
    >
      <div className="grid items-start gap-5 @min-[34rem]/chart:grid-cols-2">
        <div>
          {rows.length >= 3 ? (
            <Radar rows={rows} chosen={data.category} targetQuery={targetQuery} active={active} onActive={setActive} />
          ) : (
            <p className="py-6 text-sm text-muted-foreground">Fewer than three OWASP categories are in scope, so there is no radar to draw. The table has the numbers.</p>
          )}
          <p className="mt-2 min-h-5 text-center text-[13px] text-text-secondary" aria-live="polite">
            {on ? (
              <>
                <span className="font-medium text-foreground">{on.code}{on.name ? ` ${on.name}` : ""}</span> · {on.open_total} open
                {(["critical", "high"] as const).map((severity) => ((on.open_by_severity[severity] ?? 0) > 0 ? `, ${on.open_by_severity[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}` : ""))}
              </>
            ) : (
              ""
            )}
          </p>
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-muted-foreground">Highest risk score</h3>
          {worst ? (
            <>
              <p className="mt-0.5 flex items-baseline gap-2">
                <span className="tabular text-4xl font-semibold tracking-tight">{worst.score}</span>
                <span className="text-lg text-muted-foreground">/ 100</span>
                <span className="text-[13px] font-medium">{worst.band ? BAND_LABEL[worst.band as RiskBand] : ""}</span>
              </p>
              <Scale data={data} bands={method?.bands ?? null} />
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No target has a risk score yet.</p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2">
            {figures.map((one) => (
              <div key={one.label} className="rounded-[8px] bg-muted/60 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{one.label}</dt>
                <dd className="tabular text-[15px] font-semibold">{one.value}</dd>
              </div>
            ))}
          </dl>
          {data.category_filtered && <p className="mt-2 text-xs text-muted-foreground">Scores ignore the chosen category.</p>}
        </div>
      </div>
    </ChartCard>
  )
}
