"use client"

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  Cpu,
  Database,
  Layers,
  type LucideIcon,
  Maximize2,
  MessageSquare,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Send,
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

const MIN_COLUMN = 118
const ROW_GAP = 132
const TOP = 52
const BOTTOM = 112 // the label under the lowest node, and the row of stage names
const ZOOM_STEP = 0.2

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

/**
 * Where each component sits. One column per stage of the pipeline; a column with several
 * components spreads them above and below its middle, and a single one drifts a little up or
 * down, so the route reads as a curve and not as a ruler.
 */
function place(nodes: PathNode[], stages: number[], column: number) {
  const at = new Map<string, Point>()
  const raw: { id: string; x: number; y: number }[] = []
  for (const [index, stage] of stages.entries()) {
    const here = nodes.filter((node) => node.stage === stage)
    const drift = here.length === 1 ? Math.sin(index * 1.7 + 0.6) * 34 : 0
    for (const [row, node] of here.entries()) {
      raw.push({
        id: node.id,
        x: column * index + column / 2,
        y: drift + (row - (here.length - 1) / 2) * ROW_GAP,
      })
    }
  }
  const lowest = Math.min(...raw.map((one) => one.y), 0)
  const highest = Math.max(...raw.map((one) => one.y), 0)
  for (const one of raw) at.set(one.id, { x: one.x, y: one.y - lowest + TOP })
  return { at, height: highest - lowest + TOP + BOTTOM }
}

/**
 * The target's components and the findings on them, drawn as a map: one column per stage of the
 * pipeline, and the selected attack path as a bright curve from what an attacker can reach to
 * what it can do. The walkthrough moves along that curve step by step, in step with the list
 * beside it. Every component is a button, so the map is reached with a keyboard, and nothing is
 * dragged. The same paths are written out in the list, so the picture adds nothing a screen
 * reader would miss.
 */
export function PathMap({
  targetName,
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
  const id = useId().replace(/:/g, "")
  const reduced = useReducedMotion()
  const wrapper = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [zoom, setZoom] = useState(1)
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const watcher = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [])

  const stages = useMemo(() => [...new Set(nodes.map((node) => node.stage))].sort((a, b) => a - b), [nodes])
  const column = Math.max(width / stages.length, MIN_COLUMN) * zoom
  const canvas = column * stages.length
  const { at, height } = useMemo(() => place(nodes, stages, column), [nodes, stages, column])
  const byCode = useMemo(() => new Map(findings.map((finding) => [finding.code, finding])), [findings])

  const route = selected ? selected.node_ids : []
  const place_of = (nodeId: string) => route.indexOf(nodeId)
  const total = route.length
  // The route is bright all the way until the walkthrough starts; then what is ahead dims.
  const reached = step === null ? total - 1 : step
  const segments = route.slice(0, -1).flatMap((from, index) => {
    const a = at.get(from)
    const b = at.get(route[index + 1])
    return a && b ? [{ index, a, b }] : []
  })
  const arriving = step !== null && step > 0 ? segments[step - 1] : undefined
  const focused = nodes.find((node) => node.id === focus) ?? null
  const current = selected && step !== null ? selected.steps[step] : null

  return (
    <section aria-label="The map of the target's components" className="min-w-0 overflow-hidden rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="inline-flex max-w-full items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 py-1 pr-3.5 pl-3 text-sm font-semibold text-destructive">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-destructive" />
          <span className="truncate">Attack path map · {targetName}</span>
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
          <Button variant="outline" size="icon" aria-label="Fit the map to the window" onClick={() => setZoom(1)}>
            <Maximize2 />
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

      <div ref={wrapper} className="overflow-x-auto border-t">
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
              const a = at.get(edge.from)
              const b = at.get(edge.to)
              if (!a || !b || a.x >= b.x) return null
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
            {segments.map(({ index, a, b }) => {
              const lit = index < reached || step === null
              return (
                <g key={index} opacity={lit ? 1 : 0.4}>
                  <path d={curve(a, b)} fill="none" stroke={AMBER} strokeWidth={11} opacity={0.16} strokeLinecap="round" />
                  <path
                    id={`${id}-seg-${index}`}
                    d={curve(a, b)}
                    fill="none"
                    stroke={AMBER}
                    strokeWidth={4}
                    strokeLinecap="round"
                  />
                </g>
              )
            })}
            {arriving && (
              <g>
                <circle
                  r={9}
                  fill={RED}
                  opacity={0.25}
                  cx={reduced || !playing ? (arriving.a.x + arriving.b.x) / 2 : undefined}
                  cy={reduced || !playing ? (arriving.a.y + arriving.b.y) / 2 : undefined}
                >
                  {playing && !reduced && (
                    <animateMotion key={`${step}`} dur="1.4s" repeatCount="indefinite">
                      <mpath href={`#${id}-seg-${step! - 1}`} />
                    </animateMotion>
                  )}
                </circle>
                <circle
                  r={4.5}
                  fill={RED}
                  cx={reduced || !playing ? (arriving.a.x + arriving.b.x) / 2 : undefined}
                  cy={reduced || !playing ? (arriving.a.y + arriving.b.y) / 2 : undefined}
                >
                  {playing && !reduced && (
                    <animateMotion key={`${step}`} dur="1.4s" repeatCount="indefinite">
                      <mpath href={`#${id}-seg-${step! - 1}`} />
                    </animateMotion>
                  )}
                </circle>
              </g>
            )}
          </svg>

          {nodes.map((node) => {
            const point = at.get(node.id)
            if (!point) return null
            const position = place_of(node.id)
            const onRoute = position >= 0
            const dimmed = selected !== null && !onRoute
            const isCurrent = step !== null && position === step
            const count = node.findings.length
            const Icon = KIND_ICON[node.kind] ?? Layers
            const size = count > 0 ? 60 : 52
            const ring = isCurrent ? RED : count > 0 ? AMBER : onRoute ? "var(--primary)" : "var(--border-strong)"
            const tint = isCurrent ? RED : count > 0 ? AMBER : null
            const codes = node.findings.join(", ")
            return (
              <button
                key={node.id}
                type="button"
                aria-pressed={focus === node.id}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${node.label}${count ? `, ${count} open ${count === 1 ? "finding" : "findings"}: ${codes}` : ", no open finding"}${
                  onRoute ? `, step ${position + 1} of ${total} on ${selected?.code}` : ""
                }`}
                onClick={() => {
                  setFocus((now) => (now === node.id ? null : node.id))
                  if (onRoute) onStep(position)
                }}
                className="group absolute flex flex-col items-center gap-2 rounded-[10px] p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
          <dt className="text-xs font-medium text-muted-foreground">Active path</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold">
            {selected ? `${selected.code} · ${selected.impact}` : "None selected"}
          </dd>
        </div>
        <div className="min-w-0 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Step</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold tabular">
            {!selected
              ? "-"
              : current
                ? `${step! + 1} of ${total} · ${current.component.label}`
                : `Whole route, ${total} steps`}
          </dd>
        </div>
        <div className="min-w-0 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Severity</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold">
            {selected ? (
              <>
                <SeverityBadge severity={selected.severity} />
                <span className="text-xs font-normal text-text-secondary">
                  {selected.has_unconfirmed ? "Depends on an unconfirmed finding" : "All findings confirmed"}
                </span>
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
                    <Link href={`/findings/${code}`} className="inline-block py-0.5 font-medium text-link hover:underline">
                      {code}
                    </Link>
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
            <p className="mt-0.5 text-[13px] text-muted-foreground">No open finding on this component.</p>
          )}
        </div>
      )}
    </section>
  )
}
