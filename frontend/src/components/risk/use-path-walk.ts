import { useEffect, useState } from "react"

/** How long the walkthrough stays on one step. */
const STEP_MS = 1800

/**
 * Where the reader is on the selected attack path: which step is current, and whether the
 * walkthrough is playing. The graph and the step list both read it, so a click on either moves
 * the other. `step` is null until the reader starts, so the route first shows whole.
 *
 * The state remembers which path it belongs to, so choosing another path starts over without an
 * effect having to reset it.
 */
export function usePathWalk(selected: string | null, total: number) {
  const [walk, setWalk] = useState<{ key: string | null; step: number | null; playing: boolean }>({
    key: null,
    step: null,
    playing: false,
  })
  const mine = selected !== null && walk.key === selected
  const step = mine && walk.step !== null ? Math.min(walk.step, Math.max(total - 1, 0)) : null
  const playing = mine && walk.playing && total > 1

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setWalk((now) => {
        if (now.key !== selected) return now
        const next = Math.min((now.step ?? -1) + 1, total - 1)
        return { ...now, step: next, playing: next < total - 1 }
      })
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [playing, selected, total])

  /** Jump to a step. This also pauses, so the reader is not moved on while reading it. */
  const go = (next: number) => setWalk({ key: selected, step: next, playing: false })
  /** Play or pause. Playing from the end, or from the whole route, starts at the first step. */
  const toggle = () =>
    setWalk({
      key: selected,
      step: playing ? step : step === null || step >= total - 1 ? 0 : step,
      playing: !playing,
    })
  /** Back to the whole route. */
  const reset = () => setWalk({ key: selected, step: null, playing: false })

  return { step, playing, go, toggle, reset }
}
