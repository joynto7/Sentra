"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { CircleDashed, Pause, Play, Search, ShieldQuestion, X } from "lucide-react"

import { CoverageMotion } from "@/components/risk/coverage-motion"
import type { App, AppRow, Ring } from "@/components/risk/coverage-model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

/** The radar is drawn on a square of this many units, whatever size it is shown at. */
const U = 760
const C = U / 2
const R_CORE = 30
const R_CRITICAL = 172
const R_MODERATE = 268
const R_OUTER = 352
/** Half the angle of the blind-spot wedge, east of the centre. */
const WEDGE = 34

const RING_COLOUR: Record<Ring, string> = {
  critical: "var(--severity-critical)",
  moderate: "var(--severity-medium)",
  covered: "var(--success)",
  blind: "var(--series-3)",
}
const RING_NAME: Record<Ring, string> = {
  critical: "Critical risk",
  moderate: "Moderate, with gaps",
  covered: "No open findings",
  blind: "Blind spot, unverified",
}
const RISK_BADGE: Record<Ring, string> = {
  critical: "High risk",
  moderate: "Moderate",
  covered: "No open findings",
  blind: "Unverified blind spot",
}

export type Filter = "all" | "critical" | "gaps"
type Spot = { x: number; y: number; size: number }

const polar = (radius: number, degrees: number) => ({
  x: C + radius * Math.cos((degrees * Math.PI) / 180),
  y: C + radius * Math.sin((degrees * Math.PI) / 180),
})

/** Keeps a node out of the strip at the top where the ring titles are written. */
function awayFromTop(degrees: number, half: number) {
  const d = ((degrees % 360) + 360) % 360
  if (Math.abs(d - 270) >= half) return d
  return d < 270 ? 270 - half : 270 + half
}

/**
 * Where each application sits. A ring's applications share its band, spread round the part of
 * the circle that is not the wedge; the unverified ones sit inside the wedge. Bigger counts make
 * bigger circles, so the size alone says how much is open.
 */
function layout(apps: App[]): Map<string, Spot> {
  const spots = new Map<string, Spot>()
  const sizeOf = (app: App) => (app.verified ? Math.min(58, Math.max(34, 30 + app.open * 2.4)) : 38)
  const bands: Record<Exclude<Ring, "blind">, number> = { critical: 108, moderate: 220, covered: 310 }
  // How wide the title of each ring is, so no node sits under it
  const titles: Record<Exclude<Ring, "blind">, number> = { critical: 32, moderate: 25, covered: 22 }
  for (const ring of ["critical", "moderate", "covered"] as const) {
    const here = apps.filter((app) => app.ring === ring).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
    const first = 360 - (WEDGE + 10)
    const span = 360 - 2 * (WEDGE + 10)
    for (const [index, app] of here.entries()) {
      // From the top-right round the left to the bottom-right, the biggest first.
      const angle = awayFromTop(first - ((index + 0.5) * span) / here.length, titles[ring])
      // A crowded ring staggers its nodes in and out, so their labels never meet.
      const stagger = here.length > 4 ? (index % 2 ? 15 : -15) : ring === "critical" && here.length > 2 ? (index % 2 ? 18 : -14) : 0
      spots.set(app.id, { ...polar(bands[ring] + stagger, angle), size: sizeOf(app) })
    }
  }
  const blind = apps.filter((app) => app.ring === "blind")
  const reach = WEDGE - 10
  for (const [index, app] of blind.entries()) {
    const angle = blind.length === 1 ? 0 : -reach + ((index + 0.5) * 2 * reach) / blind.length
    spots.set(app.id, { ...polar(240, angle), size: sizeOf(app) })
  }
  return spots
}

function matches(app: App, filter: Filter, query: string) {
  if (filter === "critical" && app.ring !== "critical") return false
  if (filter === "gaps" && !(app.gaps > 0 || !app.verified)) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    app.name.toLowerCase().includes(q) ||
    app.rows.some((row) => row.code.toLowerCase().includes(q) || (row.name ?? "").toLowerCase().includes(q))
  )
}

