"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MousePointerClick, Play, RotateCcw } from "lucide-react"

import { ShieldMotion } from "@/components/shield/shield-story"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The four steps of using this page, drawn as a short story and then done for real: each step's
 * button runs that very step on the page below (the chip, the circle, the category, the findings),
 * so the picture is never about something the page can't do. The motion plays once; the steps are
 * buttons; with less motion asked for, each picture is shown at its end.
 */
const CSS = `
@keyframes cs-move { from { transform: translate(0, 0) } to { transform: translate(var(--dx), var(--dy)) } }
@keyframes cs-draw { from { stroke-dashoffset: var(--len) } to { stroke-dashoffset: 0 } }
@keyframes cs-dim { to { opacity: .18 } }
@keyframes cs-pop { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.35) } }
@keyframes cs-slide-x { from { opacity: 0; transform: translateX(46px) } to { opacity: 1; transform: translateX(0) } }
@media (prefers-reduced-motion: reduce) {
  .cs-scene * { animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important }
}
`

const RED = "var(--severity-critical)"
const AMBER = "var(--severity-medium)"
const BLUE = "var(--primary)"

export type StoryStep = {
  title: string
  text: string
  /** What the reader does by hand, in the page's own words */
  byHand: string
  /** The button that does it for them */
  action: string
}

const STEPS: StoryStep[] = [
  {
    title: "Narrow it down",
    text: "Press Critical only. The applications in the red centre stay lit, and the rest dim.",
    byHand: "Press “Critical only” above the radar.",
    action: "Show critical only",
  },
  {
    title: "Pick an application",
    text: "Select a circle. A line joins it to its categories, listed on the right.",
    byHand: "Select a circle on the radar.",
    action: "Pick the riskiest one",
  },
  {
    title: "Open a category",
    text: "Select a category tile. A panel opens with its threats and test suites, and the way to accept a gap.",
    byHand: "Select a tile in the application's panel.",
    action: "Open its first category",
  },
  {
    title: "Follow it to the findings",
    text: "Show the application's categories below, pick one, and follow “Show these findings” to the list.",
    byHand: "Press “Show its categories below”, then select a card.",
    action: "Take me to the findings",
  },
]

const ALT = [
  "The filter chip Critical only is pressed. In the radar below it, the dots outside the red centre dim.",
  "A pointer selects a red circle on the radar. A line draws from it to a panel that lists its categories.",
  "A pointer selects a category tile. A side panel slides in with the category's threats and suites.",
  "A pointer selects a category card on the board. A Show these findings link appears and leads to the list of findings.",
]

function Pointer({ from, to, delay }: { from: [number, number]; to: [number, number]; delay: number }) {
  return (
    <g transform={`translate(${from[0]} ${from[1]})`}>
      <g
        className="ss-hold"
        style={{
          ["--dx" as string]: `${to[0] - from[0]}px`,
          ["--dy" as string]: `${to[1] - from[1]}px`,
          animation: `ss-fade .01s ${delay}s forwards, cs-move 1.1s ${delay}s ease-in-out forwards`,
        }}
      >
        <path d="M0 0v17l4.5-4 3.5 8 3-1.3-3.4-7.7H14z" fill="#fff" stroke="#0b1b3f" strokeWidth="1.4" strokeLinejoin="round" />
      </g>
    </g>
  )
}

function Click({ at, delay }: { at: [number, number]; delay: number }) {
  return (
    <circle
      cx={at[0]}
      cy={at[1]}
      r="16"
      fill="none"
      stroke={BLUE}
      strokeWidth="3"
      className="ss-hold ss-box"
      style={{ animation: `ss-fade .01s ${delay}s forwards, ss-burst .6s ${delay}s ease-out forwards` }}
    />
  )
}

const RINGS: [number, string][] = [
  [34, RED],
  [62, AMBER],
  [88, "var(--border-strong)"],
]

