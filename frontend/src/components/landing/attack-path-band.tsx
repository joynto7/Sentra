"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Cpu, Database, MessageSquare, ScrollText, Send, Wrench, type LucideIcon } from "lucide-react"

/**
 * The dark band of the page: how single weaknesses combine into one attack path, drawn the way the
 * product draws it on its Attack Paths page: the components of a target as round nodes, the open
 * findings as small red counts, and orange arrows that run along the path from the planted document,
 * through the model, to the tool. It plays when it scrolls into view: the three nodes of the path
 * light up one after the other, then the arrows keep flowing.
 *
 * The picture can be used, as the product's can: a component is chosen with a click, a tap or the
 * keyboard (Tab to it, Enter or Space) and a line below says what it is; it can be dragged to
 * another place, or moved with the arrow keys (Shift for bigger steps), and the lines follow. Escape
 * lets go of the choice. The numbered lines beside it tell the same story. Joynto asked for no pause
 * or replay button and no "fictional" caption under it (15 Nov 2026): with the system's "reduce motion"
 * setting the arrows do not move at all, and the gaps against WCAG 2.2.2 (arrows that flow without a
 * pause) and the page's own rule to say that samples are fictional are to be recorded in the task note.
 */

const STEPS = [
  { stage: 1, text: "A document carries a hidden instruction." },
  { stage: 2, text: "The model makes the tool fetch too much." },
  { stage: 3, text: "Customer records leave." },
] as const

type NodeSpec = { id: string; label: string; kind: string; icon: LucideIcon; x: number; y: number; count?: number; path?: 1 | 3 | "model"; about: string }

type EdgeSpec = { from: string; to: string; path?: 1 | 2 }

type Layout = { width: number; height: number; nodes: NodeSpec[]; edges: EdgeSpec[] }

const R = 22

const ABOUT: Record<string, string> = {
  user: "Where a request arrives.",
  docs: "1 finding: a document carries a hidden instruction.",
  restricted: "1 finding: restricted content could be retrieved.",
  prompt: "2 findings: the instructions can be read back.",
  model: "Follows the hidden instruction.",
  tool: "1 finding: it fetches more than the question asked for.",
  out: "Where the answer leaves the application.",
}

const node = (id: string, label: string, kind: string, icon: LucideIcon, x: number, y: number, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  id,
  label,
  kind,
  icon,
  x,
  y,
  about: ABOUT[id],
  ...extra,
})

const EDGES: EdgeSpec[] = [
  { from: "user", to: "docs" },
  { from: "docs", to: "model", path: 1 },
  { from: "restricted", to: "model" },
  { from: "prompt", to: "model" },
  { from: "model", to: "tool", path: 2 },
  { from: "tool", to: "out" },
]

/** Wide: the product's own left to right order, one column per kind of component. */
const WIDE: Layout = {
  width: 720,
  height: 215,
  nodes: [
    node("user", "User input", "Entry point", MessageSquare, 36, 40),
    node("docs", "Public documents", "Knowledge source", Database, 160, 40, { count: 1, path: 1 }),
    node("restricted", "Restricted documents", "Knowledge source", Database, 160, 150, { count: 1 }),
    node("prompt", "System prompt", "Instructions", ScrollText, 290, 150, { count: 2 }),
    node("model", "Model", "Model", Cpu, 420, 40, { path: "model" }),
    node("tool", "lookup_document", "Tool", Wrench, 550, 40, { count: 1, path: 3 }),
    node("out", "Chat replies", "Output", Send, 684, 40),
  ],
  edges: EDGES,
}

/** Narrow: the same path top to bottom, so that the words stay readable on a phone. */
const NARROW: Layout = {
  width: 320,
  height: 440,
  nodes: [
    node("docs", "Public documents", "Knowledge source", Database, 70, 36, { count: 1, path: 1 }),
    node("restricted", "Restricted documents", "Knowledge source", Database, 250, 36, { count: 1 }),
    node("prompt", "System prompt", "Instructions", ScrollText, 250, 150, { count: 2 }),
    node("model", "Model", "Model", Cpu, 70, 150, { path: "model" }),
    node("tool", "lookup_document", "Tool", Wrench, 70, 264, { count: 1, path: 3 }),
    node("out", "Chat replies", "Output", Send, 70, 378),
  ],
  edges: EDGES.filter((edge) => edge.from !== "user"),
}

const ORANGE = "#d9531e"
const BLUE = "#2b4fd8"
const GREY = "#c4cadb"
const PEACH = "#fdeee6"

type Point = [number, number]

/** A line between two nodes' rims: straight when it is on the path (the arrows run along it), curved otherwise. */
function between(a: Point, b: Point) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = Math.hypot(dx, dy) || 1
  const gap = R + 4
  const from: Point = [a[0] + (dx / length) * gap, a[1] + (dy / length) * gap]
  const to: Point = [b[0] - (dx / length) * gap, b[1] - (dy / length) * gap]
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  const curve = horizontal
    ? `M${from[0]},${from[1]} C${mid[0]},${from[1]} ${mid[0]},${to[1]} ${to[0]},${to[1]}`
    : `M${from[0]},${from[1]} C${from[0]},${mid[1]} ${to[0]},${mid[1]} ${to[0]},${to[1]}`
  return { from, to, curve, length: Math.hypot(to[0] - from[0], to[1] - from[1]), angle: (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI }
}