function standingText(row: AppRow) {
  const s = row.standing
  if (s.kind === "open") return `${s.open} open`
  if (s.kind === "gap") return s.stale ? "Stale" : "Gap"
  if (s.kind === "clean") return "0 open"
  if (s.kind === "not_verified") return "Not verified"
  if (s.kind === "out_of_scope") return "Out of scope"
  return "Not applicable"
}

const ORDER: Record<string, number> = { open: 0, gap: 1, clean: 2, not_applicable: 3, not_verified: 4, out_of_scope: 5 }

/** One category in the drawer: red from two open findings, amber for one or for a gap, slate otherwise. */
function rowTone(row: AppRow) {
  const s = row.standing
  if (s.kind === "open" && s.open >= 2) return "bg-[var(--severity-critical-bg)] text-[var(--severity-critical-text)] border-[var(--severity-critical)]/50"
  if (s.kind === "open" || s.kind === "gap") return "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-text)] border-[var(--severity-medium)]/60"
  return "bg-muted text-text-secondary border-border"
}

type Geometry = { rx: number; ry: number; rs: number; dx: number; dy: number; dh: number; stacked: boolean }

/**
 * The radar of the fleet: every application of the organisation as a circle, in the ring its open
 * findings put it in, and the ones whose owner is not verified in a wedge of their own, where
 * nothing is tested. A click on a circle opens its categories in the drawer, with a line drawn
 * from one to the other; the search and the filters dim what does not match. The drawer lists
 * the same facts as text, and every circle and row is a button, so nothing needs the mouse.
 */