function Radar({ cx, cy, lit }: { cx: number; cy: number; lit?: "critical" }) {
  const dots: { x: number; y: number; ring: "c" | "m" | "o" }[] = [
    { x: -14, y: -12, ring: "c" },
    { x: 18, y: 14, ring: "c" },
    { x: -48, y: 22, ring: "m" },
    { x: 40, y: -42, ring: "m" },
    { x: 70, y: 30, ring: "o" },
    { x: -66, y: -34, ring: "o" },
  ]
  return (
    <g>
      {RINGS.map(([r, colour]) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="var(--card)" fillOpacity="0.5" stroke={colour} strokeWidth="2" />
      ))}
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={cx + d.x}
          cy={cy + d.y}
          r={d.ring === "c" ? 9 : d.ring === "m" ? 7 : 5.5}
          fill={d.ring === "c" ? "var(--severity-critical-bg)" : d.ring === "m" ? "var(--severity-medium-bg)" : "var(--muted)"}
          stroke={d.ring === "c" ? RED : d.ring === "m" ? AMBER : "var(--border-strong)"}
          strokeWidth="2.5"
          className="ss-box"
          style={
            lit === "critical" && d.ring !== "c"
              ? { animation: "cs-dim .5s 1.7s forwards" }
              : lit === "critical"
                ? { animation: "cs-pop .6s 1.7s 2" }
                : undefined
          }
        />
      ))}
    </g>
  )
}

function Tile({ x, y, code, n, tone }: { x: number; y: number; code: string; n: number; tone: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="84"
        height="62"
        rx="12"
        fill={`var(--severity-${tone}-bg)`}
        stroke={`var(--severity-${tone})`}
        strokeWidth="2"
      />
      <text x={x + 10} y={y + 17} className="text-[11px] font-bold" fill={`var(--severity-${tone}-text)`}>
        {code}
      </text>
      <text x={x + 10} y={y + 50} className="text-[26px] font-semibold" fill={`var(--severity-${tone}-text)`}>
        {n}
      </text>
      <text x={x + 36} y={y + 50} className="text-[12px]" fill={`var(--severity-${tone}-text)`}>
        open
      </text>
    </g>
  )
}

