"use client"

import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  Cpu,
  Database,
  Layers,
  type LucideIcon,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  MoveRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Send,
  Undo2,
  Wrench,
} from "lucide-react"

import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Button } from "@/components/ui/button"
import type { AttackPath, PathEdge, PathFinding, PathNode } from "@/lib/risk"
import { cn } from "@/lib/utils"

/** The columns, named as the target's pipeline is: the API's own stage numbers. */
const STAGE_NAME: Record<number, string> = {
  0: "Input",
  1: "Knowledge source",
  2: "System prompt",
  3: "Model",
  4: "Tool",
  5: "Output",
}
const KIND_ICON: Record<string, LucideIcon> = {
  input: MessageSquare,
  knowledge_source: Database,
  system_prompt: ScrollText,
  model: Cpu,
  tool: Wrench,
  output: Send,
}

const MIN_COLUMN = 96
const ROW_GAP = 132
const TOP = 52
const BOTTOM = 112 // the label under the lowest node, and the row of stage names
const ZOOM_STEP = 0.2
const DRAG_START = 4 // px the pointer must travel before a press becomes a drag, so a click stays a click
const NUDGE = 12 // px one arrow key moves a component; Shift moves four times as far
const EDGE = 32 // the least distance a moved component keeps from the edge of the map

/** How far a component was moved from where the layout put it: sideways in columns, down in px. */
type Offset = { dx: number; dy: number }
const NO_OFFSETS: Record<string, Offset> = {}
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))

const AMBER = "var(--severity-high)"
const RED = "var(--severity-critical)"

type Point = { x: number; y: number }

function useReducedMotion() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)")
      query.addEventListener("change", notify)
      return () => query.removeEventListener("change", notify)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  )
}

/** A smooth S between two points: it leaves and arrives level, like the curves of a mind map. */
function curve(from: Point, to: Point) {
  const middle = (from.x + to.x) / 2
  return `M ${from.x} ${from.y} C ${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`
}

type Curve = [Point, Point, Point, Point]

function lerp(p: Point, q: Point, t: number): Point {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
}

/** Cuts a cubic curve at t, into the part before and the part after (de Casteljau). */
function cut(c: Curve, t: number): { left: Curve; right: Curve } {
  const q0 = lerp(c[0], c[1], t)
  const q1 = lerp(c[1], c[2], t)
  const q2 = lerp(c[2], c[3], t)
  const r0 = lerp(q0, q1, t)
  const r1 = lerp(q1, q2, t)
  const s = lerp(r0, r1, t)
  return { left: [c[0], q0, r0, s], right: [s, r1, q2, c[3]] }
}

/** The part of the curve between two nodes that lies between t0 and t1 of it. */
function piece(from: Point, to: Point, t0: number, t1: number): Curve {
  const middle = (from.x + to.x) / 2
  const whole: Curve = [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to]
  return cut(cut(whole, t0).right, (t1 - t0) / (1 - t0)).left
}

/** The point of a curve at t (0 to 1) and the way it points there, as the arrows need. */
function along(c: Curve, t: number) {
  const u = 1 - t
  const x = u ** 3 * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t ** 3 * c[3].x
  const y = u ** 3 * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t ** 3 * c[3].y
  const dx = 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x)
  const dy = 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI }
}

function pathOf(c: Curve) {
  return `M ${c[0].x} ${c[0].y} C ${c[1].x} ${c[1].y}, ${c[2].x} ${c[2].y}, ${c[3].x} ${c[3].y}`
}

/** Roughly how long a curve is, to space the arrows along it. */
function span(c: Curve) {
  let length = 0
  let last = along(c, 0)
  for (let i = 1; i <= 12; i++) {
    const now = along(c, i / 12)
    length += Math.hypot(now.x - last.x, now.y - last.y)
    last = now
  }
  return length
}

/**
 * The stretch of the curve between two nodes that is clear of both, so no arrow ever sits on a
 * node, and the arrows of two curves that meet at a node never touch each other.
 */
function clear(from: Point, to: Point, fromRadius: number, toRadius: number): Curve | null {
  const whole = piece(from, to, 0, 1)
  let t0 = 0
  while (t0 < 1 && Math.hypot(along(whole, t0).x - from.x, along(whole, t0).y - from.y) < fromRadius) t0 += 0.01
  let t1 = 1
  while (t1 > t0 && Math.hypot(along(whole, t1).x - to.x, along(whole, t1).y - to.y) < toRadius) t1 -= 0.01
  return t1 - t0 > 0.02 ? piece(from, to, t0, t1) : null
}

