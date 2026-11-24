"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Play, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The keyframes of the Shield story and of the gateway cards. Every motion here plays a few times
 * at most, or only while the pointer is over a card, so nothing moves on its own for ever
 * (WCAG 2.2.2); anyone who asked their system for less motion gets each scene at its end state
 * (WCAG 2.3.3): the same picture, without the movement.
 */
const CSS = `
@keyframes ss-fly { from { transform: translateX(0) } to { transform: translateX(var(--to)) } }
@keyframes ss-show { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ss-drop { from { opacity: 0; transform: translateY(-34px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ss-slide { from { opacity: 0; transform: translateX(-26px) scale(.9) } to { opacity: 1; transform: translateX(0) scale(1) } }
@keyframes ss-burst { 0% { opacity: .9; transform: scale(.3) } 100% { opacity: 0; transform: scale(2.2) } }
@keyframes ss-hit { 0%, 100% { transform: translateX(0) } 25% { transform: translateX(-3px) } 75% { transform: translateX(3px) } }
@keyframes ss-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ss-flow { to { background-position: 16px 0 } }
.ss-box { transform-box: fill-box; transform-origin: center }
.ss-hold { opacity: 0; animation-fill-mode: forwards }
.ss-card-line { background-image: repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 10px); background-size: 16px 100% }
.group:hover .ss-card-line.ss-live, .group:focus-within .ss-card-line.ss-live { animation: ss-flow .6s linear infinite }
@media (prefers-reduced-motion: reduce) {
  .ss-scene *, .ss-card-line { animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important }
}
`

export function ShieldMotion() {
  return <style>{CSS}</style>
}

const STEPS = [
  {
    short: "Found",
    title: "A weakness is found",
    text: "Sentra's tests reach your app, and one gets through. It becomes a finding, F-001.",
  },
  {
    short: "Approved",
    title: "A person approves a fix",
    text: "Sentra proposes a fix. A person reads it and approves it. Nothing takes effect before that.",
  },
  {
    short: "Enforced",
    title: "The Shield enforces it",
    text: "The gateway stands in front of your app and enforces the approved policy. The attack stops there, and normal requests pass.",
  },
  {
    short: "Verified",
    title: "A retest confirms it",
    text: "Sentra sends the same test again. It is blocked, and the finding is marked fixed and verified.",
  },
] as const

const RED = "var(--severity-critical)"
const BLUE = "var(--primary)"
const GREEN = "var(--success)"

/** What the picture shows at each step, described for people who don't see it. */
const ALT = [
  "Users on the left, your app on the right. A red test packet travels to the app, which turns red and shows finding F-001.",
  "A card named Fix v3 is approved by a person and drops into place in front of the app.",
  "A shield stands in front of the app. A red packet stops at it and bursts, and blue packets pass through to the app.",
  "The shield blocks the same red packet again, and the app turns green with a check: fixed and verified.",
]