function Scene({ step }: { step: number }) {
  return (
    <svg viewBox="0 0 760 250" role="img" aria-label={ALT[step]} className="cs-scene ss-scene h-auto w-full">
      {step === 0 && (
        <>
          {[
            { label: "All apps", x: 196, w: 90 },
            { label: "Critical only", x: 298, w: 120 },
            { label: "Gaps & unverified", x: 430, w: 150 },
          ].map((chip, i) => (
            <g key={chip.label}>
              <rect x={chip.x} y="14" width={chip.w} height="32" rx="16" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="2" />
              <text x={chip.x + chip.w / 2} y="35" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
                {chip.label}
              </text>
              {i < 2 && (
                // the chip that is on: "All apps" at first, "Critical only" once it is pressed
                <g
                  className={i === 1 ? "ss-hold" : undefined}
                  style={i === 1 ? { animation: "ss-fade .25s 1.5s forwards" } : { animation: "ss-fade .25s 1.5s reverse forwards" }}
                >
                  <rect x={chip.x} y="14" width={chip.w} height="32" rx="16" fill={BLUE} stroke={BLUE} strokeWidth="2" />
                  <text x={chip.x + chip.w / 2} y="35" textAnchor="middle" className="text-[13px] font-medium" fill="#fff">
                    {chip.label}
                  </text>
                </g>
              )}
            </g>
          ))}
          <Radar cx={380} cy={150} lit="critical" />
          <Pointer from={[560, 120]} to={[356, 34]} delay={0.4} />
          <Click at={[358, 30]} delay={1.5} />
        </>
      )}

      {step === 1 && (
        <>
          <Radar cx={210} cy={130} />
          <path
            d="M196 118C270 100 330 70 430 76"
            fill="none"
            stroke={RED}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="260"
            style={{ ["--len" as string]: "260", strokeDashoffset: 260, animation: "cs-draw .7s 1.6s ease-out forwards" }}
          />
          <g className="ss-hold" style={{ animation: "cs-slide-x .6s 1.9s forwards" }}>
            <rect x="430" y="28" width="290" height="194" rx="16" fill="var(--card)" stroke={RED} strokeWidth="2.5" />
            <text x="450" y="58" className="fill-foreground text-[16px] font-semibold">
              Your application
            </text>
            <rect x="450" y="68" width="76" height="20" rx="10" fill="var(--severity-critical-bg)" stroke={RED} />
            <text x="488" y="82" textAnchor="middle" className="text-[11px] font-bold" fill="var(--severity-critical-text)">
              HIGH RISK
            </text>
            <Tile x={450} y={104} code="LLM01" n={3} tone="critical" />
            <Tile x={546} y={104} code="LLM06" n={2} tone="critical" />
            <Tile x={642} y={104} code="LLM02" n={1} tone="medium" />
            <rect x="450" y="182" width="120" height="26" rx="13" fill="var(--muted)" />
            <text x="510" y="199" textAnchor="middle" className="fill-foreground text-[12px]">
              Open the target
            </text>
          </g>
          <Pointer from={[330, 210]} to={[196, 124]} delay={0.4} />
          <Click at={[196, 118]} delay={1.5} />
        </>
      )}

      {step === 2 && (
        <>
          <g>
            <rect x="40" y="28" width="320" height="194" rx="16" fill="var(--card)" stroke={RED} strokeWidth="2.5" />
            <text x="60" y="58" className="fill-foreground text-[16px] font-semibold">
              Your application
            </text>
            <Tile x={60} y={78} code="LLM01" n={3} tone="critical" />
            <Tile x={156} y={78} code="LLM06" n={2} tone="critical" />
            <Tile x={252} y={78} code="LLM02" n={1} tone="medium" />
            <rect x="60" y="156" width="270" height="44" rx="12" fill="var(--muted)" fillOpacity="0.6" />
            <text x="75" y="183" className="fill-text-secondary text-[12px]">
              LLM10 · 0 open LLM04 · Not applicable
            </text>
          </g>
          <g className="ss-hold" style={{ animation: "cs-slide-x .6s 1.9s forwards" }}>
            <rect x="400" y="16" width="330" height="218" rx="16" fill="var(--card)" stroke={BLUE} strokeWidth="2.5" />
            <text x="420" y="46" className="fill-foreground text-[16px] font-semibold">
              LLM01 Prompt Injection
            </text>
            <text x="420" y="76" className="fill-muted-foreground text-[11px] font-bold">
              THREATS
            </text>
            <rect x="420" y="84" width="290" height="26" rx="8" fill="var(--muted)" />
            <rect x="420" y="116" width="290" height="26" rx="8" fill="var(--muted)" />
            <text x="420" y="168" className="fill-muted-foreground text-[11px] font-bold">
              TEST SUITES
            </text>
            <rect x="420" y="176" width="150" height="26" rx="8" fill="var(--muted)" />
            <rect x="584" y="196" width="126" height="28" rx="14" fill="none" stroke={BLUE} strokeWidth="2" />
            <text x="647" y="215" textAnchor="middle" className="text-[12px] font-semibold" fill={BLUE}>
              Accept the gap
            </text>
          </g>
          <Pointer from={[300, 214]} to={[96, 120]} delay={0.4} />
          <Click at={[98, 116]} delay={1.5} />
        </>
      )}

      {step === 3 && (
        <>
          {[
            { x: 40, code: "LLM06", n: 5, tone: "critical" },
            { x: 150, code: "LLM01", n: 16, tone: "medium" },
            { x: 260, code: "LLM02", n: 3, tone: "medium" },
          ].map((card, i) => (
            <g key={card.code}>
              <rect
                x={card.x}
                y="22"
                width="100"
                height="104"
                rx="14"
                fill="var(--card)"
                stroke={i === 1 ? BLUE : "var(--border-strong)"}
                strokeWidth={i === 1 ? 3 : 2}
                style={i === 1 ? { animation: "cs-pop .01s 1.5s forwards" } : undefined}
              />
              <text x={card.x + 12} y="44" className="fill-text-secondary text-[11px] font-bold">
                {card.code}
              </text>
              <text x={card.x + 12} y="92" className="fill-foreground text-[32px] font-semibold">
                {card.n}
              </text>
              <text x={card.x + 12} y="112" className="fill-text-secondary text-[12px]">
                open
              </text>
            </g>
          ))}
          <g className="ss-hold" style={{ animation: "ss-show .4s 1.7s forwards" }}>
            <rect x="150" y="142" width="170" height="30" rx="15" fill={BLUE} />
            <text x="235" y="162" textAnchor="middle" className="text-[13px] font-semibold" fill="#fff">
              Show these findings →
            </text>
          </g>
          <path
            d="M320 157C400 157 420 120 470 112"
            fill="none"
            stroke={BLUE}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="200"
            style={{ ["--len" as string]: "200", strokeDashoffset: 200, animation: "cs-draw .6s 2.3s ease-out forwards" }}
          />
          <g className="ss-hold" style={{ animation: "cs-slide-x .6s 2.7s forwards" }}>
            <rect x="470" y="22" width="250" height="196" rx="14" fill="var(--card)" stroke={BLUE} strokeWidth="2.5" />
            <text x="488" y="50" className="fill-foreground text-[15px] font-semibold">
              Findings · LLM01 · open
            </text>
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <rect x="488" y={64 + i * 36} width="214" height="28" rx="8" fill="var(--muted)" />
                <circle cx="502" cy={78 + i * 36} r="5" fill={i < 2 ? RED : AMBER} />
                <rect x="516" y={74 + i * 36} width={150 - i * 14} height="8" rx="4" fill="var(--border-strong)" />
              </g>
            ))}
          </g>
          <Pointer from={[360, 150]} to={[190, 70]} delay={0.4} />
          <Click at={[192, 66]} delay={1.5} />
        </>
      )}
    </svg>
  )
}

