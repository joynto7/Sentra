"use client"

import { useEffect, useRef, useState } from "react"

import { runEventsUrl } from "@/lib/campaigns"

/** The kinds the run engine and its extensions publish (app/workers/orchestrator/live.py). */
export type EventKind =
  | "status"
  | "plan"
  | "attempt"
  | "detection"
  | "warning"
  | "finding"
  | "finding_severity"
  | "ended"

export type LiveEvent = {
  id: string
  kind: EventKind
  /** When it happened, from its place in the run's stream ("<milliseconds>-<number>"). */
  at: number
  data: Record<string, unknown>
}

/** The time an event id carries; the browser's own clock if it carries none. */
function timeOf(id: string, fallback: number): number {
  const ms = Number(id.split("-")[0])
  return Number.isFinite(ms) && ms > 1e12 ? ms : fallback
}

const KINDS: EventKind[] = [
  "status",
  "plan",
  "attempt",
  "detection",
  "warning",
  "finding",
  "finding_severity",
  "ended",
]
const KEPT = 300 // events in the list; the run's own pages show everything that was stored
const LONG_GAP_MS = 5000 // a stream closes every minute on purpose; only a longer gap is a loss
const NOTICE_MS = 8000

/**
 * The live events of one run (UC-5.6 step 3), as Server-Sent Events. The browser reconnects by
 * itself with the last id it saw, so an interrupted connection loses nothing (3a1); a monitor
 * that is too far behind gets "reload" and loads the run again. The stream is closed when the
 * run has ended, so nothing reconnects for ever.
 */
export function useRunEvents({
  code,
  number,
  after,
  ended,
  onStatus,
  onFinding,
  onReload,
}: {
  code: string
  number: number
  /** The last event the loaded run already shows; the stream starts after it. `undefined`
   * while the run is still loading, so the stream opens once and with the right place. */
  after: string | null | undefined
  /** The run has ended: the monitor shows its summary and follows nothing any more. */
  ended: boolean
  /** A status or ended event: the page reads the run again, so its numbers stay exact. */
  onStatus: () => void
  /** A finding event: the page reads the run's findings again. */
  onFinding: () => void
  /** The monitor missed too much: everything is loaded again. */
  onReload: () => void
}) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [reconnected, setReconnected] = useState<number | null>(null)
  const closedAt = useRef<number | null>(null)
  const since = useRef<number | null>(null)

  useEffect(() => {
    // `after` stays what the first loaded run said, so reading the run again doesn't open a new
    // stream (the page keeps it).
    if (ended || after === undefined) return
    const source = new EventSource(runEventsUrl(code, number, after), { withCredentials: true })

    const add = (kind: EventKind) => (event: MessageEvent) => {
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        data = {}
      }
      const at = timeOf(event.lastEventId, Date.now())
      setEvents((old) => [{ id: event.lastEventId, kind, at, data }, ...old].slice(0, KEPT))
      if (since.current !== null) since.current += 1
      if (kind === "status" || kind === "ended") onStatus()
      if (kind === "finding") onFinding()
    }
    for (const kind of KINDS) source.addEventListener(kind, add(kind))
    source.addEventListener("reload", () => {
      setEvents([])
      onReload()
    })
    source.onopen = () => {
      setConnected(true)
      // A stream closes every minute and the browser opens the next one at once; only a longer
      // gap means the connection was really interrupted (3a).
      if (closedAt.current && Date.now() - closedAt.current > LONG_GAP_MS) {
        since.current = 0
        window.setTimeout(() => {
          setReconnected(since.current ?? 0)
          since.current = null
          window.setTimeout(() => setReconnected(null), NOTICE_MS)
        }, 1000)
      }
      closedAt.current = null
    }
    source.onerror = () => {
      setConnected(false)
      closedAt.current ??= Date.now()
    }
    return () => source.close()
  }, [code, number, after, ended, onStatus, onFinding, onReload])

  return { events, connected, reconnected }
}
