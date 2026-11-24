"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Lock, X } from "lucide-react"

import { USE_CASES } from "@/components/landing/landing-content"
import { SAMPLE_COVERAGE, SAMPLE_DASHBOARD } from "@/components/landing/sample-risk"
import { ScaledProduct } from "@/components/landing/scaled-product"
import { buildApps } from "@/components/risk/coverage-model"
import { CoverageRadar } from "@/components/risk/coverage-radar"
import { Flow } from "@/components/risk/overview/flow"
import { Heatmap } from "@/components/risk/overview/heatmap"

/**
 * The use cases as a stage: four roles on the left, and for the one chosen, the product's own screen on the
 * right as a white window and nothing else. The window is the real component with the sample organization's
 * data (fictional), and it works: filters, toggles, hover, the radar's details. Until a mouse moves over it
 * or a key or a tap comes, a cursor plays a short tour in it (presses the buttons the way a person would),
 * and after one pass the stage goes on to the next role. A link into the app does not leave this page: it
 * says the page is in the app. With the system's "reduce motion" setting there is no cursor and no
 * rotation. Cursor and rotation have no pause button (Joynto, 15 Nov 2026): a gap against WCAG 2.2.2 to be
 * recorded in the task note; they stop at the first mouse move, key or tap.
 */

type Move = {
  find: (root: HTMLElement) => HTMLElement | null
  /** ms to stay after the press, so that what it did can be seen */
  hold?: number
  /** press (default) or only rest on it, as a mouse does */
  how?: "press" | "hover"
}

/** The button, radio or link of the window whose name or text matches */
const control = (pattern: RegExp) => (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("button,[role=radio],a[href]")].find((el) => pattern.test(el.getAttribute("aria-label") ?? el.textContent ?? "")) ?? null

const GO = 950 // ms the cursor takes to get to a control (the same as its CSS transition)

/**
 * A product window with a cursor that plays `moves` in it, over and over, while it is on screen and until
 * the visitor takes over. `onPass` is called at the end of each pass (the stage then goes on to the next
 * role); a window with no moves waits `idle` ms instead.
 */
