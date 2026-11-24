"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "cn"

/**
 * The assistant's mark: Sentra's logo that turns into a living orb.
 *
 * `rest="logo"` (the corner button and the top-bar button): at rest it is the Sentra logo, the cobalt
 * rounded square with the shield and check. When the cursor comes near it, or touches it, the square
 * turns into a white and blue orb and the shield melts into two pill eyes; when the cursor leaves it
 * turns back. `rest="orb"` (inside the chat): always the orb.
 *
 * The orb: the eyes follow the cursor, blink to a dash and, touched, squint into tilted dashes;
 * pressed, it swells and sends out a ripple; working (`thinking`), the eyes scan from side to side and
 * a spark circles it. It has three feelings, all shown in the eyes: happy (touched), wonder (pressed) and
 * angry (teased: touched again and again). The drawing is here, the motion in globals.css. For a person who prefers
 * reduced motion everything still changes, at once, and nothing moves by itself.
 */
type Mood = "idle" | "happy" | "wow" | "angry"

// How the anger is triggered.
const TEASE_TOUCHES = 5 // touches (the cursor entering, or a press) within TEASE_WINDOW make it angry
const TEASE_WINDOW = 5000
const ANGRY_FOR = 3200 // after the last touch

// One mouse listener for every mark on the page.
const marks = new Set<HTMLElement>()
let frame = 0
let last: { x: number; y: number } | null = null

function aim() {
  frame = 0
  if (!last) return
  for (const root of marks) {
    const box = root.getBoundingClientRect()
    if (box.width === 0) continue
    const dx = last.x - (box.left + box.width / 2)
    const dy = last.y - (box.top + box.height / 2)
    const distance = Math.hypot(dx, dy) || 1
    // The eyes lean further the nearer the cursor is, and never past the edge of the face.
    const reach = Math.min(1, distance / 220)
    const x = (dx / distance) * reach
    const y = (dy / distance) * reach
    root.style.setProperty("--ex", `${x * 3.6}px`)
    root.style.setProperty("--ey", `${y * 3}px`)
    root.style.setProperty("--er", `${x * 9}deg`)
    root.style.setProperty("--ox", `${x * 0.9}px`)
    root.style.setProperty("--oy", `${y * 0.8}px`)
    // Near enough to wake up: the logo turns into the orb.
    root.toggleAttribute("data-near", distance < box.width * 2 + 50)
  }
}

function onMove(event: PointerEvent) {
  last = { x: event.clientX, y: event.clientY }
  if (!frame) frame = requestAnimationFrame(aim)
}

