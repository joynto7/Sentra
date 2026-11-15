"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"

/**
 * The dark band of the page: how single weaknesses combine into one attack path. It plays once, when it
 * scrolls into view: a planted document, the model, the tool and the customer records light up one
 * after the other along a red line, the path is named, and then the fix turns the line blue. The story
 * is told twice, as the picture and as the numbered sentences beside it, and the sentences are what a
 * screen reader gets (the picture is hidden from it). Nothing loops. "Replay" plays it again; with the
 * system's "reduce motion" setting the finished path shows at once and there is no replay.
 * The sample is fictional and the caption says so.
 */

const STEPS = [
  { stage: 1, text: "A document carries a hidden instruction." },
  { stage: 2, text: "The model makes the tool fetch too much." },
  { stage: 3, text: "Customer records leave." },
  { stage: 5, text: "A person approves the fix. The retest closes it." },
] as const

type NodeId = "doc" | "prompt" | "model" | "tool" | "data"
type Layout = {
  width: number
  height: number
  box: { w: number; h: number }
  nodes: Record<NodeId, { x: number; y: number; name: string; kind: string }>
  edges: { id: string; d: string; ax: number; ay: number; angle: number; from?: NodeId; to: NodeId; attack: boolean; stage: number }[]
}

const NAMES = {
  doc: ["Support articles", "Knowledge source"],
  prompt: ["System prompt", "Instructions"],
  model: ["Language model", "Model"],
  tool: ["Records lookup", "Tool"],
  data: ["Customer records", "Data store"],
} as const

function nodes(at: Record<NodeId, [number, number]>): Layout["nodes"] {
  const out = {} as Layout["nodes"]
  for (const id of Object.keys(at) as NodeId[]) out[id] = { x: at[id][0], y: at[id][1], name: NAMES[id][0], kind: NAMES[id][1] }
  return out
}

/** Wide: the components in three columns, as the product draws a target's profile. */
const WIDE: Layout = {
  width: 580,
  height: 340,
  box: { w: 150, h: 56 },
  nodes: nodes({ doc: [0, 20], prompt: [0, 264], model: [215, 142], tool: [430, 20], data: [430, 264] }),
  edges: [
    { id: "doc-model", d: "M150,48 C182,48 182,170 215,170", ax: 215, ay: 170, angle: 0, to: "model", attack: true, stage: 1 },
    { id: "prompt-model", d: "M150,292 C182,292 182,170 215,170", ax: 215, ay: 170, angle: 0, to: "model", attack: false, stage: 0 },
    { id: "model-tool", d: "M365,170 C397,170 397,48 430,48", ax: 430, ay: 48, angle: 0, to: "tool", attack: true, stage: 2 },
    { id: "tool-data", d: "M505,76 L505,264", ax: 505, ay: 264, angle: 90, to: "data", attack: true, stage: 3 },
  ],
}

/** Narrow: the same path top to bottom, so that the words stay readable on a phone. */
const NARROW: Layout = {
  width: 320,
  height: 430,
  box: { w: 140, h: 56 },
  nodes: nodes({ doc: [10, 6], prompt: [170, 6], model: [90, 130], tool: [90, 250], data: [90, 370] }),
  edges: [
    { id: "doc-model", d: "M80,62 C80,98 130,94 130,130", ax: 130, ay: 130, angle: 90, to: "model", attack: true, stage: 1 },
    { id: "prompt-model", d: "M240,62 C240,98 190,94 190,130", ax: 190, ay: 130, angle: 90, to: "model", attack: false, stage: 0 },
    { id: "model-tool", d: "M160,186 L160,250", ax: 160, ay: 250, angle: 90, to: "tool", attack: true, stage: 2 },
    { id: "tool-data", d: "M160,306 L160,370", ax: 160, ay: 370, angle: 90, to: "data", attack: true, stage: 3 },
  ],
}

const RED = "#ff7a70"
const SKY = "#8fa7ff"
const IDLE = "rgba(255,255,255,0.38)"

