"use client"

import { useEffect } from "react"

/**
 * The page's entrance motion. Anything marked `data-reveal` starts a little lower and transparent and
 * glides into place the first time it scrolls into view; `data-reveal-delay` (milliseconds) staggers the
 * items of one group, so that a heading comes first and its cards follow one by one. What is already above
 * the viewport (the page opened half way down, or a link jumped past it) is shown at once, so nothing is
 * ever left invisible. The states live in globals.css (`.lp-motion [data-reveal]`); with the system's
 * "reduce motion" setting they do nothing and everything is simply there, and without scripts a
 * `noscript` rule in the page shows everything.
 */
export function ScrollReveal() {
  useEffect(() => {
    const pending = new Set(Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")))
    for (const el of pending) {
      const delay = el.dataset.revealDelay
      if (delay) el.style.setProperty("--d", `${delay}ms`)
    }

    // Everything that has come into view, or been scrolled past, is shown. A scroll listener (and not an
    // IntersectionObserver) because a link that jumps past a section never "enters" it, and what the
    // observer never saw would stay invisible.
    let frame = 0
    let reached = 0 // the furthest point of the page that has been in view, from the top of the page
    const check = () => {
      frame = 0
      reached = Math.max(reached, window.scrollY + window.innerHeight * 0.92)
      for (const el of pending) {
        if (el.getBoundingClientRect().top + window.scrollY < reached) {
          el.classList.add("is-in")
          pending.delete(el)
        }
      }
      if (pending.size === 0) stop()
    }
    const onScroll = () => {
      // noted at once, shown on the next frame: a jump that skips frames still reveals what it passed
      reached = Math.max(reached, window.scrollY + window.innerHeight * 0.92)
      if (!frame) frame = requestAnimationFrame(check)
    }
    const stop = () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    check()
    return () => {
      stop()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