function Chevrons({ id, line, on, motion }: { id: string; line: ReturnType<typeof between>; on: boolean; motion: boolean }) {
  const gap = 24
  const count = Math.max(0, Math.ceil(line.length / gap) + 2)
  const clip = `clip-${id}`
  return (
    <g transform={`translate(${line.from[0]} ${line.from[1]}) rotate(${line.angle})`} style={{ opacity: on ? 1 : 0, transition: motion ? "opacity 500ms ease" : "none" }}>
      <clipPath id={clip}>
        <rect x="0" y="-8" width={line.length} height="16" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <g
          style={{
            animation: motion ? `lp-flow ${(gap * 0.045).toFixed(2)}s linear infinite` : "none",
                        ["--gap" as string]: `${gap}px`,
          }}
        >
          {Array.from({ length: count }, (_, i) => (
            <path key={i} d="M0,-5 L9,0 L0,5 L2.5,0 Z" transform={`translate(${i * gap - gap + 2} 0)`} fill={ORANGE} />
          ))}
        </g>
      </g>
    </g>
  )
}

function Graph({
  layout,
  name,
  stage,
  motion,
  selected,
  onSelect,
  className,
}: {
  layout: Layout
  name: string
  stage: number
  motion: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  className: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [pos, setPos] = useState<Record<string, Point>>(() => Object.fromEntries(layout.nodes.map((n) => [n.id, [n.x, n.y] as Point])))
  const [focused, setFocused] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const grab = useRef<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)

  const lit = (n: NodeSpec) => (n.path === "model" ? stage >= 2 : typeof n.path === "number" ? stage >= n.path : false)
  const move = motion ? "300ms ease" : "0ms"
  const margin = R + 14

  /** Pointer position in the picture's own units */
  const toPicture = (event: { clientX: number; clientY: number }): Point => {
    const el = svg.current
    const ctm = el?.getScreenCTM()
    if (!el || !ctm) return [0, 0]
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    return [point.x, point.y]
  }
  const keepInside = (p: Point): Point => [
    Math.min(Math.max(margin, p[0]), layout.width - margin),
    Math.min(Math.max(margin, p[1]), layout.height - margin - 12),
  ]

  return (
    <svg ref={svg} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`Attack path map, ${name}`} className={className}>
      {layout.edges.map((edge) => {
        const a = pos[edge.from]
        const b = pos[edge.to]
        if (!a || !b) return null
        const line = between(a, b)
        const touched = selected === edge.from || selected === edge.to || hovered === edge.from || hovered === edge.to
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <path d={edge.path ? `M${line.from[0]},${line.from[1]} L${line.to[0]},${line.to[1]}` : line.curve} fill="none" stroke={touched ? "#8b93a8" : "#e3e7f1"} strokeWidth={touched ? 2 : 1.5} />
            {edge.path && <Chevrons id={`${name}-${edge.from}-${edge.to}`} line={line} on={stage >= edge.path} motion={motion} />}
          </g>
        )
      })}
      {layout.nodes.map((n) => {
        const [x, y] = pos[n.id]
        const on = lit(n)
        const isModel = n.path === "model"
        const onPath = n.path !== undefined
        const stroke = on ? (isModel ? BLUE : ORANGE) : onPath ? GREY : n.count ? "#e8b9a4" : "#d3d8e6"
        const fill = on && !isModel ? PEACH : n.count && !onPath ? "#fdf3ee" : "#ffffff"
        const Icon = n.icon
        const isSelected = selected === n.id
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`${n.label}, ${n.kind}${n.count ? `, ${n.count} ${n.count === 1 ? "finding" : "findings"}` : ""}`}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            style={{ touchAction: "none", cursor: dragging === n.id ? "grabbing" : "pointer", outline: "none" }}
            opacity={onPath ? 1 : n.count ? 0.8 : 0.92}
            onPointerEnter={() => setHovered(n.id)}
            onPointerLeave={() => setHovered((now) => (now === n.id ? null : now))}
            onFocus={() => setFocused(n.id)}
            onBlur={() => setFocused((now) => (now === n.id ? null : now))}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              const p = toPicture(event)
              grab.current = { id: n.id, dx: p[0] - x, dy: p[1] - y, x: event.clientX, y: event.clientY, moved: false }
            }}
            onPointerMove={(event) => {
              const g = grab.current
              if (!g || g.id !== n.id) return
              if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 4) return
              if (!g.moved) setDragging(n.id)
              g.moved = true
              const p = toPicture(event)
              setPos((now) => ({ ...now, [n.id]: keepInside([p[0] - g.dx, p[1] - g.dy]) }))
            }}
            onPointerUp={() => {
              const g = grab.current
              grab.current = null
              setDragging(null)
              if (g?.moved) justDragged.current = true
            }}
            onClick={() => {
              if (justDragged.current) {
                justDragged.current = false
                return
              }
              onSelect(isSelected ? null : n.id)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect(isSelected ? null : n.id)
              } else if (event.key === "Escape") {
                onSelect(null)
              } else {
                const step = event.shiftKey ? 48 : 12
                const delta: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
                const d = delta[event.key]
                if (d) {
                  event.preventDefault()
                  setPos((now) => ({ ...now, [n.id]: keepInside([now[n.id][0] + d[0], now[n.id][1] + d[1]]) }))
                }
              }
            }}
          >
            {(isSelected || focused === n.id) && (
              <circle cx={x} cy={y} r={R + 7} fill="none" stroke={BLUE} strokeWidth={isSelected ? 2.5 : 2} strokeDasharray={isSelected ? undefined : "4 3"} />
            )}
            <circle cx={x} cy={y} r={R} fill={fill} stroke={stroke} strokeWidth={on ? 2.5 : 1.75} style={{ transition: `fill ${move}, stroke ${move}` }} />
            <Icon x={x - 10} y={y - 10} width={20} height={20} strokeWidth={1.75} color={on || !onPath ? "#1b2440" : "#8b93a8"} />
            {n.count !== undefined && (
              <g>
                <circle cx={x + 15} cy={y - 15} r="9" fill={on ? "#9f1c12" : "#d89080"} style={{ transition: `fill ${move}` }} />
                <text x={x + 15} y={y - 11} fontSize="11" fontWeight="600" textAnchor="middle" fill="#ffffff" style={{ pointerEvents: "none" }}>
                  {n.count}
                </text>
              </g>
            )}
            <text x={x} y={y + R + 19} fontSize="13" textAnchor="middle" fontWeight={on || isSelected ? 500 : 400} fill={on || isSelected ? "#0b1220" : "#5b6478"} style={{ pointerEvents: "none" }}>
              {n.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function AttackPathBand() {
  const [stage, setStage] = useState(0)
  const [motion, setMotion] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const root = useRef<HTMLElement>(null)
  const timers = useRef<number[]>([])
  const started = useRef(false)

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  const play = useCallback(() => {
    clear()
    setStage(0)
    setSelected(null)
    setRun((n) => n + 1) // new key: the components go back to where they started
    ;[
      [500, 1],
      [1600, 2],
      [2700, 3],
    ].forEach(([ms, to]) => timers.current.push(window.setTimeout(() => setStage(to), ms)))
  }, [])

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const node = root.current
    if (!node) return
    if (calm) {
      timers.current.push(window.setTimeout(() => (setMotion(false), setStage(3)), 0))
      return clear
    }
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          play()
          watcher.disconnect()
        }
      },
      { threshold: 0.5 },
    )
    watcher.observe(node)
    return () => {
      watcher.disconnect()
      clear()
    }
  }, [play])

  const done = stage >= 3
  const chosen = [...WIDE.nodes].find((n) => n.id === selected)

  return (
    <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-14">
      <div className="lg:col-span-5">
        <h2 id="paths-title" className="text-3xl leading-tight font-medium tracking-tight text-balance text-white sm:text-4xl">
          See how single weaknesses combine.
        </h2>
        <ol className="mt-8 space-y-4 text-lg">
          {STEPS.map((step, index) => {
            const on = stage >= step.stage
            return (
              <li key={step.text} className="flex gap-3.5">
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium transition-colors duration-500 motion-reduce:transition-none ${
                    on ? "bg-[#ff9a6c] text-lp-navy" : "bg-white/10 text-white/60"
                  }`}
                >
                  {index + 1}
                </span>
                <span className={`leading-relaxed transition-colors duration-500 motion-reduce:transition-none ${on ? "text-white" : "text-white/55"}`}>
                  {step.text}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <figure ref={root} className="lg:col-span-7">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white p-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)] sm:p-6">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <p className="text-sm font-medium text-lp-ink">Attack path</p>
            <span
              aria-hidden="true"
              className={`rounded-md bg-[var(--severity-critical-bg)] px-2.5 py-1 text-xs font-medium text-[var(--severity-critical-text)] transition-opacity duration-500 motion-reduce:transition-none ${
                done ? "opacity-100" : "opacity-0"
              }`}
            >
              Critical
            </span>
          </div>
          <Graph key={`w${run}`} layout={WIDE} name="wide" stage={stage} motion={motion} selected={selected} onSelect={setSelected} className="mt-3 hidden h-auto w-full select-none sm:block" />
          <Graph key={`n${run}`} layout={NARROW} name="narrow" stage={stage} motion={motion} selected={selected} onSelect={setSelected} className="mx-auto mt-3 block h-auto w-full max-w-[20rem] select-none sm:hidden" />
          <p aria-live="polite" className="mt-2 min-h-10 rounded-lg bg-lp-wash px-3.5 py-2.5 text-sm text-lp-ink">
            {chosen ? (
              <>
                <span className="font-medium">{chosen.label}.</span> <span className="text-lp-muted">{chosen.about}</span>
              </>
            ) : (
              <span className="text-lp-muted">Choose a component, or drag it.</span>
            )}
          </p>
        </div>
      </figure>
    </div>
  )
}
