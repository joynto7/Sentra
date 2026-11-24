"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, ChevronLeft, ChevronRight, ListChecks, RefreshCw, ShieldCheck, type LucideIcon } from "lucide-react"

import { STEPS } from "@/components/landing/landing-content"
import { StepPicture } from "@/components/landing/step-pictures"

const ICON: LucideIcon[] = [ShieldCheck, ListChecks, Activity, RefreshCw]

/** The four numbers sit in the middle of four equal parts of the row. */
const NODE_X = [12.5, 37.5, 62.5, 87.5]
const SHORT = ["Register", "Choose", "Run", "Fix"]
const TRAVEL = 650 // ms the light takes to go from one number to the next

const EVERY = 4800 // ms between two swipes
const N = STEPS.length

/** How far card `i` is from the one in front, going the short way round the deck: -2, -1, 0 or 1 (and 2 as -2) */
const offset = (i: number, active: number) => ((((i - active + N / 2) % N) + N) % N) - N / 2

/**
 * The four steps as a deck of cards in space. The one in front faces you; its neighbours stand to either
 * side, turned away and a little smaller and further back, as in a coverflow; the rest wait behind. The
 * deck swipes by itself every few seconds while it is on screen, until it is touched: then it follows a
 * swipe or a drag of the cards, the arrow buttons, the arrow keys, the numbered points on the line above
 * (they are the way to a card, and the one in front is filled) and the dots below. Above the deck a line
 * draws itself across the band with a comet of light running along it. The text is a plain list of the
 * four steps that screen readers get as it is; the pictures are hidden from them. With the system's
 * "reduce motion" setting the deck changes at once, does not swipe by itself, and nothing runs along the
 * line.
 */