function Scene({ step }: { step: number }) {
  const shield = step >= 2
  return (
    <svg viewBox="0 0 760 250" role="img" aria-label={ALT[step]} className="ss-scene h-auto w-full">
      {/* the road between the two */}
      <line x1="104" y1="130" x2="566" y2="130" stroke="var(--border)" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />

      {/* users */}
      <g>
        <circle cx="70" cy="130" r="30" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="2" />
        <circle cx="70" cy="122" r="8" fill="none" stroke="var(--muted-foreground)" strokeWidth="2.5" />
        <path d="M54 146c2-9 10-13 16-13s14 4 16 13" fill="none" stroke="var(--muted-foreground)" strokeWidth="2.5" strokeLinecap="round" />
        <text x="70" y="186" textAnchor="middle" className="fill-text-secondary text-[14px]">
          Users
        </text>
      </g>

      {/* your app */}
      <g>
        <rect
          x="580"
          y="92"
          width="110"
          height="76"
          rx="16"
          fill="var(--card)"
          stroke={step === 0 ? RED : step === 3 ? GREEN : "var(--border-strong)"}
          strokeWidth="3"
          className="ss-box"
          style={step === 0 ? { animation: "ss-hit .5s 2.5s 2" } : undefined}
        />
        <rect x="598" y="110" width="74" height="9" rx="4.5" fill="var(--muted)" />
        <rect x="598" y="127" width="52" height="9" rx="4.5" fill="var(--muted)" />
        <rect x="598" y="144" width="62" height="9" rx="4.5" fill="var(--muted)" />
        <text x="635" y="196" textAnchor="middle" className="fill-text-secondary text-[14px]">
          Your app
        </text>
        {step === 0 && (
          <g className="ss-hold" style={{ animation: "ss-show .4s 2.5s forwards" }}>
            <circle cx="690" cy="92" r="14" fill={RED} />
            <text x="690" y="98" textAnchor="middle" className="fill-white text-[17px] font-bold">
              !
            </text>
            <rect x="540" y="38" width="130" height="30" rx="15" fill="var(--severity-critical-bg)" stroke={RED} />
            <text x="605" y="58" textAnchor="middle" className="text-[14px] font-semibold" fill="var(--severity-critical-text)">
              Finding F-001
            </text>
          </g>
        )}
        {step === 3 && (
          <g className="ss-hold" style={{ animation: "ss-show .4s 1.8s forwards" }}>
            <circle cx="690" cy="92" r="14" fill={GREEN} />
            <path d="M683 92l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="520" y="38" width="150" height="30" rx="15" fill="var(--card)" stroke={GREEN} />
            <text x="595" y="58" textAnchor="middle" className="text-[14px] font-semibold" fill={GREEN}>
              Fixed and verified
            </text>
          </g>
        )}
      </g>

      {/* step 2: the approved fix, and the person who approved it */}
      {step === 1 && (
        <g>
          <g className="ss-hold" style={{ animation: "ss-drop .7s .3s forwards" }}>
            <rect x="330" y="86" width="140" height="88" rx="14" fill="var(--card)" stroke={BLUE} strokeWidth="2.5" />
            <text x="400" y="116" textAnchor="middle" className="fill-foreground text-[16px] font-semibold">
              Fix v3
            </text>
            <rect x="352" y="128" width="96" height="8" rx="4" fill="var(--muted)" />
            <rect x="352" y="144" width="70" height="8" rx="4" fill="var(--muted)" />
          </g>
          <g className="ss-hold" style={{ animation: "ss-show .5s 1.3s forwards" }}>
            <circle cx="400" cy="206" r="16" fill="#c9d2fa" />
            <text x="400" y="211" textAnchor="middle" className="text-[12px] font-bold" fill="#1f2f80">
              AH
            </text>
            <circle cx="419" cy="195" r="9" fill={GREEN} />
            <path d="M414.5 195l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="446" y="211" className="fill-text-secondary text-[14px]">
              Approved by a person
            </text>
          </g>
        </g>
      )}

      {/* the gateway */}
      {shield && (
        <g className="ss-hold ss-box" style={{ animation: "ss-slide .7s .1s forwards" }}>
          <path
            d="M400 88l34 11v26c0 24-15 40-34 48-19-8-34-24-34-48V99z"
            fill="var(--card)"
            stroke={BLUE}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M385 128l11 11 20-23" fill="none" stroke={BLUE} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          <text x="400" y="196" textAnchor="middle" className="fill-text-secondary text-[14px]">
            Sentra Shield
          </text>
          <rect x="362" y="54" width="76" height="24" rx="12" fill="var(--card)" stroke={BLUE} />
          <text x="400" y="70" textAnchor="middle" className="text-[13px] font-semibold" fill={BLUE}>
            Policy v3
          </text>
        </g>
      )}

      {/* normal requests: they pass through the gateway (steps 3 and 4) */}
      {shield &&
        [0, 1, 2].map((i) => (
          <circle
            key={i}
            cx="104"
            cy="130"
            r="7"
            fill={BLUE}
            className="ss-hold"
            style={{
              ["--to" as string]: "462px",
              animation: `ss-fade .01s ${0.4 + i * 1.1}s forwards, ss-fly 2.2s ${0.4 + i * 1.1}s ease-in-out forwards`,
            }}
          />
        ))}

      {/* the test that is not normal */}
      {step === 0 && (
        <path
          d="M104 118l12 12-12 12-12-12z"
          fill={RED}
          className="ss-hold"
          style={{ ["--to" as string]: "464px", animation: "ss-fade .01s .4s forwards, ss-fly 2.1s .4s cubic-bezier(.5,0,.8,.6) forwards" }}
        />
      )}
      {(step === 2 || step === 3) && (
        <>
          <path
            d="M104 118l12 12-12 12-12-12z"
            fill={RED}
            className="ss-hold"
            style={{
              ["--to" as string]: "262px",
              animation: `ss-fade .01s ${step === 2 ? 1.2 : 0.3}s forwards, ss-fly 1.5s ${step === 2 ? 1.2 : 0.3}s ease-in forwards, ss-fade .01s ${step === 2 ? 2.7 : 1.8}s reverse forwards`,
            }}
          />
          <circle
            cx="368"
            cy="130"
            r="26"
            fill="none"
            stroke={RED}
            strokeWidth="3.5"
            className="ss-hold ss-box"
            style={{
              animation: `ss-fade .01s ${step === 2 ? 2.7 : 1.8}s forwards, ss-burst .8s ${step === 2 ? 2.7 : 1.8}s ease-out forwards`,
            }}
          />
          <g className="ss-hold" style={{ animation: `ss-show .4s ${step === 2 ? 2.8 : 1.9}s forwards` }}>
            <rect x="262" y="206" width="84" height="26" rx="13" fill="var(--severity-critical-bg)" stroke={RED} />
            <text x="304" y="224" textAnchor="middle" className="text-[13px] font-semibold" fill="var(--severity-critical-text)">
              Blocked
            </text>
          </g>
        </>
      )}
    </svg>
  )
}