/**
 * `onTry(step)` does the step on the page and answers with one sentence about what it did, which is
 * shown under the button; it answers null when there is nothing to do it with.
 */
export function CoverageStory({ onTry, className }: { onTry: (step: number) => string | null; className?: string }) {
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(false)
  const [replays, setReplays] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const started = useRef(false)

  const go = useCallback((next: number) => {
    setAuto(false)
    setStep(next)
    setDone(null)
    setReplays((n) => n + 1)
  }, [])

  useEffect(() => {
    const node = root.current
    if (!node || started.current) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !started.current) {
          started.current = true
          setAuto(true)
        }
      },
      { threshold: 0.5 },
    )
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [])

  useEffect(() => {
    if (!auto || step >= STEPS.length - 1) return
    const timer = window.setTimeout(() => {
      setStep((now) => now + 1)
      setDone(null)
    }, 5200)
    return () => window.clearTimeout(timer)
  }, [auto, step])

  const current = STEPS[step]
  return (
    <section ref={root} aria-labelledby="coverage-story" className={cn("overflow-hidden rounded-[14px] border bg-card", className)}>
      <style>{CSS}</style>
      <ShieldMotion />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="coverage-story" className="text-[15px] font-semibold">
          How to use this page
        </h2>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => go(0)}>
          {step === STEPS.length - 1 ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
          Watch from the start
        </Button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="bg-[linear-gradient(160deg,#e3e9ff_0%,#f5f8ff_40%,#ffffff_90%)] p-4 dark:bg-[linear-gradient(160deg,#1c2547_0%,#151b30_70%)]">
          <Scene key={`${step}-${replays}`} step={step} />
        </div>

        <div className="flex flex-col justify-between gap-4 p-4">
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Step {step + 1} of {STEPS.length}
            </p>
            <h3 className="mt-1 text-lg font-semibold">{current.title}</h3>
            <p className="mt-1.5 text-sm text-text-secondary">{current.text}</p>
            <p className="mt-2 text-xs text-muted-foreground">By hand: {current.byHand}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="h-9 gap-1.5"
                onClick={() => setDone(onTry(step) ?? "There is nothing to do this with yet: no application is verified.")}
              >
                <MousePointerClick aria-hidden="true" />
                {current.action}
              </Button>
            </div>
            <p className="mt-2 min-h-5 text-[13px] text-text-secondary" aria-live="polite">
              {done}
            </p>
          </div>
          <ol className="grid grid-cols-4 gap-1.5" aria-label="Steps of the story">
            {STEPS.map((one, index) => (
              <li key={one.title}>
                <button
                  type="button"
                  onClick={() => go(index)}
                  aria-current={index === step ? "step" : undefined}
                  aria-label={`Step ${index + 1}: ${one.title}`}
                  className={cn(
                    "flex w-full flex-col gap-1.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    index === step ? "bg-primary/10" : "hover:bg-muted",
                  )}
                >
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span
                      className={cn(
                        "block h-full rounded-full bg-primary transition-[width] duration-500",
                        index <= step ? "w-full" : "w-0",
                      )}
                    />
                  </span>
                  <span className="text-xs leading-tight text-text-secondary">
                    {index + 1}. {one.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
