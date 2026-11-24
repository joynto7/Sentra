"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { cn } from "cn"

import { ActionCard } from "@/components/assistant/action-card"
import { AssistantAvatar } from "@/components/assistant/assistant-avatar"
import { CardView } from "@/components/assistant/cards"
import { Markdown } from "@/components/assistant/markdown"
import { StepList } from "@/components/assistant/steps"
import { useReveal } from "@/components/assistant/use-reveal"
import { safeHref, type ChatMessage } from "@/lib/assistant"

function Thinking() {
  return (
    <div role="status" className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground">
      <span className="sr-only">Thinking</span>
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-primary/60 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

export function MessageView({
  message,
  last,
  busy,
  onSuggest,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage
  last: boolean
  busy: boolean
  onSuggest: (text: string) => void
  onConfirm: (actionId: string) => void
  onCancel: (actionId: string) => void
}) {
  const shown = useReveal(message.content, !!message.fresh)

  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap text-primary-foreground shadow-sm">
          {message.content}
        </p>
      </div>
    )
  }

  if (message.role === "event") {
    // The outcome of a confirmed change: the card above already says done or not done; what is
    // left to show is what it made.
    const href = safeHref(message.href)
    if (message.cards.length === 0 && !href) return null
    return (
      <div className="ml-10 space-y-2 animate-in fade-in duration-200 motion-reduce:animate-none">
        {message.cards.map((card, i) => (
          <CardView key={i} card={card} />
        ))}
        {message.cards.length === 0 && href && (
          <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">
            See it <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    )
  }

  const empty = message.pending && !message.content && message.steps.length === 0 && message.cards.length === 0
  return (
    <div className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
      <AssistantAvatar size="sm" thinking={!!message.pending} animated={!!message.pending} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2.5">
        {empty && <Thinking />}
        <StepList steps={message.steps} />
        {message.cards.map((card, i) => (
          <CardView key={i} card={card} />
        ))}
        {message.content && (
          <div className="text-foreground">
            {message.fresh && <span className="sr-only">{message.content}</span>}
            <div aria-hidden={message.fresh ? true : undefined}>
              <Markdown text={shown} />
            </div>
          </div>
        )}
        {message.pending && message.steps.length > 0 && !message.content && message.steps.every((s) => s.status !== "running") && <Thinking />}
        {message.actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            disabled={busy}
            onConfirm={() => onConfirm(action.id)}
            onCancel={() => onCancel(action.id)}
          />
        ))}
        {last && !busy && !message.pending && message.suggestions.length > 0 && (
          <ul aria-label="Suggested next messages" className={cn("flex flex-wrap gap-1.5 pt-0.5")}>
            {message.suggestions.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  onClick={() => onSuggest(text)}
                  className="rounded-full border bg-card px-3 py-1 text-[0.8125rem] text-text-secondary shadow-xs transition-colors outline-none hover:border-primary/40 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
