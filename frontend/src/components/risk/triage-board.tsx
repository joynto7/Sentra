"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { CoverageMotion } from "@/components/risk/coverage-motion"
import { type App, type Lane, buildLanes, severityVar } from "@/components/risk/coverage-model"
import { GLASS_SURFACE } from "@/components/sentra/glass-card"
import { SEVERITY_LABEL, SeverityBadge, SeverityShape } from "@/components/sentra/severity-badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { COUNTED, type Coverage } from "@/lib/risk"
import { cn } from "@/lib/utils"

const ALL = "all"

type Zone = "fire" | "dark" | "bulk"

// How a category stands, in the words of its chip, and the order the cards come in (most urgent first)
const ZONES: Record<Zone, { chip: string; filter: string; colour: string }> = {
  fire: { chip: "Critical open", filter: "Critical", colour: "var(--severity-critical)" },
  dark: { chip: "Not fully tested", filter: "Blind spots", colour: "var(--series-3)" },
  bulk: { chip: "High volume", filter: "High volume", colour: "var(--severity-medium)" },
}
const ORDER: Zone[] = ["fire", "dark", "bulk"]

/**
 * Where a category stands: a critical finding makes it a fire, whatever else is true of it; failing
 * that, an application it was never tested on makes it a blind spot; failing that, its findings
 * make it a bottleneck. A category with nothing open and nothing untested sits on no board.
 */
function zoneOf(lane: Lane): Zone | null {
  if (lane.worst === "critical") return "fire"
  if (lane.gaps.length > 0) return "dark"
  if (lane.open > 0) return "bulk"
  return null
}

