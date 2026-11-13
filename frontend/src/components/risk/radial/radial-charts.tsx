"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { bisector, polar, sweep, wedge } from "@/components/risk/radial/geometry"
import { SEVERITY_LABEL, SeverityShape, type Severity } from "@/components/sentra/severity-badge"
import { COUNTED } from "@/lib/risk"
import { cn } from "@/lib/utils"

/**
 * The eight radial chart styles of the dashboard's Breakdown (FR-7.4 (M7), UC-7.3 step 6). Every one draws numbers the dashboard
 * already has, and every part of every one is a real link (or, in the sunburst, a button) with a
 * spoken name, reachable with the keyboard and shown as chosen the same way for the mouse and for
 * the keyboard. None of them says anything the table beside it does not say.
 */

/** One part of a chart: what it is called, how many, in which colour, and where it opens. */
export type Slice = {
  id: string
  label: string
  count: number
  /** A CSS colour, normally one of the product's tokens */
  color: string
  href: string
  /** A severity, which is also drawn as its shape beside its name */
  severity?: Severity
}

export type Progress = { id: string; label: string; count: number; of: number; base: string; color: string; href: string }

export type Branch = { id: string; label: string; total: number; color: string; parts: Slice[] }

const share = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100))
/** A share as words: a real count is never written as "0 %". */
const shareText = (count: number, total: number) => (count > 0 && share(count, total) === 0 ? "<1" : String(share(count, total)))
const spoken = (slice: { label: string; count: number }, total: number, what: string) =>
  `${slice.count} ${slice.label.toLowerCase()} of ${total} ${what}, ${shareText(slice.count, total)} percent. Open them.`

/** The part in focus, for the mouse and the keyboard alike. */
function useFocusedPart() {
  const [active, setActive] = useState<string | null>(null)
  return { active, setActive }
}

/** A wedge that is a link: it opens what it counts, and a mouse or a keyboard on it puts it in focus. */
function Wedge({
  slice,
  path,
  what,
  total,
  active,
  onActive,
  offset,
  dim = true,
  children,
}: {
  slice: Slice
  path: string
  what: string
  total: number
  active: string | null
  onActive: (id: string | null) => void
  offset?: { dx: number; dy: number }
  dim?: boolean
  children?: React.ReactNode
}) {
  const router = useRouter()
  const chosen = active === slice.id
  return (
    <a
      href={slice.href}
      aria-label={spoken(slice, total, what)}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        router.push(slice.href)
      }}
      onMouseEnter={() => onActive(slice.id)}
      onMouseLeave={() => onActive(null)}
      onFocus={() => onActive(slice.id)}
      onBlur={() => onActive(null)}
      className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:transition-[opacity,transform] motion-safe:duration-300"
      style={{
        opacity: dim && active !== null && !chosen ? 0.5 : 1,
        transform: chosen && offset ? `translate(${offset.dx}px, ${offset.dy}px)` : undefined,
      }}
    >
      <path d={path} fill={slice.color} stroke={chosen ? "var(--foreground)" : `color-mix(in oklch, ${slice.color} 58%, black)`} strokeWidth={chosen ? 2.5 : 1} />
      {children}
    </a>
  )
}

