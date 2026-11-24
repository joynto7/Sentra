"use client"

import { useEffect, useRef, useState } from "react"

/**
 * A number that runs up (or down) to its value instead of jumping, so a change is seen. Someone who
 * asks for reduced motion gets the value at once. `from` is where it starts the first time.
 */
export function useCountUp(value: number, duration = 700, from = 0): number {
  const [shown, setShown] = useState(from)
  const last = useRef(from)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const start = last.current
    if (reduced || start === value) {
      last.current = value
      const frame = requestAnimationFrame(() => setShown(value))
      return () => cancelAnimationFrame(frame)
    }
    const began = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = Math.round(start + (value - start) * eased)
      last.current = current
      setShown(current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return shown
}