/** One category: how many findings are open and how they split by severity, and how much of it was tested. */
function Card({
  lane,
  zone,
  index,
  active,
  dim,
  onPick,
}: {
  lane: Lane
  zone: Zone
  index: number
  active: boolean
  dim: boolean
  onPick: () => void
}) {
  const tone = lane.worst ? severityVar(lane.worst) : ZONES[zone].colour
  const parts = COUNTED.filter((severity) => lane.bySeverity[severity] > 0)
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${lane.code} ${lane.name ?? ""}: ${lane.open} open${
          parts.length ? `, ${parts.map((severity) => `${lane.bySeverity[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`).join(", ")}` : ""
        }. ${
          lane.applicable ? `Tested on ${lane.tested} of ${lane.applicable} ${lane.applicable === 1 ? "application" : "applications"}.` : "No application to test."
        }${lane.gaps.length ? ` ${lane.gaps.map((gap) => `${gap.app}: ${gap.stale ? "not tested since it changed" : "never tested"}.`).join(" ")}` : ""}`}
        onClick={onPick}
        className={cn(
          "cm-move cm-once group flex h-full w-full flex-col rounded-2xl border p-4 text-left outline-none",
          GLASS_SURFACE,
          "shadow-[0_1px_2px_rgba(15,30,70,0.06)] transition-[transform,box-shadow,opacity,border-color] duration-200",
          "hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_rgba(43,79,216,0.5)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          dim ? "opacity-50 hover:opacity-100" : "opacity-100",
        )}
        style={{
          borderColor: active ? tone : undefined,
          boxShadow: active ? `0 0 0 1px ${tone}, 0 14px 30px -16px ${tone}` : undefined,
          animation: `cm-rise .5s ${index * 60}ms cubic-bezier(.2,.8,.2,1) backwards`,
        }}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono text-[13px] text-text-secondary">{lane.code}</span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: `color-mix(in srgb, ${ZONES[zone].colour} 14%, var(--card))`, color: "var(--foreground)" }}
          >
            {ZONES[zone].chip}
          </span>
        </span>
        <span className="mt-2 line-clamp-2 block text-base leading-snug font-semibold">{lane.name ?? lane.code}</span>

        <span className="mt-4 flex items-end justify-between gap-3">
          <span className="flex items-baseline gap-1.5">
            <span className="tabular text-4xl leading-none font-semibold">{lane.open}</span>
            <span className="text-sm text-text-secondary">open</span>
          </span>
          {lane.worst && <SeverityBadge severity={lane.worst} />}
        </span>

        {/* The split by severity: one tile for each, with its shape, its number and its name (NFR-4.3) */}
        {lane.open > 0 ? (
          <span className="mt-3 flex flex-wrap gap-1.5">
            {parts.map((severity) => {
              const key = severity === "informational" ? "info" : severity
              return (
                <span
                  key={severity}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium"
                  style={{ background: `var(--severity-${key}-bg)`, color: `var(--severity-${key}-text)` }}
                >
                  <SeverityShape severity={severity} />
                  <span className="tabular text-sm font-semibold">{lane.bySeverity[severity]}</span>
                  {SEVERITY_LABEL[severity]}
                </span>
              )
            })}
          </span>
        ) : (
          <span className="mt-3 text-xs text-text-secondary">Nothing open.</span>
        )}

        {/* Coverage: one dot for each application the category applies to, filled where it was tested */}
        <span className="mt-4 flex items-center justify-between gap-3 text-xs text-text-secondary">
          <span className="flex items-center gap-1" aria-hidden="true">
            {Array.from({ length: Math.min(lane.applicable, 12) }).map((_, index) => (
              <span
                key={index}
                className={cn(
                  "size-2.5 rounded-full border-[1.5px] border-primary",
                  index < lane.tested ? "bg-primary" : "bg-transparent",
                )}
              />
            ))}
            {lane.applicable > 12 && <span className="tabular pl-0.5">+{lane.applicable - 12}</span>}
          </span>
          <span className="tabular">
            <span className="sr-only">Coverage: </span>
            {lane.applicable ? `${lane.tested} of ${lane.applicable} tested` : "nothing to test"}
          </span>
        </span>

        {lane.gaps.length > 0 && (
          <span className="mt-3 flex flex-wrap gap-1.5">
            {lane.gaps.map((gap) => (
              <span key={gap.app} className="rounded-md border border-border-strong bg-muted px-2 py-0.5 text-xs text-foreground">
                {gap.app}: {gap.stale ? "not tested since it changed" : "never tested"}
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * Open findings by category, one card each, the most urgent first: the fires that burn now (a
 * critical finding is open), the blind spots (applications the category was never tested on) and the
 * bulk that has piled up (many findings, none critical). The chips above narrow the cards to one of
 * the three. A card is a button that picks
 * the category, so its severities, its coverage and a link to its findings appear below the board;
 * the application select narrows the whole board to one application.
 */
export function TriageBoard({
  data,
  framework,
  apps,
  target,
  vector,
  onTarget,
  onVector,
}: {
  data: Coverage
  framework: "owasp" | "atlas"
  apps: App[]
  /** The application the board shows, or "" for the whole fleet. */
  target: string
  /** The category picked, or "" for none. */
  vector: string
  onTarget: (id: string) => void
  onVector: (code: string) => void
}) {
  const lanes = useMemo(() => buildLanes(data, target), [data, target])
  const verified = apps.filter((app) => app.verified)
  const chosen = lanes.find((lane) => lane.code === vector) ?? null
  const total = lanes.reduce((sum, lane) => sum + lane.open, 0)
  const outOfScope = data.rows.filter((row) => !row.in_scope).map((row) => row.code)
  const noun = framework === "owasp" ? "OWASP category" : "MITRE ATLAS technique"
  const findingsHref = (code: string) => `/findings?view=open&category=${code}${target ? `&target_id=${target}` : ""}`
  const clean = lanes.filter((lane) => zoneOf(lane) === null)
  const [only, setOnly] = useState<Zone | "all">("all")
  const cards = ORDER.flatMap((zone) =>
    lanes.filter((lane) => zoneOf(lane) === zone && (only === "all" || only === zone)).map((lane) => ({ lane, zone })),
  )
  const counts = Object.fromEntries(ORDER.map((zone) => [zone, lanes.filter((lane) => zoneOf(lane) === zone).length])) as Record<Zone, number>

  return (
    <section aria-labelledby="board" className="min-w-0 overflow-hidden rounded-[10px] border bg-card">
      <CoverageMotion />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-3">
        <div>
          <h2 id="board" className="text-[15px] font-semibold">
            Open findings by {noun}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="board-target" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Application
          </Label>
          <Select value={target || ALL} onValueChange={(value) => onTarget(value === ALL ? "" : value)}>
            <SelectTrigger id="board-target" className="h-9 min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All fleet apps</SelectItem>
              {verified.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5" role="group" aria-label="Show">
        {(["all", ...ORDER] as const).map((zone) => (
          <button
            key={zone}
            type="button"
            aria-pressed={only === zone}
            onClick={() => setOnly(zone)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              only === zone ? "border-transparent bg-primary text-primary-foreground" : "bg-card text-text-secondary hover:text-foreground",
            )}
          >
            {zone === "all" ? "All" : ZONES[zone].filter}
            <span className={cn("tabular rounded-full px-1.5 text-xs", only === zone ? "bg-white/20" : "bg-muted")}>
              {zone === "all" ? lanes.length - clean.length : counts[zone]}
            </span>
          </button>
        ))}
      </div>

      <div key={`${target}-${only}`} className="bg-muted/40 p-4">
        {cards.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {only === "fire"
              ? "Nothing critical is open."
              : only === "dark"
                ? "Every category has been tested on every application."
                : only === "bulk"
                  ? "No other category has findings open."
                  : "No category has findings open or untested."}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ lane, zone }, index) => (
              <Card
                key={lane.code}
                lane={lane}
                zone={zone}
                index={index}
                active={chosen?.code === lane.code}
                dim={chosen !== null && chosen.code !== lane.code}
                onPick={() => onVector(chosen?.code === lane.code ? "" : lane.code)}
              />
            ))}
          </ul>
        )}
      </div>

      {chosen && (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/50 px-3 py-2 text-[13px]" role="status">
          <span className="font-semibold">
            {chosen.code} {chosen.name}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {COUNTED.filter((severity) => chosen.bySeverity[severity] > 0).map((severity) => (
              <span key={severity} className="inline-flex items-center gap-1">
                <SeverityBadge severity={severity} />
                <span className="tabular font-medium">{chosen.bySeverity[severity]}</span>
              </span>
            ))}
            {chosen.open === 0 && <span className="text-text-secondary">Nothing open in this category.</span>}
          </span>
          <span className="text-text-secondary">
            {chosen.applicable
              ? `Tested on ${chosen.tested} of ${chosen.applicable} ${chosen.applicable === 1 ? "application" : "applications"}`
              : "No application to test"}
          </span>
          {chosen.open > 0 && framework === "owasp" && (
            <Link href={findingsHref(chosen.code)} className="inline-block py-1 font-medium text-link hover:underline">
              Show these findings
            </Link>
          )}
        </div>
      )}

      <p className="border-t p-3 text-center text-[13px] text-text-secondary">
        <span className="font-semibold text-foreground">{total} open findings</span> across{" "}
        {lanes.filter((lane) => lane.open > 0).length} categories
        {outOfScope.length ? ` • ${outOfScope.join(" and ")} out of scope` : ""}
        {clean.length ? ` • nothing open or untested in ${clean.map((lane) => lane.code).join(", ")}` : ""}
      </p>
    </section>
  )
}
