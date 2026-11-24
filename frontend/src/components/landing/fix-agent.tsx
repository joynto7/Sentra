"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronRight, CircleCheck, GitPullRequestDraft, RefreshCw } from "lucide-react"

import { SentraLogo } from "@/components/layout/sentra-logo"

/**
 * The third band of the page: the fix, told in the way of an assistant at work. A person asks for a
 * fix, the assistant thinks and proposes one (the changes and their size), a person approves it with
 * a button, and the test runs again and passes. It plays once, when it scrolls into view, with a cursor
 * that presses "Approve fix", and it ends at the first click, tap or key press: the button is real, so
 * the approval can be given by hand and the retest follows. The chat is a log that a screen reader
 * hears as it grows; the cursor is hidden from it. The numbered lines beside it light up with the
 * steps. With the system's "reduce motion" setting there is no cursor, nothing moves by itself and the
 * proposal waits for the button. Joynto asked for no "fictional" caption on the pictures of this page
 * (15 Nov 2026); the page's rule that samples say they are fictional is to be recorded in the task note.
 */

const STEPS = [
  { text: "Ask for a fix.", from: 1 },
  { text: "A person approves it.", from: 6 },
  { text: "It is tested again.", from: 8 },
] as const

const PITCH = 64 // each step is 28 px high with 36 px between

