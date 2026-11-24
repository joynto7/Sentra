import { useEffect, useState } from "react"

/**
 * Shows a new answer as if it is being written, quickly, and a stored one at once. It never holds
 * the text back for long (a whole answer takes about a second), and a person who prefers reduced
 * motion gets the whole text immediately.
 */
export function useReveal(text: string, animate: boolean): string {
  const [length, setLength] = useState(animate ? 0 : text.length)

  useEffect(() => {
    if (!animate) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the text is shown whole
      setLength(text.length)
      return
    }
    // About a second for any answer: a long text is revealed in bigger steps.
    const step = Math.max(2, Math.ceil(text.length / 60))
    const timer = window.setInterval(() => {
      setLength((n) => {
        if (n + step >= text.length) {
          window.clearInterval(timer)
          return text.length
        }
        return n + step
      })
    }, 16)
    return () => window.clearInterval(timer)
  }, [text, animate])

  return animate ? text.slice(0, length) : text
}