export function CoverageRadar({
  apps,
  selected,
  onSelect,
  onOpenCategory,
  onFocusLanes,
  filter: shownFilter,
  onFilter,
}: {
  apps: App[]
  /** The chip that is on, when the page keeps it (so the guide can press one); the radar keeps its own otherwise. */
  filter?: Filter
  onFilter?: (value: Filter) => void
  /** The application whose drawer is open, or "" while it is closed. */
  selected: string
  onSelect: (id: string) => void
  /** A category of the application: the page opens the panel with its threats and suites. */
  onOpenCategory: (code: string, targetId: string) => void
  /** Show only this application in the triage board below. */
  onFocusLanes: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [ownFilter, setOwnFilter] = useState<Filter>("all")
  const filter = shownFilter ?? ownFilter
  const setFilter = onFilter ?? setOwnFilter
  const [paused, setPaused] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [geo, setGeo] = useState<Geometry | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const radar = useRef<HTMLDivElement>(null)
  const drawer = useRef<HTMLElement>(null)

  const spots = useMemo(() => layout(apps), [apps])
  // No circle chosen means no drawer: a second click on the chosen one closes it.
  const app = apps.find((one) => one.id === selected)
  const open = app !== undefined
  const lit = useMemo(() => new Set(apps.filter((one) => matches(one, filter, query)).map((one) => one.id)), [apps, filter, query])
  const searching = query.trim() !== "" || filter !== "all"
  const totalOpen = apps.reduce((sum, one) => sum + one.open, 0)
  const q = query.trim().toLowerCase()

  const measure = useCallback(() => {
    const w = wrap.current
    const r = radar.current
    const d = drawer.current
    if (!w || !r) return
    if (!d) {
      setGeo(null)
      return
    }
    const wr = w.getBoundingClientRect()
    const rr = r.getBoundingClientRect()
    const dr = d.getBoundingClientRect()
    setGeo({
      rx: rr.left - wr.left,
      ry: rr.top - wr.top,
      rs: rr.width,
      dx: dr.left - wr.left,
      dy: dr.top - wr.top,
      dh: dr.height,
      stacked: dr.top >= rr.bottom - 2,
    })
  }, [])

  useEffect(() => {
    const watcher = new ResizeObserver(() => measure())
    for (const element of [wrap.current, radar.current, drawer.current]) if (element) watcher.observe(element)
    return () => watcher.disconnect()
  }, [measure, open])

  const spot = app ? spots.get(app.id) : undefined
  const from = geo && spot ? { x: geo.rx + (spot.x / U) * geo.rs, y: geo.ry + (spot.y / U) * geo.rs } : null
  const to = geo && app ? { x: geo.dx, y: geo.dy + Math.min(geo.dh / 2, 92) } : null
  const length = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
  const tone = app ? RING_COLOUR[app.ring] : "var(--primary)"
  const sortedRows = [...(app?.rows ?? [])].sort(
    (a, b) =>
      ORDER[a.standing.kind] - ORDER[b.standing.kind] ||
      (b.standing.kind === "open" && a.standing.kind === "open" ? b.standing.open - a.standing.open : 0) ||
      a.code.localeCompare(b.code),
  )
  const hovered = hover ? apps.find((one) => one.id === hover) : undefined
  const hoveredSpot = hovered ? spots.get(hovered.id) : undefined
  const findings = sortedRows.filter((row) => row.standing.kind === "open" || row.standing.kind === "gap")
  const quiet = sortedRows.filter((row) => row.standing.kind !== "open" && row.standing.kind !== "gap")

  return (
    <section
      id="coverage-radar"
      aria-label="Blast radius radar"
      data-paused={paused}
      onKeyDown={(event) => event.key === "Escape" && app && onSelect("")}
      className="min-w-0 overflow-hidden rounded-[10px] border bg-card"
    >
      <CoverageMotion />
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-52 flex-1 sm:max-w-80">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an application or category"
            aria-label="Find an application or a category"
            className="h-9 pl-8"
          />
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => setFilter((value || "all") as Filter)}
          variant="outline"
          aria-label="Which applications to highlight"
        >
          <ToggleGroupItem value="all">All apps</ToggleGroupItem>
          <ToggleGroupItem value="critical">Critical only</ToggleGroupItem>
          <ToggleGroupItem value="gaps">Gaps &amp; unverified</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground" role="status">
          {searching ? `${lit.size} of ${apps.length} applications match` : `${apps.length} applications`}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-9 gap-1.5"
          aria-pressed={paused}
          onClick={() => setPaused((now) => !now)}
        >
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused ? "Play the radar" : "Pause the radar"}
        </Button>
      </div>

      <div
        ref={wrap}
        className={cn(
          "relative grid items-start gap-8 p-4 lg:justify-center",
          open ? "lg:grid-cols-[minmax(0,560px)_minmax(0,440px)]" : "lg:grid-cols-[minmax(0,560px)]",
        )}
      >
        {/* The line from the chosen circle to the drawer: above the rings, below the circles. */}
        {app && geo && from && to && !geo.stacked && (
          <svg className="pointer-events-none absolute inset-0 z-10 size-full" aria-hidden="true">
            <defs>
              <linearGradient id="cr-line" gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
                <stop offset="0" stopColor={tone} stopOpacity="0.95" />
                <stop offset="1" stopColor="var(--primary)" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <g key={app.id}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="url(#cr-line)" strokeWidth="6" opacity="0.14" strokeLinecap="round" />
              <line
                className="cm-move cm-once"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="url(#cr-line)"
                strokeWidth="1.6"
                strokeDasharray={length}
                style={{ ["--len" as string]: length, animation: "cm-draw .7s cubic-bezier(.2,.7,.2,1) both" }}
              />
              <circle cx={to.x} cy={to.y} r="4" fill="var(--primary)" />
              <circle cx={to.x} cy={to.y} r="9" fill="none" stroke="var(--primary)" opacity="0.45" />
              <circle r="3" fill="var(--foreground)">
                <animateMotion dur="2.4s" repeatCount="indefinite" path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} />
              </circle>
            </g>
          </svg>
        )}

        <div className="min-w-0">
         {/* On a narrow screen the radar keeps a size its labels can be read at, and scrolls. */}
         <div className="overflow-x-auto">
          <div
            ref={radar}
            role="group"
            aria-label="Applications by risk, from the centre outwards"
            className="relative mx-auto aspect-square w-full max-w-[420px] min-w-[360px] [container-type:inline-size]"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
                backgroundSize: "7.9% 7.9%",
                maskImage: "radial-gradient(circle at center, #000 38%, transparent 72%)",
              }}
            />
            {/* The sweep: a beam that turns round the radar, clipped to the circle it turns in. */}
            <div
              aria-hidden="true"
              className="absolute overflow-hidden rounded-full"
              style={{
                left: `${((C - R_OUTER) / U) * 100}%`,
                top: `${((C - R_OUTER) / U) * 100}%`,
                width: `${((2 * R_OUTER) / U) * 100}%`,
                height: `${((2 * R_OUTER) / U) * 100}%`,
              }}
            >
              <div
                className="cm-move absolute inset-0"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--primary) 26%, transparent) 52deg, color-mix(in srgb, var(--primary) 4%, transparent) 53deg, transparent 54deg)",
                  animation: "cm-sweep 9s linear infinite",
                }}
              />
            </div>
            <svg viewBox={`0 0 ${U} ${U}`} className="absolute inset-0 size-full" aria-hidden="true">
              <defs>
                <radialGradient id="cr-critical" cx="50%" cy="50%" r="50%">
                  <stop offset="0" stopColor="var(--severity-critical)" stopOpacity="0.5" />
                  <stop offset="1" stopColor="var(--severity-critical)" stopOpacity="0.1" />
                </radialGradient>
                <radialGradient id="cr-moderate" cx="50%" cy="50%" r="50%">
                  <stop offset="0.55" stopColor="var(--severity-medium)" stopOpacity="0.02" />
                  <stop offset="1" stopColor="var(--severity-medium)" stopOpacity="0.2" />
                </radialGradient>
                <path id="cr-arc-critical" d={`M ${C - (R_CRITICAL - 16)} ${C} A ${R_CRITICAL - 16} ${R_CRITICAL - 16} 0 0 1 ${C + (R_CRITICAL - 16)} ${C}`} />
                <path id="cr-arc-moderate" d={`M ${C - (R_MODERATE - 16)} ${C} A ${R_MODERATE - 16} ${R_MODERATE - 16} 0 0 1 ${C + (R_MODERATE - 16)} ${C}`} />
                <path id="cr-arc-outer" d={`M ${C - (R_OUTER - 16)} ${C} A ${R_OUTER - 16} ${R_OUTER - 16} 0 0 1 ${C + (R_OUTER - 16)} ${C}`} />
                <path
                  id="cr-arc-wedge"
                  d={`M ${polar(R_OUTER - 14, -WEDGE + 4).x} ${polar(R_OUTER - 14, -WEDGE + 4).y} A ${R_OUTER - 14} ${R_OUTER - 14} 0 0 1 ${polar(R_OUTER - 14, WEDGE - 4).x} ${polar(R_OUTER - 14, WEDGE - 4).y}`}
                />
              </defs>
              {/* The rings, outermost first */}
              <circle cx={C} cy={C} r={R_OUTER} fill="var(--muted)" fillOpacity="0.35" stroke="var(--border-strong)" strokeWidth="1.5" />
              <circle cx={C} cy={C} r={R_MODERATE} fill="url(#cr-moderate)" stroke="var(--severity-medium)" strokeWidth="2" strokeOpacity="0.8" />
              <circle cx={C} cy={C} r={R_CRITICAL} fill="url(#cr-critical)" stroke="var(--severity-critical)" strokeWidth="2" strokeOpacity="0.85" />
              <path
                d={`M ${polar(64, -WEDGE).x} ${polar(64, -WEDGE).y} L ${polar(R_OUTER, -WEDGE).x} ${polar(R_OUTER, -WEDGE).y} A ${R_OUTER} ${R_OUTER} 0 0 1 ${polar(R_OUTER, WEDGE).x} ${polar(R_OUTER, WEDGE).y} L ${polar(64, WEDGE).x} ${polar(64, WEDGE).y} Z`}
                fill="var(--series-3)"
                fillOpacity="0.16"
                stroke="var(--series-3)"
                strokeOpacity="0.6"
                strokeDasharray="6 6"
              />
              {/* Pulses leaving the core */}
              {[0, 2, 4].map((delay) => (
                <circle
                  key={delay}
                  className="cm-move"
                  cx={C}
                  cy={C}
                  r={R_OUTER}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                  style={{ transformBox: "fill-box", transformOrigin: "center", animation: `cm-pulse 6s ${delay}s ease-out infinite` }}
                />
              ))}
              {/* The core */}
              <circle className="cm-move" cx={C} cy={C} r={R_CORE + 12} fill="none" stroke="var(--severity-critical)" strokeOpacity="0.35" strokeWidth="2" style={{ ["--c" as string]: "var(--severity-critical)", animation: "cm-breathe 3.2s ease-in-out infinite" }} />
              <circle cx={C} cy={C} r={R_CORE} fill="var(--card)" stroke="var(--severity-critical)" strokeWidth="7" strokeOpacity="0.9" />
              <text x={C} y={C + 4} textAnchor="middle" className="fill-foreground text-[32px] font-bold tabular">
                {totalOpen}
              </text>
              <text x={C} y={C + 21} textAnchor="middle" className="fill-text-secondary text-[17px]">
                open
              </text>
              {/* Ring titles */}
              <text className="fill-text-secondary text-[20px] font-semibold uppercase" letterSpacing="3">
                <textPath href="#cr-arc-critical" startOffset="50%" textAnchor="middle">Critical risk</textPath>
              </text>
              <text className="fill-text-secondary text-[20px] font-semibold uppercase" letterSpacing="3">
                <textPath href="#cr-arc-moderate" startOffset="50%" textAnchor="middle">Moderate / gaps</textPath>
              </text>
              <text className="fill-muted-foreground text-[19px] font-semibold uppercase" letterSpacing="3">
                <textPath href="#cr-arc-outer" startOffset="50%" textAnchor="middle">No open findings</textPath>
              </text>
              <text className="fill-text-secondary text-[19px] font-semibold uppercase" letterSpacing="2.5">
                <textPath href="#cr-arc-wedge" startOffset="50%" textAnchor="middle">Blind spots (unverified)</textPath>
              </text>
            </svg>

            {apps.map((one, index) => {
              const place = spots.get(one.id)
              if (!place) return null
              const colour = RING_COLOUR[one.ring]
              const active = one.id === app?.id
              const dim = searching && !lit.has(one.id)
              const hit = q !== "" && lit.has(one.id)
              return (
                <button
                  key={one.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${one.name}: ${one.verified ? `${one.open} open ${one.open === 1 ? "finding" : "findings"}${one.gaps ? `, ${one.gaps} ${one.gaps === 1 ? "gap" : "gaps"}` : ""}` : "owner not verified, never tested"}. ${RING_NAME[one.ring]}.`}
                  onClick={() => onSelect(app?.id === one.id ? "" : one.id)}
                  onMouseEnter={() => setHover(one.id)}
                  onMouseLeave={() => setHover((now) => (now === one.id ? null : now))}
                  onFocus={() => setHover(one.id)}
                  onBlur={() => setHover((now) => (now === one.id ? null : now))}
                  className={cn(
                    "cm-move cm-once absolute z-20 grid aspect-square place-items-center rounded-full outline-none transition-[opacity,transform] duration-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                    dim ? "opacity-25" : "opacity-100",
                  )}
                  style={{
                    left: `${(place.x / U) * 100}%`,
                    top: `${(place.y / U) * 100}%`,
                    width: `${(place.size / U) * 100}%`,
                    minWidth: 28,
                    transform: "translate(-50%, -50%)",
                    animation: `cm-in .7s ${index * 80}ms cubic-bezier(.2,.8,.2,1) backwards`,
                    ["--c" as string]: colour,
                  }}
                >
                  {active && (
                    <>
                      <span aria-hidden="true" className="cm-move absolute -inset-1.5 rounded-full border-2" style={{ borderColor: colour, animation: "cm-ring 1.8s ease-out infinite" }} />
                      <span aria-hidden="true" className="absolute -inset-1 rounded-full border-2" style={{ borderColor: colour, opacity: 0.9 }} />
                    </>
                  )}
                  {hit && <span aria-hidden="true" className="absolute -inset-2.5 rounded-full border-2 border-dotted" style={{ borderColor: "var(--primary)" }} />}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-full place-items-center rounded-full border-[2.5px] transition-transform duration-200",
                      one.verified ? "border-solid" : "border-dashed",
                      one.ring === "critical" && "cm-move",
                    )}
                    style={{
                      borderColor: colour,
                      background: one.verified
                        ? `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${colour} 70%, var(--card)), color-mix(in srgb, ${colour} 18%, var(--card)) 78%)`
                        : "color-mix(in srgb, var(--series-3) 10%, var(--card))",
                      boxShadow: one.verified ? `0 0 ${active ? 26 : 14}px color-mix(in srgb, ${colour} ${active ? 60 : 38}%, transparent)` : undefined,
                      transform: hover === one.id ? "scale(1.1)" : undefined,
                      animation: one.ring === "critical" ? "cm-breathe 3s ease-in-out infinite" : undefined,
                    }}
                  >
                    {one.verified ? (
                      <span className="text-xs font-bold text-foreground tabular">{one.open || "✓"}</span>
                    ) : (
                      <span className="font-mono text-sm font-bold text-text-secondary">?</span>
                    )}
                  </span>
                </button>
              )
            })}

            {hovered && hoveredSpot && (
              <div
                role="presentation"
                className="pointer-events-none absolute z-30 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
                style={{
                  left: `${(hoveredSpot.x / U) * 100}%`,
                  top: `${((hoveredSpot.y - hoveredSpot.size / 2 - 10) / U) * 100}%`,
                  transform: "translate(-50%, -100%)",
                }}
              >
                <span className="font-semibold">{hovered.name}</span>
                <span className="block text-text-secondary">
                  {hovered.verified
                    ? `${hovered.open} open · ${hovered.gaps} ${hovered.gaps === 1 ? "gap" : "gaps"}`
                    : "Owner not verified · never tested"}
                </span>
              </div>
            )}
          </div>
         </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3.5 rounded-full border-2 border-[var(--severity-medium)]" />
              <span aria-hidden="true" className="size-6 rounded-full border-2 border-[var(--severity-medium)]" />
              Circle size = open findings
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-5 rounded-full border-2 border-solid border-[var(--severity-critical)]" />
              Solid border = verified owner
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="grid size-5 place-items-center rounded-full border-2 border-dashed border-[var(--series-3)] font-mono text-[10px]">?</span>
              Dashed border = owner not verified
            </span>
          </div>
          {!open && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Select a circle to see the categories of that application. Select it again to close them.
            </p>
          )}
        </div>

        {app && (
        <aside
          ref={drawer}
          aria-label={`Categories of ${app.name}`}
          aria-live="polite"
          className="relative z-20 rounded-xl border bg-card/90 p-4 shadow-lg backdrop-blur-md lg:self-start"
          style={{ boxShadow: `0 0 0 1px color-mix(in srgb, ${tone} 22%, transparent), 0 12px 30px -12px color-mix(in srgb, ${tone} 45%, transparent)` }}
        >
          <div key={app.id} style={{ animation: "cm-rise .35s cubic-bezier(.2,.8,.2,1) both" }} className="cm-move cm-once">
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              aria-label={`Close the details of ${app.name}`}
              onClick={() => onSelect("")}
            >
              <X aria-hidden="true" />
            </Button>
            <h3 className="pr-8 text-lg leading-tight font-semibold">{app.name}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-bold tracking-wide uppercase"
                style={{
                  borderColor: `color-mix(in srgb, ${tone} 60%, transparent)`,
                  background: `color-mix(in srgb, ${tone} 14%, var(--card))`,
                }}
              >
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: tone }} />
                {RISK_BADGE[app.ring]}
              </span>
              <span className="text-xs text-text-secondary">
                {app.type.replace(/_/g, " ")} · {app.environment}
              </span>
            </div>
            <p className="mt-2 text-[13px] text-text-secondary">
              Last tested: <span className="text-foreground">{app.lastTested ? formatDate(app.lastTested) : "Never"}</span>
            </p>

            {app.verified ? (
              <div className="mt-3 space-y-3 border-t pt-3">
                {/* The three numbers that sum the application up */}
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Open", value: findings.reduce((sum, row) => sum + (row.standing.kind === "open" ? row.standing.open : 0), 0) },
                    { label: "Categories hit", value: findings.filter((row) => row.standing.kind === "open").length },
                    { label: "Not tested", value: findings.filter((row) => row.standing.kind === "gap").length },
                  ].map((one) => (
                    <div key={one.label} className="rounded-xl bg-muted/60 px-2 py-2">
                      <dd className="tabular text-xl leading-6 font-semibold">{one.value}</dd>
                      <dt className="text-[11px] text-text-secondary">{one.label}</dt>
                    </div>
                  ))}
                </dl>

                {/* The categories that need a look: one tile each, the count first */}
                {findings.length > 0 && (
                  <ul className="grid grid-cols-2 gap-2">
                    {findings.map((row) => {
                      const hit = q !== "" && (row.code.toLowerCase().includes(q) || (row.name ?? "").toLowerCase().includes(q))
                      const gap = row.standing.kind === "gap"
                      return (
                        <li key={row.code}>
                          <button
                            type="button"
                            onClick={() => onOpenCategory(row.code, app.id)}
                            className={cn(
                              "flex h-full w-full flex-col rounded-xl border p-2.5 text-left transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              rowTone(row),
                              gap && "border-dashed",
                              hit && "ring-2 ring-primary",
                            )}
                          >
                            <span className="font-mono text-[11px] font-bold">{row.code}</span>
                            <span className="mt-0.5 line-clamp-2 text-[13px] leading-tight">{row.name ?? ""}</span>
                            <span className="mt-auto flex items-baseline gap-1 pt-2">
                              {gap ? (
                                <>
                                  <CircleDashed className="size-4 self-center" aria-hidden="true" />
                                  <span className="text-sm font-semibold">{standingText(row)}</span>
                                </>
                              ) : (
                                <>
                                  <span className="tabular text-2xl leading-none font-semibold">
                                    {row.standing.kind === "open" ? row.standing.open : 0}
                                  </span>
                                  <span className="text-xs">open</span>
                                </>
                              )}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* The rest, quietly: nothing open, or nothing to test here */}
                {quiet.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">No open findings</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {quiet.map((row) => (
                        <li key={row.code}>
                          <button
                            type="button"
                            onClick={() => onOpenCategory(row.code, app.id)}
                            title={`${row.name ?? row.code}: ${standingText(row)}`}
                            aria-label={`${row.code} ${row.name ?? ""}: ${standingText(row)}`}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs text-text-secondary transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              !row.inScope && "opacity-70",
                              q !== "" && (row.code.toLowerCase().includes(q) || (row.name ?? "").toLowerCase().includes(q)) && "ring-2 ring-primary",
                            )}
                          >
                            <span className="font-mono font-semibold text-foreground">{row.code}</span>
                            {standingText(row)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 flex gap-3 rounded-lg border border-dashed p-3 text-[13px] text-text-secondary">
                <ShieldQuestion aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--series-3)]" />
                <p>
                  <span className="font-semibold text-foreground">All categories: not verified.</span> Nothing is tested
                  until the target&apos;s ownership is verified, so whatever is open here is not known.
                </p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
              <Button asChild variant="outline" size="sm" className="h-8">
                <Link href={`/targets/${app.id}`}>{app.verified ? "Open the target" : "Verify the target"}</Link>
              </Button>
              {app.verified && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => onFocusLanes(app.id)}>
                  Show its categories below
                </Button>
              )}
            </div>
          </div>
        </aside>
        )}
      </div>
    </section>
  )
}