export function FixAgent() {
  const [stage, setStage] = useState(0)
  const [cursor, setCursor] = useState({ x: 0, y: 0, on: false, press: false })
  const root = useRef<HTMLElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const started = useRef(false)

  const at = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms))
  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  /** The proposal is approved: the retest follows, whoever gave the approval */
  const approve = () => {
    clearTimers()
    setCursor((now) => ({ ...now, on: false, press: false }))
    setStage(6)
    at(1100, () => setStage(7))
    at(2900, () => setStage(8))
  }

  const stopTour = () => {
    if (timers.current.length === 0) return
    clearTimers()
    setCursor((now) => ({ ...now, on: false, press: false }))
    setStage((now) => (now >= 6 ? now : Math.max(now, 5))) // a hand on the page: the proposal waits for its button
  }

  useEffect(() => {
    const node = root.current
    if (!node) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return
        started.current = true
        watcher.disconnect()
        if (calm) {
          setStage(5)
          return
        }
        at(500, () => setStage(1))
        at(1500, () => setStage(2))
        at(3300, () => setStage(3))
        at(4500, () => setStage(4))
        at(5500, () => setStage(5))
        at(5700, () => {
          const box = win.current
          const button = box?.querySelector<HTMLElement>('[data-tour="approve"]')
          if (!box || !button) return
          const w = box.getBoundingClientRect()
          const b = button.getBoundingClientRect()
          setCursor({ x: w.width * 0.8, y: w.height * 0.92, on: true, press: false })
          at(120, () => setCursor({ x: b.left - w.left + b.width * 0.45, y: b.top - w.top + b.height * 0.55, on: true, press: false }))
        })
        at(7200, () => setCursor((now) => ({ ...now, press: true })))
        at(7400, approve)
      },
      { threshold: 0.35 },
    )
    watcher.observe(node)
    return () => {
      watcher.disconnect()
      timers.current.forEach((id) => window.clearTimeout(id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tour is set up once
  }, [])

  const lit = STEPS.reduce((n, step, i) => (stage >= step.from ? i : n), -1)
  const rise = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500"

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      <div>
        <h2 id="fix-title" className="text-3xl leading-tight font-medium tracking-tight text-balance text-lp-ink sm:text-4xl">
          Fix it. Then prove it worked.
        </h2>
        <ol className="relative mt-8 flex flex-col gap-9 text-lg">
          <span aria-hidden="true" className="absolute top-[14px] bottom-[14px] left-3 w-px -translate-x-1/2 bg-lp-line" />
          <span
            aria-hidden="true"
            className="absolute top-[14px] left-3 w-px -translate-x-1/2 bg-primary transition-[height] duration-700 ease-in-out motion-reduce:transition-none"
            style={{ height: `${Math.max(lit, 0) * PITCH}px` }}
          />
          {STEPS.map((step, index) => {
            const on = index <= lit
            return (
              <li key={step.text} className="relative flex h-7 items-center gap-3.5">
                <span
                  className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium transition-colors duration-500 motion-reduce:transition-none ${
                    on ? "bg-primary text-primary-foreground" : "bg-lp-line text-lp-muted"
                  }`}
                >
                  {index + 1}
                </span>
                <span className={`transition-colors duration-500 motion-reduce:transition-none ${on ? "text-lp-ink" : "text-lp-muted"}`}>{step.text}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <figure ref={root} className="min-w-0 lg:mt-1" onPointerDownCapture={stopTour} onKeyDownCapture={stopTour} onFocusCapture={stopTour}>
        <div
          ref={win}
          className="relative mx-auto max-w-[40rem] overflow-hidden rounded-2xl border border-lp-line bg-white shadow-[0_50px_100px_-40px_rgba(43,79,216,0.45)]"
        >
          <div className="flex items-center gap-2.5 border-b border-lp-line px-4 py-3">
            <SentraLogo size={24} />
            <p className="text-sm font-medium text-lp-ink">Sentra Assistant</p>
            <span className="ml-auto rounded-md bg-lp-wash px-2 py-0.5 text-xs text-lp-muted">Customer Support Assistant</span>
          </div>

          <div role="log" aria-live="polite" aria-label="Conversation" className="min-h-[25rem] space-y-4 bg-lp-wash px-4 py-5 sm:px-5">
            {stage >= 1 && (
              <div className={`flex justify-end ${rise}`}>
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                  Fix F-002, the planted document.
                </p>
              </div>
            )}

            {stage === 2 && (
              <p className={`flex items-center gap-2 text-sm text-lp-muted ${rise}`}>
                <span className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2].map((n) => (
                    <span key={n} className="size-1.5 rounded-full bg-lp-muted motion-safe:animate-pulse" style={{ animationDelay: `${n * 180}ms` }} />
                  ))}
                </span>
                Thinking…
              </p>
            )}

            {stage >= 3 && (
              <div className={`space-y-3 ${rise}`}>
                <p className="flex items-center gap-1 text-xs text-lp-muted">
                  Worked for 10 sec <ChevronRight className="size-3" aria-hidden="true" />
                </p>
                <p className="text-sm leading-relaxed text-lp-ink">I proposed a fix for the support prompt. Nothing changes until a person approves it.</p>
              </div>
            )}

            {stage >= 4 && (
              <div className={`rounded-xl border border-lp-line bg-white p-3.5 ${rise}`}>
                <p className="text-sm text-lp-ink">
                  <span className="font-medium">Proposed</span> 2 changes <span className="font-medium text-success">+22</span>{" "}
                  <span className="font-medium text-[var(--severity-critical-text)]">−10</span>
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm text-lp-ink">
                  <GitPullRequestDraft className="size-4 shrink-0 text-lp-muted" aria-hidden="true" />
                  <span className="font-medium">Draft</span> Treat retrieved documents as data
                </p>
                <p className="mt-1.5 truncate font-mono text-xs text-lp-muted">main ← fix/f-002-retrieved-documents</p>
              </div>
            )}

            {stage === 5 && (
              <div className={`flex items-center gap-3 ${rise}`}>
                <button
                  type="button"
                  data-tour="approve"
                  onClick={approve}
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Approve fix
                </button>
                <span className="text-xs text-lp-muted">Needs a person.</span>
              </div>
            )}

            {stage >= 6 && (
              <p className={`flex items-center gap-2.5 text-sm font-medium text-lp-ink ${rise}`}>
                <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
                Fix approved by Arif Hossain
              </p>
            )}

            {stage >= 7 && (
              <div className={`rounded-xl border border-lp-line bg-white p-3.5 ${rise}`}>
                <p className="flex items-center gap-2.5 text-sm text-lp-ink">
                  <RefreshCw
                    className={`size-5 shrink-0 text-link ${stage === 7 ? "motion-safe:animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {stage === 7 ? "Testing again…" : <span className="font-medium">Retest passed</span>}
                  {stage >= 8 && <span className="ml-auto text-xs text-lp-muted">3 of 3 attempts blocked</span>}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-lp-line" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: stage >= 8 ? "100%" : "12%", transition: "width 1600ms ease-in-out" }}
                  />
                </div>
              </div>
            )}
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
