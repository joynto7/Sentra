"use client"

import { useEffect, useRef } from "react"
import { Ban, CircleAlert, CircleCheck, Clock, Loader2 } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { DraftFeedback } from "@/components/wizard/draft-state"
import { cn } from "@/lib/utils"

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

/**
 * The draft, in words that are true: "Saved" only once a save has been acknowledged for the latest
 * change; a failure says so and can be tried again; where nothing can be kept it says that, too.
 * The text sits in a polite live region that is always in the page, so changes are announced.
 */
export function DraftStatus({
  feedback,
  where = "on this device",
  onRetry,
  className,
}: {
  feedback: DraftFeedback
  where?: string
  onRetry?: () => void
  className?: string
}) {
  const at = feedback.savedAt ? CLOCK.format(new Date(feedback.savedAt)) : null
  let text: string
  switch (feedback.phase) {
    case "clean":
      text = "No changes yet"
      break
    case "unsaved":
      text = at ? `Changes not saved yet. Last saved ${where} at ${at}` : "Changes not saved yet"
      break
    case "saving":
      text = "Saving the draft…"
      break
    case "saved":
      text = `Draft saved ${where}${at ? ` at ${at}` : ""}`
      break
    case "failed":
      text = `Draft not saved. ${feedback.error ?? ""}`.trim()
      break
    case "unsupported":
      text = "A draft can't be kept here. Nothing is saved until you finish."
      break
  }
  return (
    <p role="status" aria-live="polite" className={cn("flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground", feedback.phase === "failed" && "text-destructive", className)}>
      {feedback.phase === "saving" && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {feedback.phase === "saved" && <CircleCheck className="size-3.5 text-success" aria-hidden="true" />}
      {(feedback.phase === "failed" || feedback.phase === "unsupported") && <CircleAlert className="size-3.5" aria-hidden="true" />}
      <span>{text}</span>
      {feedback.phase === "failed" && onRetry && (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onRetry}>
          Try again
        </Button>
      )}
    </p>
  )
}

export type ReadinessKind = "checking" | "ready" | "missing" | "waiting" | "blocked"

const READINESS: Record<ReadinessKind, { label: string; icon: typeof Clock; tone: string }> = {
  checking: { label: "Checking", icon: Loader2, tone: "border-border bg-muted/40" },
  ready: { label: "Ready", icon: CircleCheck, tone: "border-success/40 bg-success/5" },
  missing: { label: "Needs something first", icon: CircleAlert, tone: "border-warning/50 bg-warning/10" },
  waiting: { label: "Waiting for someone", icon: Clock, tone: "border-border bg-muted/40" },
  blocked: { label: "Blocked", icon: Ban, tone: "border-destructive/40 bg-destructive/5" },
}

/**
 * Where a prerequisite stands. A missing prerequisite (something the person can do) is told apart from
 * a wait (someone else's decision) and from a block (not allowed now), and each says the next permitted action.
 */
export function Readiness({
  status,
  title,
  detail,
  action,
  className,
}: {
  status: ReadinessKind
  title: string
  detail: string
  action?: { label: string; href?: string; onClick?: () => void }
  className?: string
}) {
  const { label, icon: Icon, tone } = READINESS[status]
  return (
    <div role="status" aria-busy={status === "checking"} className={cn("flex items-start gap-3 rounded-[10px] border p-3.5 text-sm", tone, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", status === "checking" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <span className="sr-only">{label}: </span>
          {title}
        </p>
        <p className="mt-0.5 text-text-secondary">{detail}</p>
        {action &&
          (action.href ? (
            <Button asChild variant="outline" size="sm" className="mt-2 h-8">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="mt-2 h-8" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
      </div>
    </div>
  )
}

/**
 * What is wrong, in one place, when a step can't go on: each problem is a button that moves to its
 * field, so a keyboard or a screen reader reaches it without searching. It takes focus when it appears,
 * and the same text stays next to each field.
 */
export function ErrorSummary({
  problems,
  onGo,
  className,
}: {
  problems: { field: string; label: string; message: string }[]
  onGo: (field: string) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const key = problems.map((p) => p.field + p.message).join("|")
  useEffect(() => {
    if (key) ref.current?.focus()
  }, [key])
  if (problems.length === 0) return null
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn("rounded-[10px] border border-destructive/40 bg-destructive/5 p-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <p className="font-medium text-destructive">
        {problems.length === 1 ? "One thing needs your attention" : `${problems.length} things need your attention`}
      </p>
      <ul className="mt-1.5 space-y-1">
        {problems.map((problem) => (
          <li key={problem.field}>
            <button
              type="button"
              onClick={() => onGo(problem.field)}
              className="rounded text-left underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {problem.label}: {problem.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
