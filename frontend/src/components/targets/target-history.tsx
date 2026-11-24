"use client"

import Link from "next/link"
import { useCallback, useEffect, useId, useState } from "react"
import {
  Archive,
  CircleDot,
  Rocket,
  RotateCcw,
  Settings2,
  Shield,
  ShieldCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react"

import { SeverityShape } from "@/components/sentra/severity-badge"
import { SEVERITY_LABEL, type Severity } from "@/components/sentra/severity-badge"
import { TargetMark } from "@/components/sentra/target-picker"
import { EndpointChip } from "@/components/targets/endpoint-chip"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { TargetTabs } from "@/components/targets/target-tabs"
import { BAND_LABEL, COUNTED, type RiskBand } from "@/lib/risk"
import { cn } from "@/lib/utils"
import {
  HISTORY_KIND_LABEL,
  HISTORY_PERIODS,
  type HistoryEvent,
  type HistoryScore,
  type Target,
  type TargetHistory as History,
  formatDate,
  formatDateTime,
  getTarget,
  getTargetHistory,
} from "@/lib/targets"

/** A card of the page: a section with its own heading, so it can be reached and read as one. */
function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="min-w-0 text-[14.5px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const WIDTH = 760
const LINE_TOP = 12
const LINE_BOTTOM = 150
const BARS_TOP = 168
const BARS_BOTTOM = 226
const HEIGHT = 248
const PAD_LEFT = 34
const PAD_RIGHT = 92
// A severity is told apart by its pattern, not by its colour alone (NFR-4.3, WCAG 1.4.1).
const FILLS: Record<string, string> = {
  critical: "url(#sentra-hatch)",
  high: "url(#sentra-dots)",
  medium: "var(--muted-foreground)",
  low: "var(--border)",
  informational: "var(--card)", // an outline without a fill
}
const BANDS: { band: RiskBand; from: number }[] = [
  { band: "critical", from: 75 },
  { band: "high", from: 50 },
  { band: "medium", from: 25 },
  { band: "low", from: 1 },
]

/** UC-2.7 step 3: how the risk score and the open findings developed after each campaign run. Each point is a button: pointing at it or focusing it reads it out. */
function ScoreChart({ scores }: { scores: HistoryScore[] }) {
  const titleId = useId()
  const [at, setAt] = useState<number | null>(null)
  const columns = Math.max(scores.length, 2)
  const step = (WIDTH - PAD_LEFT - PAD_RIGHT) / Math.max(1, columns - 1)
  const x = (index: number) => PAD_LEFT + index * step
  const y = (score: number) => LINE_TOP + (1 - score / 100) * (LINE_BOTTOM - LINE_TOP)
  const tallest = Math.max(1, ...scores.map((one) => one.open_total))
  const barWidth = Math.min(26, step * 0.5)
  const picked = at !== null ? scores[at] : null
  const length = scores.reduce(
    (sum, one, index) => (index === 0 ? 0 : sum + Math.hypot(x(index) - x(index - 1), y(one.score) - y(scores[index - 1].score))),
    0,
  )
  return (
    <div className="relative">
      <style>{`@keyframes th-draw { from { stroke-dashoffset: var(--len) } to { stroke-dashoffset: 0 } } @keyframes th-rise { from { opacity: 0; transform: scaleY(.2) } to { opacity: 1; transform: scaleY(1) } } @media (prefers-reduced-motion: reduce) { .th-chart * { animation: none !important } }`}</style>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="th-chart h-auto w-full" role="img" aria-labelledby={titleId}>
        <title id={titleId}>
          {`The risk score after each calculation: ${scores
            .map((one) => `${formatDate(one.at)} ${one.score} ${BAND_LABEL[one.band as RiskBand]}`)
            .join(", ")}. The table below holds the same figures.`}
        </title>
        <defs>
          <pattern id="sentra-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--muted)" />
            <path d="M0 6 L6 0" stroke="var(--foreground)" strokeWidth="1.6" />
          </pattern>
          <pattern id="sentra-dots" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--muted)" />
            <circle cx="3" cy="3" r="1.4" fill="var(--foreground)" />
          </pattern>
        </defs>
        {BANDS.map((band) => (
          <g key={band.band}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(band.from)} y2={y(band.from)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={WIDTH - PAD_RIGHT + 6} y={y(band.from) + 4} className="fill-muted-foreground text-[11px]">
              {BAND_LABEL[band.band]} {band.from}
            </text>
          </g>
        ))}
        <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x={4} y={y(100) + 4} className="fill-muted-foreground text-[11px]">
          100
        </text>
        <text x={14} y={y(0) + 4} className="fill-muted-foreground text-[11px]">
          0
        </text>
        {at !== null && (
          <line x1={x(at)} x2={x(at)} y1={LINE_TOP} y2={BARS_BOTTOM} stroke="var(--primary)" strokeOpacity="0.35" strokeWidth={2} />
        )}
        <polyline
          points={scores.map((one, index) => `${x(index)},${y(one.score)}`).join(" ")}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeDasharray={length}
          style={{ ["--len" as string]: length, animation: "th-draw 1s .1s ease-out both" }}
        />
        {scores.map((one, index) => (
          <g key={`${one.at}-line`}>
            <circle
              cx={x(index)}
              cy={y(one.score)}
              r={at === index ? 5.5 : 3}
              fill={at === index ? "var(--primary)" : "var(--foreground)"}
              style={{ transition: "r .15s" }}
            />
            <text x={x(index)} y={y(one.score) - 10} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
              {one.score}
            </text>
          </g>
        ))}
        {scores.map((one, index) => {
          let bottom = BARS_BOTTOM
          return (
            <g
              key={`${one.at}-bars`}
              style={{ transformBox: "fill-box", transformOrigin: "bottom", animation: `th-rise .6s ${0.3 + index * 0.08}s ease-out both` }}
              opacity={at === null || at === index ? 1 : 0.45}
            >
              {COUNTED.map((severity) => {
                const count = one.open_by_severity[severity] ?? 0
                if (!count) return null
                const height = (count / tallest) * (BARS_BOTTOM - BARS_TOP)
                bottom -= height
                return (
                  <rect
                    key={severity}
                    x={x(index) - barWidth / 2}
                    y={bottom}
                    width={barWidth}
                    height={height}
                    fill={FILLS[severity]}
                    stroke="var(--border)"
                  />
                )
              })}
              <text x={x(index)} y={BARS_BOTTOM + 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {one.open_total}
              </text>
            </g>
          )
        })}
        <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={BARS_BOTTOM} y2={BARS_BOTTOM} stroke="var(--border)" />
      </svg>

      {/* One button on every point: pointing at it or focusing it reads the calculation out */}
      {scores.map((one, index) => (
        <button
          key={`${one.at}-pick`}
          type="button"
          aria-label={`${formatDateTime(one.at)}: risk score ${one.score}, ${BAND_LABEL[one.band as RiskBand]}, ${one.open_total} open findings`}
          aria-pressed={at === index}
          onMouseEnter={() => setAt(index)}
          onMouseLeave={() => setAt(null)}
          onFocus={() => setAt(index)}
          onBlur={() => setAt(null)}
          className="absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: `${(x(index) / WIDTH) * 100}%`, top: `${(y(one.score) / HEIGHT) * 100}%` }}
        />
      ))}
      {picked && at !== null && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 rounded-xl border bg-card p-3 text-[13px] shadow-lg"
          style={{
            left: `${Math.min(86, Math.max(14, (x(at) / WIDTH) * 100))}%`,
            top: `${Math.max(2, (y(picked.score) / HEIGHT) * 100 + 8)}%`,
          }}
        >
          <p className="text-xs text-muted-foreground">{formatDateTime(picked.at)}</p>
          <p className="mt-0.5 font-semibold">
            <span className="tabular text-lg">{picked.score}</span> {BAND_LABEL[picked.band as RiskBand]}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
            <span className="tabular font-medium text-foreground">{picked.open_total} open</span>
            {COUNTED.filter((severity) => (picked.open_by_severity[severity] ?? 0) > 0).map((severity) => (
              <span key={severity} className="inline-flex items-center gap-1">
                <SeverityShape severity={severity as Severity} />
                <span className="tabular">{picked.open_by_severity[severity]}</span>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}

function ScoreTable({ scores }: { scores: HistoryScore[] }) {
  return (
    <Table
      container={{
        tabIndex: 0,
        role: "group",
        "aria-label": "Risk score after each calculation",
        className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      }}
    >
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="text-xs">When</TableHead>
          <TableHead className="text-xs">Risk score</TableHead>
          <TableHead className="text-xs">Open findings</TableHead>
          {COUNTED.map((severity) => (
            <TableHead key={severity} className="text-xs">
              {SEVERITY_LABEL[severity as Severity]}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...scores].reverse().map((one) => (
          <TableRow key={one.at}>
            <TableCell className="text-[13px]">{formatDateTime(one.at)}</TableCell>
            <TableCell className="tabular text-[13px]">
              {one.score} {BAND_LABEL[one.band as RiskBand]}
            </TableCell>
            <TableCell className="tabular text-[13px]">{one.open_total}</TableCell>
            {COUNTED.map((severity) => (
              <TableCell key={severity} className="tabular text-[13px]">
                {one.open_by_severity[severity] ?? 0}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Legend() {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
      {COUNTED.map((severity) => (
        <li key={severity} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg width="12" height="12" aria-hidden="true">
            <rect width="12" height="12" fill={FILLS[severity]} stroke="var(--border)" />
          </svg>
          <SeverityShape severity={severity as Severity} />
          {SEVERITY_LABEL[severity as Severity]}
        </li>
      ))}
    </ul>
  )
}

const KIND_ICON: Record<string, LucideIcon> = {
  registration: Archive,
  verification: ShieldCheck,
  configuration: Settings2,
  profile: Waypoints,
  campaign_run: Rocket,
  retest: RotateCcw,
  shield_policy: Shield,
}

/** One entry of the timeline (UC-2.7 step 2), with the campaign run it belongs to (step 5). */
function Event({ event, index }: { event: HistoryEvent; index: number }) {
  const run = event.run
  const Icon = KIND_ICON[event.kind] ?? CircleDot
  return (
    <li
      className="group relative flex gap-3 pb-5 last:pb-0"
      style={{ animation: `th-in .45s ${Math.min(index, 12) * 0.05}s ease-out both` }}
    >
      <span aria-hidden="true" className="absolute top-9 bottom-0 left-[17px] w-0.5 bg-border group-last:hidden" />
      <span
        aria-hidden="true"
        className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full border-2 border-[#dbe3fb] bg-[#eaeefd] text-[#1f2f80] dark:border-white/15 dark:bg-[#27406f] dark:text-[#d8e4ff]"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-xl border bg-card px-3.5 py-2.5 transition-shadow hover:shadow-md">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-text-secondary">{HISTORY_KIND_LABEL[event.kind]}</span>
          <time dateTime={event.at} className="tabular text-xs text-muted-foreground">
            {formatDateTime(event.at)}
          </time>
        </div>
        <p className="mt-1 text-[13px]">{event.summary}</p>
        <p className="text-xs text-muted-foreground">
          {event.by_sentra ? "Sentra" : event.actor}
          {event.details_deleted && " · the details were deleted at the end of their retention period"}
        </p>
        {run?.campaign && (
          <Button asChild variant="outline" size="sm" className="mt-2 h-7 rounded-full px-3 text-xs">
            <Link href={`/campaigns/${run.campaign}/runs/${run.number}`}>View run</Link>
          </Button>
        )}
      </div>
    </li>
  )
}

/** Screen 23: everything that happened to a target, and how its risk developed (UC-2.7). */
export function TargetHistory({ id }: { id: string }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [period, setPeriod] = useState("180")
  const [kind, setKind] = useState("")
  const [history, setHistory] = useState<History | null>(null)
  const [problem, setProblem] = useState("")
  const [asTable, setAsTable] = useState(false)

  usePageCrumbs([{ label: target?.name ?? "Target", href: `/targets/${id}` }, { label: "History" }])

  useEffect(() => {
    getTarget(id)
      .then(setTarget)
      .catch((error: Error) => setProblem(error.message))
  }, [id])

  const load = useCallback(
    (signal: AbortSignal) => {
      getTargetHistory(id, Number(period), kind, signal)
        .then((data) => {
          setHistory(data)
          setProblem("")
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") setProblem(error.message)
        })
    },
    [id, period, kind],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (problem) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{problem}</AlertDescription>
      </Alert>
    )
  }
  if (!history || !target) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      <style>{`@keyframes th-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } } @media (prefers-reduced-motion: reduce) { li { animation: none !important } }`}</style>
      <div className="flex items-start gap-4">
        <TargetMark name={target.name} className="size-14 text-xl" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">What has happened to this target, and how its risk developed</p>
          <EndpointChip url={target.endpoint_url} />
        </div>
      </div>
      <TargetTabs targetId={target.id} active="history" />
      <Card
        title="Risk score and open findings after each campaign run"
        action={
          <Button variant="outline" size="sm" onClick={() => setAsTable(!asTable)} className="h-8">
            {asTable ? "View as chart" : "View as table"}
          </Button>
        }
      >
        <p className="text-xs text-muted-foreground">{HISTORY_PERIODS.find((one) => String(one.days) === period)?.label}</p>
        <div className="min-w-0">
          {history.scores.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No risk score yet. The first campaign run of this target calculates one.</p>
          ) : asTable ? (
            <ScoreTable scores={history.scores} />
          ) : (
            <>
              <ScoreChart scores={history.scores} />
              <Legend />
            </>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
          {HISTORY_PERIODS.map((one) => (
            <button
              key={one.days}
              type="button"
              aria-pressed={String(one.days) === period}
              onClick={() => setPeriod(String(one.days))}
              className={cn(
                "h-8 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                String(one.days) === period
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "bg-card text-text-secondary hover:text-foreground",
              )}
            >
              {one.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Event type" className="flex flex-wrap gap-1.5">
          {["", ...history.kinds].map((one) => {
            const Icon = one ? (KIND_ICON[one] ?? CircleDot) : null
            return (
              <button
                key={one || "all"}
                type="button"
                aria-pressed={one === kind}
                onClick={() => setKind(one)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  one === kind
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "bg-card text-text-secondary hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-3.5" aria-hidden="true" />}
                {one ? HISTORY_KIND_LABEL[one as keyof typeof HISTORY_KIND_LABEL] : "All events"}
              </button>
            )
          })}
        </div>
      </div>

      {history.events.length === 0 ? (
        <Card title="History">
          <div className="py-6 text-center">
            <p className="text-sm font-medium">Nothing in this period</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {history.has_runs ? "Choose a longer period or another event type." : "No campaign has run against this target yet."}
            </p>
            {!history.has_runs && (
              <Button asChild size="sm" className="mt-4">
                <Link href={`/campaigns/new?target=${target.id}`}>Create campaign</Link>
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card title="History">
          <ul className="flex flex-col" key={`${period}-${kind}`}>
            {history.events.map((event, index) => (
              <Event key={`${event.at}-${index}`} event={event} index={index} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