/**
 * The story of the Shield in four pictures: a weakness is found, a person approves a fix, the
 * gateway enforces it, a retest confirms it. It plays once, through, when it first comes into view,
 * and rests on the last picture; the four steps below it are buttons, so anyone can go to one and
 * watch it again.
 */
export function ShieldStory({ className }: { className?: string }) {
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(false)
  const [replays, setReplays] = useState(0)
  const root = useRef<HTMLElement>(null)
  const started = useRef(false)

  const go = useCallback((next: number) => {
    setAuto(false)
    setStep(next)
    setReplays((n) => n + 1)
  }, [])

  // It starts by itself once, when half of it is on the screen, unless motion is not wanted
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
    const timer = window.setTimeout(() => setStep((now) => now + 1), 4800)
    return () => window.clearTimeout(timer)
  }, [auto, step])

  return (
    <section ref={root} aria-labelledby="shield-story" className={cn("mb-5 overflow-hidden rounded-[14px] border bg-card", className)}>
      <ShieldMotion />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="shield-story" className="text-[15px] font-semibold">
          How the Shield protects an application
        </h2>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => go(0)}>
          {step === STEPS.length - 1 ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
          Watch from the start
        </Button>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="bg-[linear-gradient(160deg,#e3e9ff_0%,#f5f8ff_40%,#ffffff_90%)] p-4 dark:bg-[linear-gradient(160deg,#1c2547_0%,#151b30_70%)]">
          <Scene key={`${step}-${replays}`} step={step} />
        </div>

        <div className="flex flex-col justify-between gap-4 p-4">
          <div aria-live="polite">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Step {step + 1} of {STEPS.length}
            </p>
            <h3 className="mt-1 text-lg font-semibold">{STEPS[step].title}</h3>
            <p className="mt-1.5 text-sm text-text-secondary">{STEPS[step].text}</p>
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
                    {index + 1}. {one.short}
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