/** The legend beside a chart: a link per part, with its shape or dot, its words, its count and its share. */
function Legend({
  slices,
  total,
  active,
  onActive,
  heading,
}: {
  slices: Slice[]
  total: number
  active: string | null
  onActive: (id: string | null) => void
  heading?: string
}) {
  return (
    <div className="min-w-0 max-w-md flex-1">
      {heading && <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{heading}</h3>}
      <ul className="space-y-0.5">
        {slices.map((slice) => (
          <li key={slice.id}>
            <Link
              href={slice.href}
              onMouseEnter={() => onActive(slice.id)}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(slice.id)}
              onBlur={() => onActive(null)}
              className={cn(
                "flex min-h-7 items-center justify-between gap-3 rounded-[6px] px-2 text-[13px] hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active === slice.id && "bg-muted font-medium",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {slice.severity ? (
                  <SeverityShape severity={slice.severity} />
                ) : (
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} aria-hidden="true" />
                )}
                <span className="truncate">{slice.label}</span>
              </span>
              <span className="tabular shrink-0">
                {slice.count} <span className="text-muted-foreground">· {shareText(slice.count, total)} %</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Number and words at the middle of a ring: what is in focus, or the whole. */
function Centre({ big, small, extra }: { big: string | number; small: string; extra?: string }) {
  return (
    <>
      <text x="0" y={extra ? -6 : 0} textAnchor="middle" className="tabular fill-foreground text-[30px] font-semibold">
        {big}
      </text>
      <text x="0" y={extra ? 14 : 20} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">
        {small}
      </text>
      {extra && (
        <text x="0" y="32" textAnchor="middle" className="fill-muted-foreground text-[12px]">
          {extra}
        </text>
      )}
    </>
  )
}

const FRAME = "relative size-60 shrink-0"
// Beside or under its legend by the width of the card it is in, not of the window: a card beside a table is narrow
const STAGE = "flex flex-col items-center gap-6 @min-[30rem]/chart:flex-row @min-[30rem]/chart:items-center @min-[30rem]/chart:gap-10"

type Props = { slices: Slice[]; total: number; what: string }

/** 1. A whole pie, the focused slice moving out. */
export function ClassicPie({ slices, total, what }: Props) {
  const { active, setActive } = useFocusedPart()
  const parts = sweep(slices, total)
  const current = parts.find((part) => part.id === active)
  return (
    <div className={STAGE}>
      <svg viewBox="-120 -120 240 240" className={cn(FRAME, "overflow-visible")} role="group" aria-label={`Pie of the ${total} ${what}`}>
        {parts.map((part) => (
          <Wedge key={part.id} slice={part} path={wedge(104, 0, part.start, part.end, 1.5)} what={what} total={total} active={active} onActive={setActive} offset={bisector(part.start, part.end, 10)} />
        ))}
      </svg>
      <div className="min-w-0 max-w-md flex-1 self-stretch">
        <p className="mb-2 flex items-center justify-between rounded-[7px] bg-muted px-2.5 py-1.5 text-[13px] font-medium" aria-live="polite">
          <span>{current ? current.label : `All ${what}`}</span>
          <span className="tabular">{current ? `${current.count} · ${shareText(current.count, total)} %` : `${total} in all`}</span>
        </p>
        <Legend slices={slices} total={total} active={active} onActive={setActive} />
      </div>
    </div>
  )
}

/** 2. A ring with the total, or the focused part, at its middle. */
export function Donut({ slices, total, what }: Props) {
  const { active, setActive } = useFocusedPart()
  const parts = sweep(slices, total)
  const current = parts.find((part) => part.id === active)
  return (
    <div className={STAGE}>
      <svg viewBox="-120 -120 240 240" className={cn(FRAME, "overflow-visible")} role="group" aria-label={`Ring of the ${total} ${what}`}>
        {parts.map((part) => (
          <Wedge key={part.id} slice={part} path={wedge(104, 66, part.start, part.end, 2)} what={what} total={total} active={active} onActive={setActive} offset={bisector(part.start, part.end, 6)} />
        ))}
        <Centre big={current ? current.count : total} small={current ? current.label : what} extra={current ? `${shareText(current.count, total)} % of the ${total}` : undefined} />
      </svg>
      <Legend slices={slices} total={total} active={active} onActive={setActive} />
    </div>
  )
}

/** 3. The ring with depth: a tilted, extruded view. The same links, the same numbers, a different look. */
export function Isometric({ slices, total, what }: Props) {
  const { active, setActive } = useFocusedPart()
  const parts = sweep(slices, total)
  const current = parts.find((part) => part.id === active)
  const depth = [12, 10, 8, 6, 4, 2]
  return (
    <div className={STAGE}>
      <div className="relative h-52 w-60 shrink-0" style={{ transform: "perspective(650px) rotateX(46deg) rotateZ(-14deg)" }}>
        <svg viewBox="-125 -125 250 250" className="size-full overflow-visible" role="group" aria-label={`Tilted ring of the ${total} ${what}`}>
          <ellipse cx="4" cy="20" rx="102" ry="102" fill="rgba(15, 23, 42, 0.16)" aria-hidden="true" />
          {parts.map((part) => {
            const path = wedge(100, 34, part.start, part.end, 1.4)
            const lifted = active === part.id
            return (
              <g key={part.id} style={{ transform: lifted ? "translate(0px, -9px)" : undefined }} className="motion-safe:transition-transform motion-safe:duration-300">
                {/* The side walls: the same wedge, lower, in a darker colour; they are not part of the link */}
                <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                  {depth.map((offset) => (
                    <path key={offset} d={path} style={{ fill: `color-mix(in oklch, ${part.color} 68%, black)` }} transform={`translate(0 ${offset})`} />
                  ))}
                </g>
                <Wedge slice={part} path={path} what={what} total={total} active={active} onActive={setActive} dim={false} />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="min-w-0 max-w-md flex-1 self-stretch">
        <p className="mb-2 flex items-center justify-between rounded-[7px] bg-muted px-2.5 py-1.5 text-[13px] font-medium" aria-live="polite">
          <span>{current ? current.label : `All ${what}`}</span>
          <span className="tabular">{current ? `${current.count} · ${shareText(current.count, total)} %` : `${total} in all`}</span>
        </p>
        <Legend slices={slices} total={total} active={active} onActive={setActive} />
      </div>
    </div>
  )
}

/** 4. A half ring: the least height of the ring styles, for a narrow place. */
export function Gauge({ slices, total, what }: Props) {
  const { active, setActive } = useFocusedPart()
  const parts = sweep(slices, total, -90, 180)
  const current = parts.find((part) => part.id === active)
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <svg viewBox="-130 -122 260 140" className="h-40 w-full max-w-[320px] overflow-visible" role="group" aria-label={`Half ring of the ${total} ${what}`}>
        {parts.map((part) => (
          <Wedge key={part.id} slice={part} path={wedge(active === part.id ? 116 : 110, 70, part.start, part.end, 1.4)} what={what} total={total} active={active} onActive={setActive} />
        ))}
        <text x="0" y="-18" textAnchor="middle" className="tabular fill-foreground text-[34px] font-semibold">
          {current ? current.count : total}
        </text>
        <text x="0" y="2" textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">
          {current ? `${current.label} · ${shareText(current.count, total)} %` : what}
        </text>
      </svg>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {slices.map((slice) => (
          <li key={slice.id}>
            <Link
              href={slice.href}
              onMouseEnter={() => setActive(slice.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(slice.id)}
              onBlur={() => setActive(null)}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active === slice.id && "bg-muted font-medium",
              )}
            >
              {slice.severity ? <SeverityShape severity={slice.severity} /> : <span className="size-2 rounded-full" style={{ background: slice.color }} aria-hidden="true" />}
              {slice.label} <strong className="tabular">{slice.count}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 5. Two rings over the same findings: the outer by severity, the inner by what stage they are at. */
export function Nested({ slices, inner, total, what }: Props & { inner: Slice[] }) {
  const { active, setActive } = useFocusedPart()
  const outerParts = sweep(slices, total)
  const innerParts = sweep(inner, total)
  const current = [...outerParts, ...innerParts].find((part) => part.id === active)
  return (
    <div className={STAGE}>
      <svg viewBox="-120 -120 240 240" className={cn(FRAME, "overflow-visible")} role="group" aria-label={`Two rings of the ${total} ${what}: by severity outside, by status inside`}>
        {outerParts.map((part) => (
          <Wedge key={part.id} slice={part} path={wedge(active === part.id ? 110 : 106, 80, part.start, part.end, 1.5)} what={what} total={total} active={active} onActive={setActive} />
        ))}
        {innerParts.map((part) => (
          <Wedge key={part.id} slice={part} path={wedge(active === part.id ? 75 : 72, 48, part.start, part.end, 2)} what={what} total={total} active={active} onActive={setActive} />
        ))}
        <Centre big={current ? current.count : total} small={current ? current.label : "open findings"} />
      </svg>
      <div className="min-w-0 max-w-md flex-1 space-y-3 self-stretch">
        <Legend heading="Outside · severity" slices={slices} total={total} active={active} onActive={setActive} />
        <Legend heading="Inside · status" slices={inner} total={total} active={active} onActive={setActive} />
      </div>
    </div>
  )
}

/** 6. Equal angles; each petal's AREA is proportional to its count, so a small count is small but still there to select. */
export function Rose({ slices, total, what }: Props) {
  const { active, setActive } = useFocusedPart()
  const shown = slices.filter((slice) => slice.count > 0)
  const most = Math.max(1, ...shown.map((slice) => slice.count))
  const angle = 360 / Math.max(1, shown.length)
  const hole = 18
  const reach = 112
  // A petal's area is (outer² − hole²) × its angle ÷ 2: this outer radius makes it proportional to the count
  const outerFor = (count: number) => Math.sqrt(hole * hole + (count / most) * (reach * reach - hole * hole))
  const current = shown.find((slice) => slice.id === active)
  return (
    <div className={STAGE}>
      <svg viewBox="-120 -120 240 240" className={cn(FRAME, "overflow-visible")} role="group" aria-label={`Rose of the ${total} ${what}`}>
        {shown.map((slice, index) => (
          <Wedge key={slice.id} slice={slice} path={wedge(outerFor(slice.count), hole, index * angle, (index + 1) * angle, 2.5)} what={what} total={total} active={active} onActive={setActive} />
        ))}
        <circle r="17" className="fill-card" aria-hidden="true" />
        <text x="0" y="5" textAnchor="middle" className="tabular fill-foreground text-[13px] font-semibold">
          {current ? current.count : total}
        </text>
      </svg>
      <div className="min-w-0 max-w-md flex-1 self-stretch">
        <p className="mb-2 flex items-center justify-between rounded-[7px] bg-muted px-2.5 py-1.5 text-[13px] font-medium" aria-live="polite">
          <span>{current ? current.label : `All ${what}`}</span>
          <span className="tabular">{current ? `${current.count} · ${shareText(current.count, total)} %` : `${total} in all`}</span>
        </p>
        <Legend slices={slices} total={total} active={active} onActive={setActive} />
      </div>
    </div>
  )
}

/** 7. Rings of progress: how much of its own whole each measure is. Each ring says its own whole. */
export function Rings({ rings }: { rings: Progress[] }) {
  const { active, setActive } = useFocusedPart()
  const router = useRouter()
  const radii = [88, 64, 40]
  const current = rings.find((ring) => ring.id === active)
  return (
    <div className={STAGE}>
      <svg viewBox="-110 -110 220 220" className={FRAME} role="group" aria-label="Rings: how much of its own whole each measure is">
        {rings.map((ring, index) => {
          const radius = radii[index] ?? 40
          const circumference = 2 * Math.PI * radius
          const pct = share(ring.count, ring.of)
          const chosen = active === ring.id
          return (
            <a
              key={ring.id}
              href={ring.href}
              aria-label={`${ring.label}: ${ring.count} ${ring.base}, ${shareText(ring.count, ring.of)} percent. Open them.`}
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                router.push(ring.href)
              }}
              onMouseEnter={() => setActive(ring.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(ring.id)}
              onBlur={() => setActive(null)}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <circle r={radius} fill="none" stroke={ring.color} strokeOpacity="0.16" strokeWidth={chosen ? 17 : 14} />
              <circle
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={chosen ? 17 : 14}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - pct / 100)}
                transform="rotate(-90)"
              />
              {chosen && <circle r={radius} fill="none" stroke="var(--foreground)" strokeWidth="1" strokeDasharray="1 5" />}
            </a>
          )
        })}
        <text x="0" y="-2" textAnchor="middle" className="tabular fill-foreground text-[22px] font-semibold">
          {current ? `${shareText(current.count, current.of)} %` : ""}
        </text>
        <text x="0" y="16" textAnchor="middle" className="tabular fill-muted-foreground text-[12px]">
          {current ? `${current.count} of ${current.of}` : ""}
        </text>
      </svg>
      <div className="min-w-0 max-w-md flex-1 space-y-2 self-stretch">
        {rings.map((ring) => (
          <Link
            key={ring.id}
            href={ring.href}
            onMouseEnter={() => setActive(ring.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(ring.id)}
            onBlur={() => setActive(null)}
            className={cn(
              "block rounded-[8px] border px-3 py-2 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active === ring.id && "bg-muted",
            )}
          >
            <span className="flex items-center justify-between gap-3 text-[13px] font-medium">
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: ring.color }} aria-hidden="true" />
                {ring.label}
              </span>
              <span className="tabular">{shareText(ring.count, ring.of)} %</span>
            </span>
            <span className="tabular mt-0.5 block pl-[18px] text-xs text-muted-foreground">
              {ring.count} {ring.base}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** 8. The categories as an inner ring and their severities as an outer one. A press on a category zooms into it; a part of the outer ring opens its findings. */
export function Sunburst({
  branches,
  what,
  linkFor,
}: {
  branches: Branch[]
  what: string
  linkFor: (code: string, severity?: string) => string
}) {
  const { active, setActive } = useFocusedPart()
  const [zoom, setZoom] = useState<string | null>(null)
  // A zoom into a category the filters have taken away is no zoom
  const zoomed = zoom !== null && branches.some((branch) => branch.id === zoom) ? zoom : null
  const shown = zoomed ? branches.filter((branch) => branch.id === zoomed) : branches
  const total = shown.reduce((sum, branch) => sum + branch.total, 0)
  const inner = sweep(
    shown.map((branch) => ({ ...branch, count: branch.total })),
    total,
  )
  const outer = inner.flatMap((branch) => {
    let at = branch.start
    return branch.parts
      .filter((part) => part.count > 0)
      .map((part) => {
        const start = at
        at += (part.count / total) * 360
        return { ...part, id: `${branch.id}:${part.id}`, label: `${part.label} in ${branch.id}`, href: linkFor(branch.id, part.id), start, end: at }
      })
  })
  const pick = (id: string) => setZoom((now) => (now === id ? null : id))
  const back = () => {
    const was = zoomed
    setZoom(null)
    // The button that was pressed is gone: the keyboard goes to the category that was zoomed
    requestAnimationFrame(() => was && document.querySelector<HTMLElement>(`[data-branch="${was}"]`)?.focus())
  }
  const hovered = inner.find((one) => one.id === active) ?? outer.find((one) => one.id === active)
  const readout = hovered ? { big: "parts" in hovered ? hovered.total : hovered.count, small: hovered.label } : null
  return (
    <div className={STAGE}>
      <svg viewBox="-120 -120 240 240" className={cn(FRAME, "overflow-visible")} role="group" aria-label={`Categories inside, severities outside, of ${total} ${what}`}>
        {inner.map((one) => {
          const middle = polar((76 + 46) / 2, (one.start + one.end) / 2)
          return (
            <g
              key={one.id}
              role="button"
              tabIndex={0}
              aria-pressed={zoomed === one.id}
              aria-label={`${one.label}: ${one.total} of ${total} ${what}. ${zoomed === one.id ? "Press to show every category." : "Press to zoom into this category."}`}
              onClick={() => pick(one.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  pick(one.id)
                }
              }}
              onMouseEnter={() => setActive(one.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(one.id)}
              onBlur={() => setActive(null)}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              style={{ opacity: active !== null && active !== one.id && !active.startsWith(`${one.id}:`) ? 0.6 : 1 }}
            >
              <path d={wedge(76, 46, one.start, one.end, 1.4)} fill={one.color} stroke={active === one.id ? "var(--foreground)" : "var(--card)"} strokeWidth={active === one.id ? 2.5 : 1.5} />
              {one.end - one.start >= 18 && (
                <text x={middle.x} y={middle.y} textAnchor="middle" dominantBaseline="central" className="pointer-events-none text-[12px] font-semibold" style={{ fill: "var(--series-ink)" }}>
                  {one.id.replace(/\D/g, "")}
                </text>
              )}
            </g>
          )
        })}
        {outer.map((one) => (
          <Wedge key={one.id} slice={one} path={wedge(110, 80, one.start, one.end, 1.4)} what={what} total={total} active={active} onActive={setActive} dim={false} />
        ))}
        <text x="0" y="-2" textAnchor="middle" className="tabular fill-foreground text-[24px] font-semibold">
          {readout ? readout.big : total}
        </text>
        <text x="0" y="15" textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">
          {readout ? (readout.small.length > 16 ? `${readout.small.slice(0, 15)}…` : readout.small) : zoomed ? `of ${zoomed}` : "open findings"}
        </text>
      </svg>
      <div className="min-w-0 max-w-md flex-1 space-y-2 self-stretch">
        <p className="flex items-center justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <span>{zoomed ? "One category" : "Inner ring: press to zoom"}</span>
          {zoomed && (
            <button type="button" onClick={back} className="rounded-[5px] px-1 text-link normal-case underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Show all categories
            </button>
          )}
        </p>
        <ul className="space-y-0.5">
          {branches.map((branch) => (
            <li key={branch.id} className="flex items-center gap-1">
              <button
                type="button"
                data-branch={branch.id}
                aria-pressed={zoomed === branch.id}
                onClick={() => pick(branch.id)}
                onMouseEnter={() => setActive(branch.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(branch.id)}
                onBlur={() => setActive(null)}
                className={cn(
                  "flex min-h-7 min-w-0 flex-1 items-center justify-between gap-3 rounded-[6px] px-2 text-left text-[13px] hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  (zoomed === branch.id || active === branch.id) && "bg-muted font-medium",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: branch.color }} aria-hidden="true" />
                  <span className="truncate">{branch.label}</span>
                </span>
                <span className="tabular shrink-0">{branch.total}</span>
              </button>
              <Link
                href={linkFor(branch.id)}
                aria-label={`Open the ${branch.total} findings of ${branch.label}`}
                className="grid size-7 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t pt-2">
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Outer ring: severity, a part opens its findings</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
            {COUNTED.map((severity) => (
              <li key={severity} className="inline-flex items-center gap-1.5">
                <SeverityShape severity={severity as Severity} />
                {SEVERITY_LABEL[severity as Severity]}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