export function AssistantMark({
  size = 32,
  animated = true,
  thinking = false,
  rest = "orb",
  className,
}: {
  size?: number
  animated?: boolean
  thinking?: boolean
  rest?: "logo" | "orb"
  className?: string
}) {
  const root = useRef<HTMLSpanElement>(null)
  const [mood, setMood] = useState<Mood>("idle")

  // The eyes follow the cursor, and the logo wakes up when it comes near.
  useEffect(() => {
    const el = root.current
    if (!el || !animated || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (marks.size === 0) window.addEventListener("pointermove", onMove, { passive: true })
    marks.add(el)
    return () => {
      marks.delete(el)
      if (marks.size === 0) window.removeEventListener("pointermove", onMove)
    }
  }, [animated])

  // The feelings, from what the pointer does to the mark (or the button it sits in): touched it is
  // happy, pressed it wonders, teased (touched again and again) it is angry for a few seconds.
  useEffect(() => {
    const el = root.current
    if (!el || !animated) return
    const host = el.closest("button, a") ?? el
    let hovering = false
    let touches: number[] = []
    let calm: number | undefined
    const resting = (): Mood => (hovering ? "happy" : "idle")
    const angry = () => calm !== undefined
    // Counts a touch; five within the window make it angry. Returns whether it is angry now.
    const touch = () => {
      const now = Date.now()
      touches = [...touches.filter((t) => now - t < TEASE_WINDOW), now]
      if (touches.length < TEASE_TOUCHES && !angry()) return false
      setMood("angry")
      window.clearTimeout(calm)
      calm = window.setTimeout(() => {
        calm = undefined
        touches = []
        setMood(resting())
      }, ANGRY_FOR)
      return true
    }

    const enter = () => {
      hovering = true
      if (!touch()) setMood("happy")
    }
    const leave = () => {
      hovering = false
      if (!angry()) setMood("idle")
    }
    const down = () => {
      if (!touch()) setMood("wow")
    }
    const up = () => {
      if (!angry()) setMood("happy")
    }
    host.addEventListener("pointerenter", enter)
    host.addEventListener("pointerleave", leave)
    host.addEventListener("pointerdown", down)
    host.addEventListener("pointerup", up)
    return () => {
      host.removeEventListener("pointerenter", enter)
      host.removeEventListener("pointerleave", leave)
      host.removeEventListener("pointerdown", down)
      host.removeEventListener("pointerup", up)
      window.clearTimeout(calm)
    }
  }, [animated])

  const shown = thinking ? "think" : mood
  // It is an orb whenever something is going on; at rest, in the corner, it is the logo.
  const form = thinking || mood !== "idle" ? "orb" : undefined
  const d = Math.round(size * 0.97) // the diameter of the orb; the logo's square has the same size

  const eye = (x: number, side: "l" | "r") => (
    <g className={`orb-eye orb-eye-${side}`}>
      <rect x={x - 2.3} y="19.6" width="4.6" height="9.4" rx="2.3" fill="#2b4fd8" />
    </g>
  )

  return (
    <span
      ref={root}
      aria-hidden="true"
      data-mood={shown}
      data-form={form}
      data-rest={rest}
      className={cn("orb-root relative inline-grid shrink-0 place-items-center", animated && "orb-animated", thinking && "orb-thinking", className)}
      style={{ width: size, height: size }}
    >
      {animated && <span className="orb-glow absolute inset-[6%] rounded-full bg-[#2b4fd8] opacity-25 blur-md" />}

      <span className="orb-body relative block" style={{ width: d, height: d }}>
        {/* the form: a circle, or the logo's rounded square; two fills cross-fade between them */}
        <span className="orb-shape absolute inset-0 block overflow-hidden">
          <span className="orb-fill-logo absolute inset-0 bg-[#2b4fd8]" />
          <span
            className="orb-fill-ball absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 95% 95% at 36% 30%, #ffffff 0%, #ffffff 30%, #a9bcff 55%, #4a6df0 78%, #2b4fd8 100%)",
            }}
          />
        </span>

        <svg viewBox="6 6 52 52" className="absolute inset-0" width={d} height={d}>
          {/* the logo's shield and check, as drawn on the Sentra logo */}
          <g className="orb-shield">
            <g transform="translate(6 6) scale(1.857)">
              <path
                d="M14 6.5 20 8.8v4.6c0 3.9-2.5 6.9-6 8.1-3.5-1.2-6-4.2-6-8.1V8.8l6-2.3Z"
                fill="none"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="m11.2 14 2 2 3.8-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
          <g className="orb-eyes-wrap">
            <g className="orb-eyes">
              {eye(24.6, "l")}
              {eye(39.4, "r")}
            </g>
          </g>

          {/* angry: slanted brows (the eyes slant too, in globals.css) */}
          <g className="orb-x orb-brows" stroke="#1c3ac0" strokeWidth="2.4" strokeLinecap="round" fill="none">
            <path d="M17.5 14.5 L28.2 19.2" />
            <path d="M46.5 14.5 L35.8 19.2" />
          </g>
        </svg>
      </span>

      <svg viewBox="6 6 52 52" className="pointer-events-none absolute" width={d} height={d} overflow="visible">
        <circle className="orb-ripple" cx="32" cy="32" r="26" fill="none" stroke="#2b4fd8" strokeWidth="1.4" />
        {thinking && (
          <g className="orb-orbit" style={{ transformOrigin: "32px 32px", transformBox: "view-box" }}>
            <circle cx="32" cy="3.6" r="2.6" fill="#b794f6" />
            <circle cx="32" cy="3.6" r="5" fill="#b794f6" opacity="0.3" />
          </g>
        )}
      </svg>
    </span>
  )
}

/** The mark beside a message or in a header: always the orb. */
export function AssistantAvatar({
  className,
  size = "md",
  thinking = false,
  animated,
}: {
  className?: string
  size?: "sm" | "md" | "lg"
  thinking?: boolean
  animated?: boolean
}) {
  const px = size === "lg" ? 72 : size === "md" ? 36 : 26
  return <AssistantMark size={px} thinking={thinking} animated={animated ?? size !== "sm"} className={className} />
}
