"use client"

import { useCallback, useEffect, useReducer, useRef } from "react"

import { CLEAN, type DraftFeedback, draftReducer } from "@/components/wizard/draft-state"

/** What a place that keeps drafts must offer: write the draft, and say when it was kept. */
export type DraftAdapter<T> = {
  save: (value: T) => Promise<{ savedAt: string }> | { savedAt: string }
}

/** Thrown by an adapter when nothing can be kept here at all (blocked storage, no server support). */
export class DraftUnsupportedError extends Error {
  constructor(message = "This place can't keep a draft") {
    super(message)
    this.name = "DraftUnsupportedError"
  }
}

/**
 * Keeps the honest feedback about a draft, and sends it to the adapter a moment after the last change.
 *
 * It owns no form values: the caller keeps them in one place and tells this hook when they changed.
 * With no adapter nothing is ever kept, and the feedback says so from the start.
 */
export function useDraftFeedback<T>(adapter: DraftAdapter<T> | null, delay = 500) {
  const [feedback, dispatch] = useReducer(draftReducer, adapter ? CLEAN : { ...CLEAN, phase: "unsupported" as const })
  const latest = useRef<T | null>(null)
  const edit = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const adapterRef = useRef(adapter)
  useEffect(() => {
    adapterRef.current = adapter
  }, [adapter])

  const send = useCallback(async () => {
    const target = adapterRef.current
    if (!target || latest.current === null) return
    const mine = edit.current
    dispatch({ type: "saveStarted", edit: mine })
    try {
      const done = await target.save(latest.current)
      dispatch({ type: "saved", edit: mine, at: done.savedAt })
    } catch (error) {
      if (error instanceof DraftUnsupportedError) dispatch({ type: "unsupported" })
      else dispatch({ type: "failed", edit: mine, message: error instanceof Error ? error.message : "The draft could not be kept" })
    }
  }, [])

  const noteEdit = useCallback(
    (value: T) => {
      latest.current = value
      edit.current += 1
      dispatch({ type: "edited" })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void send(), delay)
    },
    [delay, send],
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const restored = useCallback((at: string) => dispatch({ type: "restored", at }), [])
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    latest.current = null
    edit.current = 0
    dispatch({ type: "reset" })
  }, [])

  return { feedback: feedback as DraftFeedback, noteEdit, retry: send, restored, reset }
}
