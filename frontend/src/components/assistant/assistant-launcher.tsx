"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { cn } from "cn"

import { AssistantMark } from "@/components/assistant/assistant-avatar"
import { useAssistant } from "@/components/assistant/assistant-provider"

const nothingToWatch = () => () => {}
const useIsMac = () =>
  useSyncExternalStore(
    nothingToWatch,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  )

/** The assistant's button in the top bar, always in the same place on every page (WCAG 3.2.6). */
export function AssistantButton() {
  const { open, setOpen } = useAssistant()
  const isMac = useIsMac()
  return (
    <button
      id="assistant-launcher"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="Meta+/ Control+/"
      onClick={() => setOpen(!open)}
      className={cn(
        "group mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        open
          ? "border-primary/40 bg-accent text-accent-foreground"
          : "border-border bg-card text-text-secondary hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <AssistantMark size={26} />
      <span className="hidden md:inline">Ask Sentra</span>
      <span className="sr-only md:hidden">Ask Sentra</span>
      <kbd className="pointer-events-none ml-0.5 hidden rounded border px-1.5 font-mono text-[11px] text-muted-foreground xl:inline">
        {isMac ? "⌘/" : "Ctrl /"}
      </kbd>
    </button>
  )
}

const FAB_SIZE = 58
const FAB_MARGIN = 8
const FAB_GAP = 20 // from the corner of the page it calls home
const HOME_AFTER = 30_000 // how long it may stay where it was put before it goes home by itself
const DRAG_THRESHOLD = 5 // pixels the pointer must travel before a press becomes a drag

type Spot = { x: number; y: number }

/** Keeps the button fully inside the window, so it can never be lost off-screen. */
function keepInside(spot: Spot): Spot {
  const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN)
  const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN)
  return {
    x: Math.min(Math.max(FAB_MARGIN, spot.x), maxX),
    y: Math.min(Math.max(FAB_MARGIN, spot.y), maxY),
  }
}

/**
 * Home: the bottom-right corner of the page, where the assistant's panel opens from, so the button and
 * the panel are always on the same side. The toasts sit above it (see the layout).
 */
function homeSpot(): Spot {
  const width = document.documentElement.clientWidth
  return keepInside({ x: width - FAB_SIZE - FAB_GAP, y: window.innerHeight - FAB_SIZE - FAB_GAP })
}

/**
 * The floating button, for the person who looks for a chat in the corner of the page. It lives at
 * the bottom-right of the page. It can be grabbed and put anywhere in the window, but it does not
 * stay there: thirty seconds after it was left it glides back home by itself, and after a reload it
 * is home again. A plain click opens the assistant; a press that travels more than a few pixels is a
 * drag and opens nothing. Dragging is not the only way to move it (WCAG 2.5.7): Alt with the arrow
 * keys moves it from the keyboard (Shift for bigger steps) and Alt+Home sends it home. Nothing
 * depends on it: the assistant also opens from the top bar.
 */
export function AssistantFab() {
  const { open, setOpen } = useAssistant()
  const [home, setHome] = useState<Spot | null>(null) // known after the first paint
  const [spot, setSpot] = useState<Spot | null>(null) // null: at home
  const [dragging, setDragging] = useState(false)
  const grab = useRef<{ dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  // After this long somewhere else, it goes home. Anything the person does to it starts the count again.
  const goHomeLater = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSpot(null), HOME_AFTER)
  }, [])
  const stay = useCallback(() => window.clearTimeout(timer.current), [])

  // Home is where the page's corner is: found after the first paint, and again when the window or the
  // sidebar changes size.
  useEffect(() => {
    const update = () => {
      setHome(homeSpot())
      setSpot((current) => current && keepInside(current))
    }
    update()
    window.addEventListener("resize", update)
    const page = document.querySelector('[data-slot="sidebar-inset"]')
    const watcher = page ? new ResizeObserver(update) : null
    if (page) watcher?.observe(page)
    return () => {
      window.removeEventListener("resize", update)
      watcher?.disconnect()
      window.clearTimeout(timer.current)
    }
  }, [])

  if (open) return null

  const at = spot ?? home

  // Where the button is now, for the start of a drag or a key press.
  const nowAt = (button: HTMLElement): Spot => {
    if (at) return at
    const box = button.getBoundingClientRect()
    return { x: box.left, y: box.top }
  }

  return (
    <button
      type="button"
      aria-label="Ask Sentra"
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+Home"
      title="Ask Sentra · drag to move"
      onClick={() => {
        if (justDragged.current) {
          justDragged.current = false
          return
        }
        setOpen(true)
      }}
      onPointerEnter={stay}
      onPointerLeave={() => spot && !dragging && goHomeLater()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        stay()
        event.currentTarget.setPointerCapture(event.pointerId)
        const from = nowAt(event.currentTarget)
        grab.current = {
          dx: event.clientX - from.x,
          dy: event.clientY - from.y,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        }
      }}
      onPointerMove={(event) => {
        const g = grab.current
        if (!g) return
        if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) < DRAG_THRESHOLD) return
        if (!g.moved) {
          g.moved = true
          setDragging(true)
        }
        setSpot(keepInside({ x: event.clientX - g.dx, y: event.clientY - g.dy }))
      }}
      onPointerUp={() => {
        const g = grab.current
        grab.current = null
        if (g?.moved) {
          justDragged.current = true // the click that follows a drag opens nothing
          setDragging(false)
          goHomeLater()
        }
      }}
      onPointerCancel={() => {
        grab.current = null
        setDragging(false)
      }}
      onKeyDown={(event) => {
        if (!event.altKey) return
        const step = event.shiftKey ? 64 : 16
        const move: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }
        if (event.key === "Home") {
          event.preventDefault()
          stay()
          setSpot(null)
        } else if (move[event.key]) {
          event.preventDefault()
          const from = nowAt(event.currentTarget)
          setSpot(keepInside({ x: from.x + move[event.key][0], y: from.y + move[event.key][1] }))
          goHomeLater()
        }
      }}
      className={cn(
        "fixed top-0 left-0 z-40 touch-none rounded-2xl outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/50 motion-reduce:transition-none",
        dragging ? "scale-110 drop-shadow-xl" : "transition-[scale,translate] duration-700 ease-[cubic-bezier(0.34,1.25,0.64,1)] hover:scale-110 motion-reduce:hover:scale-100 motion-reduce:duration-0",
      )}
      style={{
        // `translate`, not `transform`: it is applied outside the `scale` of a hover, so the hover grows
        // the button around its middle instead of multiplying its distance from the corner. It is
        // animated, so going home is a glide; while it is dragged there is no transition at all.
        translate: at ? `${at.x}px ${at.y}px` : undefined,
        opacity: at ? 1 : 0, // until home is known, so it never jumps from somewhere else
        cursor: dragging ? "grabbing" : "grab",
        width: FAB_SIZE,
        height: FAB_SIZE,
      }}
    >
      <AssistantMark size={FAB_SIZE} />
    </button>
  )
}
