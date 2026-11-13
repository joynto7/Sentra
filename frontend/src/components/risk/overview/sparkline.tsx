"use client"

import { useId, useState } from "react"

import { cn } from "@/lib/utils"

export type SparkPoint = { at: string; value: number }

const W = 200
const H = 52
const PAD = 5

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

/**
 * A small line of how one number developed over the period, drawn from the dashboard's own
 * history: no smoothing, no forecast. Point at it, or focus it and press the arrow keys, to read
 * the number at a date; the sentence in its label holds the start and the end for a screen reader,
 * and the readout is announced as it moves.
 */
export function Sparkline({
  points,
  label,
  color = "var(--chart-1)",
  className,
}: {
  points: SparkPoint[]
  /** What the number is: "Awaiting triage" */
  label: string
  color?: string
  className?: string
}) {
  const id = useId()
  const [at, setAt] = useState<number | null>(null)
  if (points.length < 2) return null
  const values = points.map((point) => point.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  const x = (index: number) => PAD + (index / (points.length - 1)) * (W - PAD * 2)
  const y = (value: number) => (high === low ? H / 2 : H - PAD - ((value - low) / span) * (H - PAD * 2))
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ")
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`
  const shown = at ?? points.length - 1
  const first = points[0]
  const last = points[points.length - 1]
  const move = (next: number) => setAt(Math.max(0, Math.min(points.length - 1, next)))
  return (
    <div className={cn("relative", className)}>
      <div
        tabIndex={0}
        role="group"
        aria-label={`${label}: from ${first.value} on ${day(first.at)} to ${last.value} on ${day(last.at)}. Use the left and right arrow keys to read it day by day.`}
        className="rounded-[6px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onKeyDown={(event) => {
          const next = { ArrowLeft: shown - 1, ArrowRight: shown + 1, Home: 0, End: points.length - 1 }[event.key]
          if (next !== undefined) {
            event.preventDefault()
            move(next)
          } else if (event.key === "Escape") setAt(null)
        }}
        onBlur={() => setAt(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          move(Math.round(((event.clientX - box.left) / box.width) * (points.length - 1)))
        }}
        onPointerLeave={() => setAt(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[52px] w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id}-fill)`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {at !== null && <line x1={x(shown)} x2={x(shown)} y1="0" y2={H} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* The dot is HTML so the stretched drawing doesn't squash it */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
          style={{ left: `${(x(shown) / W) * 100}%`, top: `${(y(points[shown].value) / H) * 100}%`, background: color }}
        />
      </div>
      <p className="mt-0.5 flex justify-between text-xs text-muted-foreground" aria-live="polite">
        <span className="tabular">{at === null ? day(first.at) : `${day(points[shown].at)}`}</span>
        <span className="tabular font-medium text-foreground">{at === null ? "" : points[shown].value}</span>
        <span className="tabular">{at === null ? "Now" : ""}</span>
      </p>
    </div>
  )
}
