"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Square } from "lucide-react"
import { cn } from "cn"

const LIMIT = 4000

/**
 * The message box: it grows with the text, Enter sends and Shift+Enter starts a new line. While an
 * answer is being worked out, the send button becomes a stop button, so the person is never stuck.
 */
export function Composer({
  busy,
  focusKey,
  onSend,
  onStop,
}: {
  busy: boolean
  /** Changes whenever the box should take the keyboard (the panel opened, a new chat began). */
  focusKey: string
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    box.current?.focus()
  }, [focusKey])

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  function submit() {
    const message = text.trim()
    if (!message || busy) return
    onSend(message)
    setText("")
  }

  const left = LIMIT - text.length
  const ready = text.trim().length > 0 && !busy

  return (
    <div className="border-t bg-background/80 px-3 pt-3 pb-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="relative">
        <label htmlFor="assistant-input" className="sr-only">
          Message to the assistant
        </label>
        <textarea
          id="assistant-input"
          ref={box}
          value={text}
          rows={1}
          maxLength={LIMIT}
          placeholder="Ask anything, or tell me what to do…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          className="max-h-40 min-h-12 w-full resize-none rounded-2xl border border-input bg-card py-3 pr-14 pl-3.5 text-[0.9375rem] leading-relaxed shadow-sm transition-shadow outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="absolute right-1.5 bottom-1.5 grid size-9 place-items-center rounded-xl bg-foreground text-background transition-transform outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            aria-label="Send message"
            className={cn(
              "absolute right-1.5 bottom-1.5 grid size-9 place-items-center rounded-xl transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
              ready ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover" : "bg-muted text-muted-foreground",
            )}
          >
            <ArrowUp className="size-4.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[0.7rem] text-muted-foreground">
        <span>Enter sends · Shift+Enter adds a line</span>
        {left < 400 ? <span className="tabular">{left} left</span> : <span>Check before you confirm.</span>}
      </p>
    </div>
  )
}
