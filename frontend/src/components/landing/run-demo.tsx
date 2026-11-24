"use client"

import { useEffect, useRef, useState } from "react"
import { Pause, Play, Square } from "lucide-react"

import { ProductSidebar } from "@/components/landing/product-sidebar"
import { Button } from "@/components/ui/button"

/**
 * The fourth band of the page: a campaign run in the product's own look, alive. The run counts up its
 * attempts against the budget, the cost and the findings follow, and a short feed of the latest attempts
 * scrolls by; the limits it runs within sit above it. "Pause" and "Stop" are real buttons, as they are
 * in the product's run monitor. It runs while it is on screen: when a cursor has shown the Pause button
 * once (the tour), it ends at the first click, tap or key press, and the buttons are then the person's.
 * A run that is completed or stopped starts again after a moment. The numbered lines beside it light up
 * with the limits, the run and the control. The picture is hidden from screen readers, as the three
 * lines say the same; the buttons are not. With the system's "reduce motion" setting nothing counts by
 * itself and the window shows a run half done. Joynto asked for no "fictional" caption and no pause
 * button on moving pictures (15 Nov 2026), so the page's rule that samples say they are fictional and
 * the WCAG 2.2.2 gap (a pause is there only for this run) are to be recorded in the task note.
 */

const TOTAL = 870 // the budget of the run
const STEP = 6 // attempts per tick
const TICK = 140 // ms between ticks

type Status = "running" | "paused" | "completed" | "stopped"

/** The latest attempts, derived from the count: every 30th attempt is listed, some of them a finding */
function feed(attempts: number) {
  const out: { n: number; leaked: boolean }[] = []
  for (let n = Math.floor(attempts / 30) * 30; n > 0 && out.length < 4; n -= 30) out.push({ n, leaked: (n / 30) % 7 === 3 })
  return out
}
const findingsAt = (attempts: number) => Array.from({ length: Math.floor(attempts / 30) }, (_, i) => i + 1).filter((k) => k % 7 === 3).length

