"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { MousePointerClick } from "lucide-react"

/**
 * A piece of the product, drawn by the product's own component and used here as it is used in the app:
 * hover it, click it, change its filters. It is laid out at the size it has in the app (`width`) and then
 * made smaller as a whole to fit the room it has and, if given, a height (`maxHeight`), so that every
 * proportion, colour and animation is the product's. The scale is worked out once, when the piece first
 * appears, and kept: a drawer that opens inside it does not shrink it.
 *
 * What belongs to the app stays in the app: a click on a link inside the piece does not leave this page,
 * it says that the page is in the app and offers the log in. The data is the sample organization's, which
 * is fictional.
 */
export function ScaledProduct({ width, maxHeight, children, className }: { width: number; maxHeight?: number; children: React.ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const scaleRef = useRef<number | null>(null)
  const [fit, setFit] = useState({ scale: 1, left: 0, height: 0 })
  const [ready, setReady] = useState(false) // drawn in the browser only: the product's charts work out their own sizes
  const [note, setNote] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 0)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    const box = outer.current
    const content = inner.current
    if (!ready || !box || !content) return
    const measure = () => {
      const room = box.getBoundingClientRect().width
      const tall = content.offsetHeight || 1
      // The scale is fixed by the first look at the piece (its width and its height then), and by the room after that
      const byWidth = Math.min(1, room / width)
      if (scaleRef.current === null) scaleRef.current = Math.min(byWidth, maxHeight ? maxHeight / tall : 1)
      const scale = Math.min(scaleRef.current, byWidth)
      setFit({ scale, left: Math.max(0, (room - width * scale) / 2), height: tall * scale })
    }
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(box)
    watcher.observe(content)
    return () => watcher.disconnect()
  }, [ready, width, maxHeight])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div ref={outer} className={`relative w-full overflow-hidden ${className ?? ""}`} style={{ height: fit.height || undefined, minHeight: ready ? undefined : (maxHeight ?? 200) }}>
      <div
        ref={inner}
        className="font-sans text-foreground"
        style={{ width, marginLeft: fit.left, transform: `scale(${fit.scale})`, transformOrigin: "top left" }}
        onClickCapture={(event) => {
          // A link of the app: not opened from here
          if ((event.target as HTMLElement).closest("a[href]")) {
            event.preventDefault()
            event.stopPropagation()
            setNote(true)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setNote(false), 4200)
          }
        }}
      >
        {ready ? children : null}
      </div>
      {note && (
        <p
          role="status"
          className="absolute inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 rounded-xl bg-lp-navy px-4 py-2.5 text-sm text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
        >
          <span className="flex items-center gap-2">
            <MousePointerClick className="size-4 text-lp-sky" aria-hidden="true" />
            That page is in the app.
          </span>
          <Link href="/login" className="rounded-md px-2 py-1 font-medium text-lp-sky outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-lp-sky">
            Log in
          </Link>
        </p>
      )}
    </div>
  )
}