function Demo({ moves, onPass, idle = 7000, children, width, className = "" }: { moves: Move[]; onPass: () => void; idle?: number; children: React.ReactNode; width: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const pass = useRef(onPass)
  const [cursor, setCursor] = useState({ x: 0, y: 0, on: false, press: false })
  const [mine, setMine] = useState(false) // the visitor has taken over
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    pass.current = onPass
  })

  useEffect(() => {
    const node = box.current
    if (!node) return
    const watcher = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.5 })
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [])

  useEffect(() => {
    if (mine || !seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let alive = true
    const ids: number[] = []
    const wait = (ms: number) => new Promise<void>((done) => ids.push(window.setTimeout(done, ms)))
    const run = async () => {
      await wait(900)
      while (alive) {
        for (const move of moves) {
          const root = box.current
          const target = root && move.find(root)
          if (!root || !target) continue
          const from = root.getBoundingClientRect()
          const to = target.getBoundingClientRect()
          setCursor({ x: to.left - from.left + to.width / 2 - 4, y: to.top - from.top + to.height / 2 - 3, on: true, press: false })
          await wait(GO + 100)
          if (!alive) return
          if (move.how === "hover") {
            target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
          } else {
            setCursor((now) => ({ ...now, press: true }))
            await wait(140)
            target.click()
            setCursor((now) => ({ ...now, press: false }))
          }
          await wait(move.hold ?? 600)
          if (move.how === "hover") target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
        }
        if (!alive) return
        setCursor((now) => ({ ...now, on: false }))
        await wait(moves.length ? 1200 : idle)
        if (!alive) return
        pass.current()
        await wait(2000)
      }
    }
    void run()
    return () => {
      alive = false
      ids.forEach((id) => window.clearTimeout(id))
    }
  }, [mine, seen, moves, idle])

  const take = () => {
    setMine(true)
    setCursor((now) => ({ ...now, on: false }))
  }

  return (
    <div
      ref={box}
      className={`relative mx-auto ${className}`}
      onPointerMoveCapture={(event) => event.pointerType === "mouse" && !mine && take()}
      onPointerDownCapture={take}
      onKeyDownCapture={take}
    >
      <ScaledProduct width={width} className="rounded-2xl border border-lp-line bg-background shadow-[0_50px_90px_-45px_rgba(43,79,216,0.55)]">
        {children}
      </ScaledProduct>
      {/* The cursor of the tour */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-0 left-0 z-40 size-6 drop-shadow-[0_2px_3px_rgba(11,18,32,0.35)]"
        style={{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${cursor.press ? 0.82 : 1})`, opacity: cursor.on ? 1 : 0, transition: `transform ${GO}ms cubic-bezier(0.45, 0, 0.2, 1), opacity 300ms ease` }}
      >
        <path d="M4 2.5 19 11.5l-6.6 1.7L9.6 20z" fill="#0b1220" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** The gate in a pipeline: the command line tool, typed out as it would run */
function GateDemo() {
  const lines = [
    ["$ sentra gate run", "text-white"],
    ["running 870 attempts", "text-[#c5d0ee]"],
    ["1 new critical finding", "text-[#ffb4ab]"],
    ["exit code 1", "text-[#ffb4ab]"],
  ] as const
  return (
    <div aria-hidden="true" className="font-mono text-[15px] leading-7">
      {lines.map(([text, colour], i) => (
        <p key={text} className={colour}>
          <span
            className="inline-block overflow-hidden align-bottom whitespace-nowrap motion-safe:animate-[lp-type_700ms_steps(22,end)_both]"
            style={{ ["--n" as string]: text.length, animationDelay: `${300 + i * 750}ms`, animationTimingFunction: `steps(${text.length}, end)` }}
          >
            {text}
          </span>
        </p>
      ))}
      <span className="inline-block h-4 w-2 translate-y-0.5 bg-lp-sky motion-safe:animate-[lp-blink_1s_steps(1)_infinite]" />
    </div>
  )
}

/** What the cursor does in each window; every pass ends where it began */
const TOURS: Record<string, Move[]> = {
  teams: [
    { find: control(/Pause the radar/), hold: 250 },
    { find: control(/^Customer Support Assistant:/), hold: 2200 },
    { find: control(/^Close the details/), hold: 300 },
    { find: control(/Gaps & unverified/), hold: 1500 },
    { find: control(/All apps/), hold: 300 },
    { find: control(/Play the radar/), hold: 0 },
  ],
  developers: [
    { find: control(/^Table$/), hold: 2200 },
    { find: control(/^Chart$/), hold: 1200 },
  ],
  leaders: [
    { find: control(/^Closed$/), hold: 1400 },
    { find: control(/Open the .* closed findings/), how: "hover", hold: 1400 },
    { find: control(/^Net$/), hold: 1400 },
    { find: control(/^New$/), hold: 800 },
  ],
}

/** Security teams: the product's own Framework Coverage radar, drawn with its sample organization */
function Teams({ onPass }: { onPass: () => void }) {
  const apps = useMemo(() => buildApps(SAMPLE_COVERAGE), [])
  const [selected, setSelected] = useState("")
  return (
    <Demo moves={TOURS.teams} onPass={onPass} width={980} className="max-w-[36rem]">
      <div className="p-4">
        <CoverageRadar apps={apps} selected={selected} onSelect={setSelected} onOpenCategory={() => {}} onFocusLanes={() => {}} />
      </div>
    </Demo>
  )
}

/** Developers: the product's own Risk Dashboard flow, from new findings to fixed and verified */
function Developers({ onPass }: { onPass: () => void }) {
  return (
    <Demo moves={TOURS.developers} onPass={onPass} width={900}>
      <div className="p-4">
        <Flow data={SAMPLE_DASHBOARD} filterQuery="" />
      </div>
    </Demo>
  )
}

/** Security leaders: the product's own Risk Dashboard heatmap, new and closed findings by target over time */
function Leaders({ onPass }: { onPass: () => void }) {
  return (
    <Demo moves={[...TOURS.leaders]} onPass={onPass} width={900}>
      <div className="p-4">
        <Heatmap data={SAMPLE_DASHBOARD} />
      </div>
    </Demo>
  )
}

/** Platform and DevOps teams: a release pipeline in which Sentra's gate says no */
function Pipeline({ onPass }: { onPass: () => void }) {
  const stages = [
    ["Build", "ok"],
    ["Test", "ok"],
    ["Sentra gate", "stop"],
    ["Deploy", "wait"],
  ] as const
  return (
    <Demo moves={[]} onPass={onPass} idle={7500} width={900}>
      <div aria-hidden="true" className="p-8">
        <ol className="grid grid-cols-4 gap-4">
          {stages.map(([name, state], i) => (
            <li
              key={name}
              className={`rounded-xl border px-4 py-5 text-base motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-both ${
                state === "ok" ? "border-success/30 bg-success/10 text-lp-ink" : state === "stop" ? "border-destructive/40 bg-destructive/10 text-lp-ink" : "border-lp-line bg-lp-wash text-lp-muted"
              }`}
              style={{ animationDelay: `${200 + i * 450}ms` }}
            >
              <span className="flex items-center gap-2 font-medium">
                {state === "ok" && <Check className="size-5 text-success" />}
                {state === "stop" && <X className="size-5 text-destructive" />}
                {state === "wait" && <Lock className="size-5" />}
                {name}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-xl bg-lp-navy px-6 py-5">
          <GateDemo />
        </div>
      </div>
    </Demo>
  )
}

const VISUAL = [Teams, Developers, Leaders, Pipeline]

export function RolesShowcase() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const next = () => auto && setActive((now) => (now + 1) % USE_CASES.length)

  const Visual = VISUAL[active]

  return (
    <div
      onPointerDownCapture={() => setAuto(false)}
      onKeyDownCapture={() => setAuto(false)}
      className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-center lg:gap-10"
    >
      <ul role="tablist" aria-label="Roles" className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        {USE_CASES.map((useCase, index) => {
          const on = index === active
          return (
            <li key={useCase.title} data-reveal="scale" data-reveal-delay={100 + index * 110}>
              <button
                id={`role-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="role-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0
                  if (!step) return
                  event.preventDefault()
                  const next = (index + step + USE_CASES.length) % USE_CASES.length
                  setActive(next)
                  document.getElementById(`role-tab-${next}`)?.focus()
                }}
                className={`relative w-full overflow-hidden rounded-2xl border p-4 text-left outline-none transition-[background-color,border-color,box-shadow,transform] duration-500 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:p-5 ${
                  on ? "border-primary/40 bg-white shadow-[0_22px_44px_-24px_rgba(43,79,216,0.55)] lg:translate-x-2" : "border-lp-line bg-lp-wash hover:bg-white"
                }`}
              >
                <span className={`block text-sm font-medium ${on ? "text-link" : "text-lp-muted"}`}>{useCase.role}</span>
                <span className="mt-1.5 block text-base leading-snug font-medium tracking-tight text-lp-ink sm:text-lg">{useCase.title}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div id="role-panel" role="tabpanel" aria-labelledby={`role-tab-${active}`} data-reveal="from-right" data-reveal-delay="200" className="min-w-0">
        <div key={active} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3 motion-safe:duration-500">
          <Visual onPass={next} />
        </div>
      </div>
    </div>
  )
}