export function RunDemo() {
  const [attempts, setAttempts] = useState(0)
  const [status, setStatus] = useState<Status>("running")
  const [live, setLive] = useState(false) // on screen and allowed to move
  const [calm, setCalm] = useState(false)
  const [cursor, setCursor] = useState({ x: 0, y: 0, on: false, press: false })
  const root = useRef<HTMLElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const toured = useRef(false)

  const at = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms))
  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  const press = (selector: string, then: () => void) => {
    const box = win.current
    const button = box?.querySelector<HTMLElement>(selector)
    if (!box || !button) return
    const w = box.getBoundingClientRect()
    const b = button.getBoundingClientRect()
    setCursor({ x: b.left - w.left + b.width * 0.5, y: b.top - w.top + b.height * 0.6, on: true, press: false })
    at(1100, () => setCursor((now) => ({ ...now, press: true })))
    at(1300, () => (setCursor((now) => ({ ...now, press: false })), then()))
  }

  const stopTour = () => {
    if (timers.current.length === 0) return
    clearTimers()
    setCursor((now) => ({ ...now, on: false, press: false }))
  }

  // On screen: run. Off screen: hold. Reduced motion: a run half done and nothing moves.
  useEffect(() => {
    const node = root.current
    if (!node) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => (setCalm(true), setAttempts(540)), 0)
      return () => window.clearTimeout(id)
    }
    const watcher = new IntersectionObserver(
      ([entry]) => {
        setLive(entry.isIntersecting)
        if (entry.isIntersecting && !toured.current) {
          toured.current = true
          // After a few seconds of running, a cursor presses Pause, then Play, once
          at(5500, () => press('[data-tour="pause"]', () => setStatus("paused")))
          at(9800, () => press('[data-tour="pause"]', () => (setStatus("running"), setCursor((now) => ({ ...now, on: false })))))
        }
      },
      { threshold: 0.4 },
    )
    watcher.observe(node)
    return () => {
      watcher.disconnect()
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, [])

  useEffect(() => {
    if (!live || calm || status !== "running") return
    const id = window.setInterval(() => {
      setAttempts((now) => {
        const next = Math.min(TOTAL, now + STEP)
        if (next >= TOTAL) setStatus("completed")
        return next
      })
    }, TICK)
    return () => window.clearInterval(id)
  }, [live, calm, status])

  // A run that is completed or stopped starts again after a moment
  useEffect(() => {
    if (status !== "completed" && status !== "stopped") return
    const id = window.setTimeout(() => (setAttempts(0), setStatus("running")), 3200)
    return () => window.clearTimeout(id)
  }, [status])

  const pct = (attempts / TOTAL) * 100
  const cost = (attempts * 0.0042).toFixed(2)
  const findings = findingsAt(attempts)
  const chip =
    status === "running"
      ? { label: "Running", style: "border-primary/50 text-primary" }
      : status === "paused"
        ? { label: "Paused", style: "border-warning/60 text-warning" }
        : status === "completed"
          ? { label: "Completed", style: "border-success/40 text-success" }
          : { label: "Stopped", style: "border-border-strong text-muted-foreground" }

  // The three limits as gauges that move with the run
  const running = status === "running"
  const ring = 2 * Math.PI * 42
  const rateShare = running ? (14 + 3 * Math.sin(attempts / 9)) / 30 : 0 // needle between 0 and 30 per minute
  const minutes = 22 * 60 + Math.round((attempts / TOTAL) * 480) // 22:00 at the start, 06:00 at the end of the budget
  const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  const arc = 120 // 22:00 to 06:00 is a third of the day: 120 degrees

  return (
    <div>
      <h2 id="run-title" data-reveal="blur" className="mx-auto max-w-2xl text-center text-3xl leading-tight font-medium tracking-tight text-balance text-lp-ink sm:text-4xl">
        Run it safely.
      </h2>

      {/* The three limits, alive */}
      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        <li data-reveal="scale" data-reveal-delay="100" className="rounded-2xl border border-lp-line bg-lp-wash p-5">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" aria-hidden="true" className="size-24 shrink-0 -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#dfe5f6" strokeWidth="9" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#2b4fd8"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - attempts / TOTAL)}
                style={{ transition: "stroke-dashoffset 140ms linear" }}
              />
            </svg>
            <div>
              <p className="tabular text-2xl font-semibold text-lp-ink">{attempts}</p>
              <p className="text-sm text-lp-muted">of {TOTAL} attempts</p>
            </div>
          </div>
          <p className="mt-4 text-lg font-medium text-lp-ink">A budget</p>
        </li>

        <li data-reveal="scale" data-reveal-delay="220" className="rounded-2xl border border-lp-line bg-lp-wash p-5">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 120 72" aria-hidden="true" className="h-24 w-[7.5rem] shrink-0">
              <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="#dfe5f6" strokeWidth="9" strokeLinecap="round" />
              <path d="M10 62 A50 50 0 0 1 86 20" fill="none" stroke="#2b4fd8" strokeWidth="9" strokeLinecap="round" opacity="0.28" />
              {/* the limit: 18 of 30 per minute */}
              <line x1="86" y1="20" x2="94" y2="12" stroke="#9f1c12" strokeWidth="3" strokeLinecap="round" />
              <g style={{ transform: `rotate(${-90 + 180 * rateShare}deg)`, transformOrigin: "60px 62px", transition: "transform 300ms ease-out" }}>
                <line x1="60" y1="62" x2="60" y2="24" stroke="#0b1220" strokeWidth="3" strokeLinecap="round" />
              </g>
              <circle cx="60" cy="62" r="5" fill="#0b1220" />
            </svg>
            <div>
              <p className="tabular text-2xl font-semibold text-lp-ink">{running ? Math.round(rateShare * 30) : 0}</p>
              <p className="text-sm text-lp-muted">per minute, 18 at most</p>
            </div>
          </div>
          <p className="mt-4 text-lg font-medium text-lp-ink">A rate</p>
        </li>

        <li data-reveal="scale" data-reveal-delay="340" className="rounded-2xl border border-lp-line bg-lp-wash p-5">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" aria-hidden="true" className="size-24 shrink-0">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#dfe5f6" strokeWidth="9" />
              {/* 22:00 to 06:00, the hours the run may use */}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#2b4fd8"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${(ring * arc) / 360} ${ring}`}
                style={{ transform: "rotate(240deg)", transformOrigin: "50px 50px" }}
              />
              <g style={{ transform: `rotate(${330 + arc * (attempts / TOTAL)}deg)`, transformOrigin: "50px 50px", transition: "transform 140ms linear" }}>
                <circle cx="50" cy="8" r="6" fill="#ffffff" stroke="#0b1220" strokeWidth="3" />
              </g>
            </svg>
            <div>
              <p className="tabular text-2xl font-semibold text-lp-ink">{clock}</p>
              <p className="text-sm text-lp-muted">22:00 to 06:00</p>
            </div>
          </div>
          <p className="mt-4 text-lg font-medium text-lp-ink">A time window</p>
        </li>
      </ul>

      <figure ref={root} data-reveal="tilt" data-reveal-delay="150" className="mx-auto mt-6 min-w-0" onPointerDownCapture={stopTour} onKeyDownCapture={stopTour} onFocusCapture={stopTour}>
        <div
          ref={win}
          className="relative mx-auto flex max-w-[56rem] overflow-hidden rounded-2xl border border-lp-line bg-background font-sans shadow-[0_50px_100px_-40px_rgba(43,79,216,0.45)]"
        >
          <ProductSidebar active="Campaigns" collapsed />

          <div className="min-w-0 flex-1 px-4 py-5 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Campaign run R-231</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Customer Support Assistant · Prompt injection suite</p>
              </div>
              <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium ${chip.style}`}>{chip.label}</span>
            </div>

            {/* The numbers of the run */}
            <dl className="mt-4 grid grid-cols-3 gap-2.5">
              {[
                ["Attempts", `${attempts} of ${TOTAL}`],
                ["Cost so far", `$${cost}`],
                ["Findings", String(findings)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-card px-3 py-2.5">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="tabular mt-0.5 text-[15px] font-semibold whitespace-nowrap">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, transition: "width 140ms linear" }} />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="outline"
                data-tour="pause"
                disabled={status === "completed" || status === "stopped"}
                onClick={() => setStatus((now) => (now === "paused" ? "running" : "paused"))}
                className="h-8 px-3"
              >
                {status === "paused" ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                {status === "paused" ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="outline"
                disabled={status === "completed" || status === "stopped"}
                onClick={() => setStatus("stopped")}
                className="h-8 px-3"
              >
                <Square aria-hidden="true" /> Stop
              </Button>
            </div>

            {/* The latest attempts */}
            <div aria-hidden="true" className="mt-4 overflow-hidden rounded-xl border bg-card">
              <p className="border-b px-3.5 py-2 text-xs font-medium text-muted-foreground">Latest attempts</p>
              <ul className="min-h-[7.5rem]">
                {feed(attempts).map((event) => (
                  <li key={event.n} className="flex items-center gap-3 border-b px-3.5 py-2 text-[13px] last:border-b-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-300">
                    <span className="tabular w-20 text-muted-foreground">Attempt {event.n}</span>
                    <span className="flex-1 truncate">{event.leaked ? "System prompt leaked" : "Answer stayed inside the rules"}</span>
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-medium"
                      style={{
                        background: event.leaked ? "var(--severity-critical-bg)" : "var(--severity-low-bg)",
                        color: event.leaked ? "var(--severity-critical-text)" : "var(--severity-low-text)",
                      }}
                    >
                      {event.leaked ? "Finding" : "Blocked"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* The cursor of the tour */}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute top-0 left-0 z-10 size-6 drop-shadow-[0_2px_3px_rgba(11,18,32,0.35)]"
            style={{
              transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${cursor.press ? 0.82 : 1})`,
              opacity: cursor.on ? 1 : 0,
              transition: "transform 900ms cubic-bezier(0.45, 0, 0.2, 1), opacity 300ms ease",
            }}
          >
            <path d="M4 2.5 19 11.5l-6.6 1.7L9.6 20z" fill="#0b1220" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      </figure>
    </div>
  )
}
