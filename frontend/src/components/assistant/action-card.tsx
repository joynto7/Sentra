"use client"

import { Check, CircleAlert, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import type { ActionView } from "@/lib/assistant"

/**
 * A change the assistant proposes. Nothing has happened yet: this card is the person's decision.
 * It shows exactly what will be sent, marks the ones that send test traffic, and after the
 * decision shows what came of it. Colour is never the only sign: every state has a word and icon.
 */
export function ActionCard({
  action,
  disabled,
  onConfirm,
  onCancel,
}: {
  action: ActionView
  /** Another turn is running, so a decision would have to wait. */
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const pending = action.status === "pending"
  const high = action.risk === "high"
  return (
    <section
      aria-label={`Proposed change: ${action.summary}`}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card shadow-sm",
        pending && "border-confirm/40 ring-1 ring-confirm/10",
        action.status === "done" && "border-success/30",
        action.status === "failed" && "border-destructive/30",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          pending || action.status === "running" ? "bg-confirm" : action.status === "done" ? "bg-success" : action.status === "failed" ? "bg-destructive" : "bg-border-strong",
        )}
      />
      <div className="space-y-3 py-3 pr-3.5 pl-4.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
          {pending && (
            <span className="inline-flex items-center gap-1.5 text-confirm">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Needs your confirmation
            </span>
          )}
          {action.status === "running" && (
            <span className="inline-flex items-center gap-1.5 text-confirm">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Doing it…
            </span>
          )}
          {action.status === "done" && (
            <span className="inline-flex items-center gap-1.5 text-success">
              <Check className="size-3.5" aria-hidden="true" /> Done
            </span>
          )}
          {action.status === "failed" && (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <CircleAlert className="size-3.5" aria-hidden="true" /> Not done
            </span>
          )}
          {action.status === "cancelled" && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <X className="size-3.5" aria-hidden="true" /> Cancelled
            </span>
          )}
        </div>

        <p className="text-[0.9375rem] leading-snug font-medium [overflow-wrap:anywhere]">{action.summary}</p>

        {action.fields.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            {action.fields.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 font-medium break-words text-text-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {pending && high && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[0.8125rem] leading-snug text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            This can send test traffic to a target. Make sure you are allowed to test it.
          </p>
        )}
        {action.status === "failed" && action.error && (
          <p role="alert" className="text-[0.8125rem] text-destructive">
            {action.error}
          </p>
        )}

        {pending && (
          <div className="flex items-center gap-2">
            <Button onClick={onConfirm} disabled={disabled} className="h-8 px-3.5">
              <Check aria-hidden="true" /> {high ? "Yes, do it" : "Confirm"}
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={disabled} className="h-8 px-3">
              Cancel
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