export function StepsJourney() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const [seen, setSeen] = useState(false)
  const [hint, setHint] = useState(true) // the "swipe" cue, until the first swipe
  const [spark, setSpark] = useState(0) // the number the light is at or on its way to
  const [travelling, setTravelling] = useState(false) // the light is on its way, so it is shown
  const moving = useRef<number | undefined>(undefined)
  const stage = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  /** The light runs to the number first, and when it gets there the card changes */
  const go = (to: number) => {
    const next = ((to % N) + N) % N
    setHint(false)
    setSpark(next)
    window.clearTimeout(moving.current)
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    setTravelling(!calm)
    moving.current = window.setTimeout(() => (setActive(next), setTravelling(false)), calm ? 0 : TRAVEL)
  }

  useEffect(() => {
    const node = stage.current
    if (!node) return
    const watcher = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.45 })
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [])

  useEffect(() => {
    if (!auto || !seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setTimeout(() => go(active + 1), EVERY)
    return () => window.clearTimeout(id)
  }, [active, auto, seen])

  useEffect(() => () => window.clearTimeout(moving.current), [])

  return (
    <>
      {/* The four numbers, and a light that runs from one to the next: when it gets there the card changes */}
      <div data-reveal className="relative mx-auto mt-12 hidden h-24 max-w-4xl lg:block">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-5 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_18px_6px_rgba(255,255,255,0.65)] motion-reduce:transition-none"
          style={{ left: `${NODE_X[spark]}%`, opacity: travelling ? 1 : 0, transition: `left ${TRAVEL}ms cubic-bezier(0.65, 0, 0.35, 1), opacity 200ms ease` }}
        />
        {NODE_X.map((x, i) => (
          <button
            key={x}
            type="button"
            onClick={() => {
              setAuto(false)
              go(i)
            }}
            aria-label={`Step ${i + 1}: ${STEPS[i].title}`}
            aria-current={i === active ? "step" : undefined}
            className="group absolute top-0 flex -translate-x-1/2 flex-col items-center gap-2 rounded-xl px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-lp-sky"
            style={{ left: `${x}%` }}
          >
            <span
              className={`relative grid size-10 place-items-center rounded-full border text-sm font-semibold transition-[background-color,color,border-color,transform,box-shadow] duration-500 group-hover:scale-110 motion-reduce:transition-none ${
                i === active
                  ? "scale-110 border-white bg-white text-lp-navy shadow-[0_0_30px_-4px_rgba(255,255,255,0.8)]"
                  : "border-lp-sky/50 bg-lp-navy-2 text-lp-sky shadow-[0_0_30px_-6px_rgba(143,167,255,0.7)]"
              }`}
            >
              {i + 1}
            </span>
            <span aria-hidden="true" className={`text-xs font-medium tracking-wider uppercase transition-colors duration-500 motion-reduce:transition-none ${i === active ? "text-white" : "text-lp-sky/70"}`}>
              {SHORT[i]}
            </span>
          </button>
        ))}
      </div>

      {/* The deck */}
      <div
        ref={stage}
        role="group"
        aria-roledescription="carousel"
        aria-label="The four steps"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault()
            setAuto(false)
            go(active + 1)
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            setAuto(false)
            go(active - 1)
          }
        }}
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY }
          setAuto(false)
        }}
        onPointerUp={(event) => {
          const from = start.current
          start.current = null
          if (!from) return
          const dx = event.clientX - from.x
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - from.y)) go(active + (dx < 0 ? 1 : -1))
        }}
        onPointerCancel={() => (start.current = null)}
        data-reveal="scale"
        className="relative mt-6 h-[30rem] cursor-grab touch-pan-y rounded-3xl outline-none select-none focus-visible:ring-2 focus-visible:ring-lp-sky active:cursor-grabbing lg:mt-4"
        style={{ perspective: "1500px" }}
      >
        {/* The light under the deck */}
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 h-16 w-3/5 -translate-x-1/2 rounded-full bg-lp-sky/25 blur-3xl" />

        <ol className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
          {STEPS.map((step, i) => {
            const d = offset(i, active)
            const gone = Math.abs(d) > 1
            const Icon = ICON[i]
            return (
              <li
                key={step.title}
                aria-current={d === 0 ? "step" : undefined}
                aria-hidden={gone ? true : undefined}
                className="absolute top-0 left-1/2 w-[min(82vw,23rem)] -ml-[min(41vw,11.5rem)] transition-[transform,opacity] duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{
                  transform: `translate3d(${d * 76}%, ${gone ? 24 : Math.abs(d) * 10}px, ${-Math.abs(d) * 110}px) rotateY(${d * -32}deg) scale(${d === 0 ? 1 : 0.94})`,
                  opacity: gone ? 0 : d === 0 ? 1 : 0.78,
                  zIndex: 10 - Math.abs(d),
                  pointerEvents: d === 0 ? "auto" : "none",
                }}
              >
                <article
                  onClick={() => d !== 0 && go(i)}
                  className={`flex flex-col rounded-2xl border bg-lp-wash p-5 transition-shadow duration-700 motion-reduce:transition-none ${
                    d === 0 ? "border-white/70 shadow-[0_50px_80px_-30px_rgba(0,0,0,0.75),0_0_60px_-10px_rgba(143,167,255,0.45)]" : "border-lp-line shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl border border-lp-line bg-white shadow-[0_6px_14px_-8px_rgba(43,79,216,0.4)]">
                      <Icon className="size-5 text-primary" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-xs font-medium tracking-wider text-link uppercase">Step {i + 1}</p>
                      <h3 className="text-lg leading-tight font-medium tracking-tight text-lp-ink">{step.title}</h3>
                    </div>
                  </div>
                  <StepPicture index={i} />
                  <p className="mt-5 leading-snug text-lp-ink">{step.outcome}</p>
                </article>
              </li>
            )
          })}
        </ol>

        {/* Arrows at the sides, for those who would rather press than swipe */}
        <button
          type="button"
          onClick={() => (setAuto(false), go(active - 1))}
          aria-label="Previous step"
          className="absolute top-1/2 left-1 z-20 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-lp-sky sm:left-4"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => (setAuto(false), go(active + 1))}
          aria-label="Next step"
          className="absolute top-1/2 right-1 z-20 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-lp-sky sm:right-4"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>

        {/* The cue to swipe, until the deck has moved */}
        {hint && (
          <p aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 text-sm text-[#c5d0ee]">
            <ChevronLeft className="size-4 motion-safe:animate-[lp-nudge-left_1.6s_ease-in-out_infinite]" />
            Swipe
            <ChevronRight className="size-4 motion-safe:animate-[lp-nudge-right_1.6s_ease-in-out_infinite]" />
          </p>
        )}
      </div>

      {/* The dots below */}
      <div className="mt-6 flex justify-center gap-2" role="group" aria-label="Choose a step">
        {STEPS.map((step, i) => (
          <button
            key={step.title}
            type="button"
            onClick={() => (setAuto(false), go(i))}
            aria-label={`Step ${i + 1}`}
            aria-current={i === active ? "step" : undefined}
            className={`h-2 rounded-full outline-none transition-[width,background-color] duration-500 focus-visible:ring-2 focus-visible:ring-lp-sky motion-reduce:transition-none ${
              i === active ? "w-8 bg-lp-sky" : "w-2 bg-white/25 hover:bg-white/45"
            }`}
          />
        ))}
      </div>
    </>
  )
}