const ARROW = "M -7 -6.5 L 7 0 L -7 6.5 L -3.5 0 Z"
const ARROW_SPACING = 30 // px between two arrows on a curve
const NODE_GAP = 6 // clear space between a node's ring and the first arrow
const ARROW_SPEED = 55 // px per second

type Hop = { id: string; step: number; /** A step of the path, not a component it passes on the way. */ real: boolean }

/**
 * The route as it is drawn. The path lists only the components a finding sits on, but the
 * connections between them go through others (a knowledge source reaches a tool by way of the
 * model), so the curve passes through those too. They are not steps, so they carry the number of
 * the step they lead to.
 */
function drawnRoute(ids: string[], nodes: PathNode[], edges: PathEdge[]): Hop[] {
  const stage = new Map(nodes.map((node) => [node.id, node.stage]))
  const forward = edges.filter((edge) => (stage.get(edge.from) ?? 0) < (stage.get(edge.to) ?? 0))
  const hops: Hop[] = []
  for (const [step, id] of ids.entries()) {
    if (step > 0) {
      // The shortest chain of connections from the step before, and only the ones between.
      const queue: string[][] = [[ids[step - 1]]]
      const seen = new Set([ids[step - 1]])
      let chain: string[] | null = null
      while (queue.length && !chain) {
        const way = queue.shift()!
        for (const edge of forward.filter((one) => one.from === way[way.length - 1])) {
          if (seen.has(edge.to)) continue
          seen.add(edge.to)
          if (edge.to === id) {
            chain = way
            break
          }
          queue.push([...way, edge.to])
        }
      }
      for (const between of chain?.slice(1) ?? []) hops.push({ id: between, step, real: false })
    }
    hops.push({ id, step, real: true })
  }
  return hops
}

/** Below the route first, then above it, then further out: the lanes a column's other nodes take. */
const LANES = [1, -1, 2, -2, 3, -3]

/**
 * Where each component sits: a grid of columns (the pipeline's stages) and lanes. The selected
 * route keeps the middle lane in every column it passes, so it runs straight, and the other
 * components of a column take the lanes above and below it, never the route's own. Without a
 * route, a column is simply centred.
 */
function place(nodes: PathNode[], stages: number[], column: number, hops: Hop[]) {
  const onRoute = new Set(hops.map((hop) => hop.id))
  const stageOf = new Map(nodes.map((node) => [node.id, node.stage]))
  const routeStages = hops.map((hop) => stageOf.get(hop.id) ?? 0)
  const first = Math.min(...routeStages)
  const last = Math.max(...routeStages)
  const lane = new Map<string, number>()
  for (const stage of stages) {
    const here = nodes.filter((node) => node.stage === stage)
    const route = here.filter((node) => onRoute.has(node.id))
    const rest = here.filter((node) => !onRoute.has(node.id))
    if (hops.length > 0 && stage >= first && stage <= last) {
      for (const [row, node] of route.entries()) lane.set(node.id, LANES[row * 2 + 1] ?? 0)
      if (route.length === 1) lane.set(route[0].id, 0)
      for (const [row, node] of rest.entries()) lane.set(node.id, LANES[row] ?? row + 1)
    } else {
      for (const [row, node] of here.entries()) lane.set(node.id, row - (here.length - 1) / 2)
    }
  }
  const lanes = [...lane.values()]
  const lowest = Math.min(...lanes, 0)
  const highest = Math.max(...lanes, 0)
  const at = new Map<string, Point>()
  for (const node of nodes) {
    at.set(node.id, {
      x: column * stages.indexOf(node.stage) + column / 2,
      y: ((lane.get(node.id) ?? 0) - lowest) * ROW_GAP + TOP,
    })
  }
  return { at, height: (highest - lowest) * ROW_GAP + TOP + BOTTOM }
}

