"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowDown, Check, Maximize2, Minimize2, ShieldCheck, SquarePen, X } from "lucide-react"
import { cn } from "cn"

import { AssistantAvatar } from "@/components/assistant/assistant-avatar"
import { useAssistant } from "@/components/assistant/assistant-provider"
import { Composer } from "@/components/assistant/composer"
import { HistoryMenu } from "@/components/assistant/history-menu"
import { MessageView } from "@/components/assistant/message-view"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"

function ModelLine() {
  const { status } = useAssistant()
  if (!status) return <span className="text-xs text-muted-foreground">Getting ready…</span>
  if (!status.available)
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="truncate">Guide mode · no AI model connected</span>
      </span>
    )
  const where = status.deployment === "local" ? "On this platform" : "External · data masked"
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={`${status.model}: ${where}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="truncate">
        {status.model} · {where}
      </span>
    </span>
  )
}

function Welcome() {
  const { status, send } = useAssistant()
  const user = useSession()
  const first = user.name.split(" ")[0]
  return (
    <div className="flex min-h-full flex-col justify-center px-1 py-6 animate-in fade-in duration-300 motion-reduce:animate-none">
      <AssistantAvatar size="lg" className="mx-auto" />
      <h2 className="mt-4 text-center text-xl font-semibold tracking-tight text-balance">
        Hi {first}, what are we working on?
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-center text-sm text-balance text-muted-foreground">
        I can answer questions about Sentra, look things up and do the work for you. You confirm every change before it
        happens.
      </p>

      {status && status.starters.length > 0 && (
        <ul aria-label="Things to try" className="mt-6 grid gap-2">
          {status.starters.map((text) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => send(text)}
                className="group flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left text-sm shadow-xs transition-all outline-none hover:-translate-y-px hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="font-medium">{text}</span>
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {status && (
        <div className="mt-6 rounded-xl bg-muted/60 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            As {user.organization?.role_label ?? "a member"}, I can
          </p>
          <ul className="mt-2 grid gap-1 text-[0.8125rem] text-text-secondary">
            {status.can_do.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 border-t pt-2 text-xs text-muted-foreground">
            I use your own permissions and never ask for passwords, keys or tokens.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The assistant, docked at the right of every page. It does not take the page away: the person can
 * keep working while it answers, and it knows which page they are on. On a phone it fills the screen.
 */
export function AssistantPanel() {
  const a = useAssistant()
  const { open, setOpen, expanded, setExpanded, messages, busy, error, conversationId } = a
  const scroller = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(false)
  const stick = useRef(true)

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" })
  }, [])

  // Follow the answer as it grows, unless the person has scrolled up to read.
  useEffect(() => {
    if (stick.current) toBottom()
  })

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        document.getElementById("assistant-launcher")?.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, setOpen])

  if (!open) return null

  return (
    <aside
      aria-label="Sentra assistant"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl shadow-black/10 animate-in slide-in-from-right duration-300 motion-reduce:animate-none",
        expanded ? "sm:w-[min(760px,calc(100vw-1rem))]" : "sm:w-[440px]",
      )}
    >
      <header className="flex items-center gap-2.5 border-b bg-card/80 px-3.5 py-2.5 backdrop-blur">
        <AssistantAvatar thinking={busy} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-tight font-semibold">Sentra Assistant</h2>
          <ModelLine />
        </div>
        <Button variant="ghost" size="icon" aria-label="New conversation" onClick={a.newChat}>
          <SquarePen aria-hidden="true" />
        </Button>
        <HistoryMenu />
        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex"
          aria-label={expanded ? "Make the assistant narrower" : "Make the assistant wider"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close the assistant"
          onClick={() => {
            setOpen(false)
            document.getElementById("assistant-launcher")?.focus()
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            stick.current = near
            setAway(!near)
          }}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation"
          tabIndex={0}
          className="h-full overflow-y-auto overscroll-contain px-3.5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {messages.length === 0 && !busy ? (
            <Welcome />
          ) : (
            <div className="space-y-4">
              {messages.map((message, i) => (
                <MessageView
                  key={message.id}
                  message={message}
                  last={i === messages.length - 1}
                  busy={busy}
                  onSuggest={a.send}
                  onConfirm={a.confirm}
                  onCancel={a.cancel}
                />
              ))}
              {error && (
                <p role="alert" className="ml-10 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
        {away && (
          <button
            type="button"
            onClick={() => {
              stick.current = true
              toBottom(true)
            }}
            aria-label="Jump to the latest message"
            className="absolute bottom-3 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border bg-card shadow-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <Composer
        busy={busy}
        focusKey={`${open}-${conversationId ?? "new"}`}
        onSend={(text) => {
          stick.current = true
          a.send(text)
        }}
        onStop={a.stop}
      />
    </aside>
  )
}