function Graph({ layout, stage, motion, className }: { layout: Layout; stage: number; motion: boolean; className: string }) {
  const fixed = stage >= 5
  const tone = (id: NodeId): "red" | "sky" | "idle" => {
    const lit = { doc: 1, model: 2, tool: 3, data: 3, prompt: 99 }[id]
    if (stage >= lit) return fixed ? "sky" : "red"
    return "idle"
  }
  const colour = { red: RED, sky: SKY, idle: IDLE }
  const move = motion ? "300ms ease-out" : "0ms"

  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false" className={className}>
      {layout.edges.map((edge) => {
        const lit = edge.attack && stage >= edge.stage
        const stroke = !edge.attack ? IDLE : fixed ? SKY : RED
        return (
          <g key={edge.id}>
            {/* the plain line, always there */}
            <path d={edge.d} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
            {/* the line that draws itself along the attack path */}
            {edge.attack && (
              <path
                d={edge.d}
                pathLength={1}
                fill="none"
                stroke={stroke}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="1"
                strokeDashoffset={lit ? 0 : 1}
                style={{ transition: motion ? "stroke-dashoffset 800ms ease-out, stroke 400ms ease" : "none" }}
              />
            )}
            <path
              d="M0,0 L-9,-5 L-9,5 Z"
              transform={`translate(${edge.ax} ${edge.ay}) rotate(${edge.angle})`}
              fill={edge.attack ? (lit ? stroke : IDLE) : IDLE}
              style={{ transition: motion ? `fill 400ms ease ${lit ? "700ms" : "0ms"}` : "none" }}
            />
          </g>
        )
      })}

      {(Object.keys(layout.nodes) as NodeId[]).map((id) => {
        const n = layout.nodes[id]
        const t = tone(id)
        return (
          <g key={id}>
            <rect
              x={n.x}
              y={n.y}
              width={layout.box.w}
              height={layout.box.h}
              rx="12"
              fill={t === "red" ? "rgba(255,122,112,0.14)" : t === "sky" ? "rgba(143,167,255,0.14)" : "#0b1b3f"}
              stroke={colour[t]}
              strokeWidth={t === "idle" ? 1 : 1.75}
              style={{ transition: `fill ${move}, stroke ${move}` }}
            />
            <text x={n.x + 14} y={n.y + 24} fontSize="14" fontWeight="500" fill="#ffffff">
              {n.name}
            </text>
            <text x={n.x + 14} y={n.y + 42} fontSize="11.5" fill="#b4c1e6">
              {n.kind}
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
    ;[
      [300, 1],
      [1400, 2],
      [2500, 3],
      [3700, 4],
      [5600, 5],
    ].forEach(([ms, to]) => timers.current.push(window.setTimeout(() => setStage(to), ms)))
  }, [])

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const node = root.current
    if (!node) return
    if (calm) {
      timers.current.push(window.setTimeout(() => (setMotion(false), setStage(4)), 0))
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

  const fixed = stage >= 5

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
                    on ? (index === 3 ? "bg-lp-sky text-lp-navy" : "bg-[#ff7a70] text-lp-navy") : "bg-white/10 text-white/60"
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
        <div className="rounded-2xl border border-white/10 bg-lp-navy-2 p-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.6)] sm:p-6">
          <div aria-hidden="true" className="flex min-h-8 items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">Attack path</p>
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-[opacity,background-color,color] duration-500 motion-reduce:transition-none ${
                fixed ? "bg-lp-sky/20 text-lp-sky" : "bg-[#ff7a70]/20 text-[#ffb0a8]"
              } ${stage >= 4 ? "opacity-100" : "opacity-0"}`}
            >
              {fixed ? "Closed after retest" : "Critical path"}
            </span>
          </div>
          <Graph layout={WIDE} stage={stage} motion={motion} className="mt-3 hidden h-auto w-full sm:block" />
          <Graph layout={NARROW} stage={stage} motion={motion} className="mx-auto mt-3 block h-auto w-full max-w-[22rem] sm:hidden" />
        </div>
        <figcaption className="mt-4 flex items-center justify-between gap-4 text-sm text-[#b4c1e6]">
          <span>Fictional sample data.</span>
          {motion && (
            <button
              type="button"
              onClick={play}
              disabled={!fixed}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-lp-sky outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-lp-sky disabled:pointer-events-none disabled:opacity-0"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Replay
            </button>
          )}
        </figcaption>
      </figure>
    </div>
  )
}