/**
 * The target's components and the findings on them, drawn as a map: one column per stage of the
 * pipeline, and the selected attack path as a bright curve from what an attacker can reach to
 * what it can do. The walkthrough moves along that curve step by step, in step with the list
 * beside it. Every component is a button, so the map is reached with a keyboard. A component can
 * be dragged to where the reader wants it, or moved with the arrow keys when it has focus
 * (WCAG 2.5.7: dragging has a single-pointer-free way too). The same paths are written out in the
 * list, so the picture adds nothing a screen reader would miss.
 */
export function PathMap({
  targetName,
  title = "Attack path map",
  noun = "finding",
  itemHref = (code: string) => `/findings/${code}`,
  onPick,
  nodes,
  edges,
  findings,
  selected,
  step,
  playing,
  onStep,
  onToggle,
  onReset,
}: {
  targetName: string
  /** The words in the header pill. */
  title?: string
  /** What the numbers on the circles count: findings of an attack path, or threats of a threat model. */
  noun?: "finding" | "threat"
  /** Where a listed item leads, or null for text only. */
  itemHref?: (code: string) => string | null
  /** A component was picked or put down again, for a page that filters by it. */
  onPick?: (nodeId: string | null) => void
  nodes: PathNode[]
  edges: PathEdge[]
  findings: PathFinding[]
  selected: AttackPath | null
  /** The step the walkthrough is at, or null while the whole route shows. */
  step: number | null
  playing: boolean
  onStep: (index: number) => void
  onToggle: () => void
  onReset: () => void
}) {
  const reduced = useReducedMotion()
  const wrapper = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(720)
  const [room, setRoom] = useState(0)
  const [full, setFull] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const drag = useRef<{ id: string; x: number; y: number; from: Offset; base: Point; moved: boolean } | null>(null)
  const [layout, setLayout] = useState<{ sig: string; offsets: Record<string, Offset> }>({ sig: "", offsets: NO_OFFSETS })
  const [zoom, setZoom] = useState(1)
  const [focus, setFocus] = useState<string | null>(null)
  // The arrows move unless the reader asked for less motion, or stopped them (WCAG 2.2.2).
  const [stopped, setStopped] = useState(false)
  const flowing = !reduced && !stopped

  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const watcher = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
      setRoom(entry.contentRect.height)
    })
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [])

  // The browser can end full screen by itself (Esc), so the button follows what it reports.
  useEffect(() => {
    const follow = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === section.current)
    document.addEventListener("fullscreenchange", follow)
    return () => document.removeEventListener("fullscreenchange", follow)
  }, [])

  const stages = useMemo(() => [...new Set(nodes.map((node) => node.stage))].sort((a, b) => a - b), [nodes])
  const column = Math.max(width / stages.length, MIN_COLUMN) * zoom
  const canvas = column * stages.length
  const byCode = useMemo(() => new Map(findings.map((finding) => [finding.code, finding])), [findings])

  const total = selected ? selected.node_ids.length : 0
  const hops = useMemo(
    () => (selected ? drawnRoute(selected.node_ids, nodes, edges) : []),
    [selected, nodes, edges],
  )
  const { at, height: laidOut } = useMemo(() => place(nodes, stages, column, hops), [nodes, stages, column, hops])
  // What the reader moved belongs to these components: another target's map starts from its layout.
  const sig = useMemo(() => nodes.map((node) => node.id).join("|"), [nodes])
  const offsets = layout.sig === sig ? layout.offsets : NO_OFFSETS
  const moved = Object.keys(offsets).length > 0
  // Where each component is drawn: the layout's place, and the way the reader moved it
  const spot = useMemo(() => {
    const out = new Map<string, Point>()
    for (const [id, point] of at) {
      const offset = offsets[id]
      out.set(
        id,
        offset
          ? {
              x: clamp(point.x + offset.dx * column, EDGE, column * stages.length - EDGE),
              y: Math.max(point.y + offset.dy, EDGE),
            }
          : point,
      )
    }
    return out
  }, [at, offsets, column, stages.length])
  // The map grows with a component moved below the others, and fills the screen in full screen
  const lowest = Math.max(...[...spot.values()].map((point) => point.y), 0)
  const height = Math.max(laidOut, lowest + BOTTOM, full ? room : 0)
  const radius = (nodeId: string) => ((nodes.find((node) => node.id === nodeId)?.findings.length ?? 0) > 0 ? 30 : 26) + NODE_GAP
  const place_of = (nodeId: string) => (selected ? selected.node_ids.indexOf(nodeId) : -1)
  // The route is bright all the way until the walkthrough starts; then what is ahead dims.
  const reached = step === null ? total - 1 : step
  const segments = hops.slice(0, -1).flatMap((from, index) => {
    const a = spot.get(from.id)
    const b = spot.get(hops[index + 1].id)
    const way = a && b ? clear(a, b, radius(from.id), radius(hops[index + 1].id)) : null
    return way ? [{ index, way, step: hops[index + 1].step }] : []
  })
  const focused = nodes.find((node) => node.id === focus) ?? null
  const current = selected && step !== null ? selected.steps[step] : null
  const stageOf = useMemo(() => new Map(nodes.map((node) => [node.id, node.stage])), [nodes])

  const moveTo = (id: string, offset: Offset) =>
    setLayout((now) => ({ sig, offsets: { ...(now.sig === sig ? now.offsets : NO_OFFSETS), [id]: offset } }))
  const start = (event: PointerEvent<HTMLButtonElement>, id: string, base: Point) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id, x: event.clientX, y: event.clientY, from: offsets[id] ?? { dx: 0, dy: 0 }, base, moved: false }
  }
  const dragTo = (event: PointerEvent<HTMLButtonElement>) => {
    const now = drag.current
    if (!now) return
    const sideways = event.clientX - now.x
    const down = event.clientY - now.y
    if (!now.moved && Math.hypot(sideways, down) < DRAG_START) return
    if (!now.moved) setDragging(now.id)
    now.moved = true
    const x = clamp(now.base.x + now.from.dx * column + sideways, EDGE, canvas - EDGE)
    const y = Math.max(now.base.y + now.from.dy + down, EDGE)
    moveTo(now.id, { dx: (x - now.base.x) / column, dy: y - now.base.y })
  }
  const drop = () => {
    // The click that follows a drag must not select the component; onClick sees the flag first, and a
    // press that ends without a click (the pointer let go elsewhere) clears it right after
    setTimeout(() => {
      drag.current = null
    }, 0)
    setDragging(null)
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>, id: string, base: Point) => {
    const keys: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const move = keys[event.key]
    if (!move) return
    event.preventDefault()
    const by = event.shiftKey ? NUDGE * 4 : NUDGE
    const now = offsets[id] ?? { dx: 0, dy: 0 }
    const x = clamp(base.x + now.dx * column + move[0] * by, EDGE, canvas - EDGE)
    const y = Math.max(base.y + now.dy + move[1] * by, EDGE)
    moveTo(id, { dx: (x - base.x) / column, dy: y - base.y })
  }
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void section.current?.requestFullscreen().catch(() => undefined)
  }

  return (
    <section
      ref={section}
      aria-label="The map of the target's components"
      className={cn("min-w-0 overflow-hidden rounded-[10px] border bg-card", full && "flex h-screen flex-col rounded-none border-0")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="inline-flex max-w-full items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 py-1 pr-3.5 pl-3 text-sm font-semibold text-destructive">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-destructive" />
          <span className="truncate">
            {title} · {targetName}
          </span>
        </p>
        <div className="flex items-center gap-1.5" role="group" aria-label="Map controls">
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            disabled={zoom <= 0.8}
            onClick={() => setZoom((z) => Math.max(0.8, +(z - ZOOM_STEP).toFixed(1)))}
          >
            <Minus />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            disabled={zoom >= 1.6}
            onClick={() => setZoom((z) => Math.min(1.6, +(z + ZOOM_STEP).toFixed(1)))}
          >
            <Plus />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={full ? "Leave full screen" : "Show the map full screen"}
            aria-pressed={full}
            disabled={typeof document !== "undefined" && !document.fullscreenEnabled}
            onClick={toggleFull}
          >
            {full ? <Minimize2 /> : <Maximize2 />}
          </Button>
          {(moved || zoom !== 1) && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Put the components back and reset the zoom"
              onClick={() => {
                setLayout({ sig, offsets: NO_OFFSETS })
                setZoom(1)
              }}
            >
              <Undo2 />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={stopped ? "Move the arrows again" : "Stop the moving arrows"}
            aria-pressed={stopped}
            disabled={reduced}
            onClick={() => setStopped((now) => !now)}
          >
            <MoveRight />
          </Button>
          {step !== null && !playing && (
            <Button variant="outline" size="icon" aria-label="Show the whole route again" onClick={onReset}>
              <RotateCcw />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon-lg"
            className="rounded-full"
            aria-label={playing ? "Pause the walkthrough" : "Walk through the path step by step"}
            disabled={!selected || total < 2}
            onClick={onToggle}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
        </div>
      </div>

      <p className="px-3 pb-2 text-xs text-muted-foreground">
        Drag a component to move it, or select it and use the arrow keys (Shift for bigger steps).
      </p>
      <div ref={wrapper} className={cn("border-t", full ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto")}>
        <div className="relative" style={{ width: canvas, height }}>
          <svg width={canvas} height={height} className="absolute inset-0" aria-hidden="true">
            {stages.map((stage, index) => (
              <line
                key={stage}
                x1={column * index + column / 2}
                x2={column * index + column / 2}
                y1={0}
                y2={height - 36}
                stroke="var(--border)"
                strokeDasharray="3 7"
              />
            ))}
            {edges.map((edge) => {
              const a = spot.get(edge.from)
              const b = spot.get(edge.to)
              if (!a || !b || (stageOf.get(edge.from) ?? 0) >= (stageOf.get(edge.to) ?? 0)) return null
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={curve(a, b)}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth={1.5}
                  opacity={selected ? 0.5 : 0.9}
                />
              )
            })}
            {segments.map(({ index, way, step: toward }) => {
              const lit = step === null || toward <= reached
              const count = Math.max(1, Math.floor(span(way) / ARROW_SPACING))
              const seconds = span(way) / ARROW_SPEED
              return (
                <g key={index} opacity={lit ? 1 : 0.4}>
                  {Array.from({ length: count }, (_, n) => {
                    // Evenly spaced along the clear stretch; the moving ones start part-way
                    // round, so the flow is already full when the page opens.
                    const here = along(way, (n + 0.5) / count)
                    return flowing ? (
                      <path key={n} d={ARROW} fill={AMBER}>
                        <animateMotion
                          path={pathOf(way)}
                          dur={`${seconds}s`}
                          begin={`-${(seconds * n) / count}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                        />
                      </path>
                    ) : (
                      <path
                        key={n}
                        d={ARROW}
                        fill={AMBER}
                        transform={`translate(${here.x} ${here.y}) rotate(${here.angle})`}
                      />
                    )
                  })}
                </g>
              )
            })}
          </svg>

          {nodes.map((node) => {
            const base = at.get(node.id)
            const point = spot.get(node.id)
            if (!base || !point) return null
            const position = place_of(node.id)
            const onRoute = position >= 0
            const waypoint = !onRoute && hops.some((hop) => hop.id === node.id)
            const dimmed = selected !== null && !onRoute && !waypoint
            const isCurrent = step !== null && position === step
            const count = node.findings.length
            const Icon = KIND_ICON[node.kind] ?? Layers
            const size = count > 0 ? 60 : 52
            const ring = isCurrent ? RED : count > 0 ? AMBER : onRoute || waypoint ? "var(--primary)" : "var(--border-strong)"
            const tint = isCurrent ? RED : count > 0 ? AMBER : null
            const codes = node.findings.join(", ")
            return (
              <button
                key={node.id}
                type="button"
                aria-pressed={focus === node.id}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${node.label}${count ? `, ${count} ${noun === "threat" ? "" : "open "}${count === 1 ? noun : `${noun}s`}: ${codes}` : `, no ${noun === "threat" ? "" : "open "}${noun}`}${
                  onRoute
                    ? `, step ${position + 1} of ${total} on ${selected?.code}`
                    : waypoint
                      ? `, passed on the way along ${selected?.code}`
                      : ""
                }`}
                onPointerDown={(event) => start(event, node.id, base)}
                onPointerMove={dragTo}
                onPointerUp={drop}
                onPointerCancel={drop}
                onKeyDown={(event) => nudge(event, node.id, base)}
                onClick={() => {
                  // The click that ends a drag is not a choice
                  if (drag.current?.moved) {
                    drag.current = null
                    return
                  }
                  onPick?.(focus === node.id ? null : node.id)
                  setFocus((now) => (now === node.id ? null : node.id))
                  if (onRoute) onStep(position)
                }}
                className={cn(
                  "group absolute flex cursor-grab touch-none flex-col items-center gap-2 rounded-[10px] p-1 select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  dragging === node.id ? "z-10 cursor-grabbing" : "transition-[top] duration-300 motion-reduce:transition-none",
                )}
                style={{
                  left: point.x - Math.min(column - 8, 140) / 2,
                  top: point.y - size / 2 - 4,
                  width: Math.min(column - 8, 140),
                  opacity: dimmed ? 0.55 : 1,
                }}
              >
                <span
                  className="relative grid shrink-0 place-items-center rounded-full border-[3px] transition-transform group-hover:scale-105"
                  style={{
                    width: size,
                    height: size,
                    borderColor: ring,
                    background: tint
                      ? `color-mix(in srgb, ${tint} 14%, var(--card))`
                      : "var(--muted)",
                  }}
                >
                  {isCurrent && (
                    <span
                      aria-hidden="true"
                      className="absolute -inset-2 rounded-full border border-dashed"
                      style={{ borderColor: RED }}
                    />
                  )}
                  <Icon className="size-[22px] text-foreground" aria-hidden="true" />
                  {count > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 -right-1.5 grid size-[22px] place-items-center rounded-full text-xs font-bold text-white ring-2 ring-card"
                      style={{ background: RED }}
                    >
                      {count}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-center text-[13px] leading-tight break-words",
                    dimmed ? "text-muted-foreground" : "font-medium text-foreground",
                  )}
                >
                  {node.name}
                </span>
              </button>
            )
          })}

          {stages.map((stage, index) => (
            <p
              key={stage}
              className="absolute bottom-2 text-center text-xs text-muted-foreground"
              style={{ left: column * index, width: column }}
            >
              {STAGE_NAME[stage] ?? `Stage ${stage + 1}`}
            </p>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-1 divide-y border-t bg-muted/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="min-w-0 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{noun === "threat" ? "Route" : "Active path"}</dt>
          <dd className="mt-0.5 line-clamp-2 text-sm font-semibold" title={selected?.impact}>
            {selected ? `${selected.code} · ${selected.impact}` : "None selected"}
          </dd>
        </div>
        <div className="min-w-0 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Step</dt>
          <dd className="mt-0.5 line-clamp-2 text-sm font-semibold tabular">
            {!selected
              ? "-"
              : current
                ? `${step! + 1} of ${total} · ${current.component.label}`
                : `Whole route, ${total} steps`}
          </dd>
        </div>
        <div className="min-w-0 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{noun === "threat" ? "Highest risk" : "Severity"}</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold">
            {selected ? (
              <>
                <SeverityBadge severity={selected.severity} />
                {noun === "finding" && (
                  <span className="text-xs font-normal text-text-secondary">
                    {selected.has_unconfirmed ? "Depends on an unconfirmed finding" : "All findings confirmed"}
                  </span>
                )}
              </>
            ) : (
              "-"
            )}
          </dd>
        </div>
      </dl>

      {focused && (
        <div className="border-t px-4 py-3" aria-live="polite">
          <p className="text-[13px] font-semibold">{focused.label}</p>
          {!focused.in_profile && (
            <p className="text-xs text-muted-foreground">Not in the Target Profile any more; a finding still names it.</p>
          )}
          {(focused.impact || focused.note) && (
            <p className="mt-0.5 text-[13px] text-text-secondary">{focused.impact || focused.note}</p>
          )}
          {focused.findings.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {focused.findings.map((code) => {
                const finding = byCode.get(code)
                return (
                  <li key={code} className="flex flex-wrap items-center gap-2 text-[13px]">
                    {itemHref(code) ? (
                      <Link href={itemHref(code)!} className="inline-block py-0.5 font-medium text-link hover:underline">
                        {code}
                      </Link>
                    ) : (
                      <span className="py-0.5 font-medium">{code}</span>
                    )}
                    {finding && (
                      <>
                        <span>{finding.title}</span>
                        <SeverityBadge severity={finding.severity} />
                        {finding.unconfirmed && (
                          <span className="rounded border border-dashed border-warning/60 px-1.5 py-0.5 text-xs text-warning">
                            Unconfirmed
                          </span>
                        )}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              No {noun === "threat" ? "" : "open "}{noun} on this component.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
