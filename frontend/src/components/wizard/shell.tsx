"use client"

import { ArrowLeft, ArrowRight, FastForward } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The frame of a guided task: what the task is and why, where the person is in it, the form, the help
 * and the summary beside or after it, and the actions. It holds no form values. On a narrow screen the
 * secondary area follows the form, and the actions stay in reach at the bottom.
 */
export function WorkflowShell({
  title,
  purpose,
  exit,
  status,
  notices,
  steps,
  children,
  aside,
  footer,
  className,
}: {
  title: string
  purpose: string
  /** A way out of the task, at the top right */
  exit?: React.ReactNode
  /** The draft status, under the title */
  status?: React.ReactNode
  /** Introductions, a restored draft, a form-level error: between the title and the steps */
  notices?: React.ReactNode
  /** The step navigation */
  steps: React.ReactNode
  /** The current step */
  children: React.ReactNode
  /** The summary and the help, after the form on a narrow screen */
  aside?: React.ReactNode
  footer: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-6", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{purpose}</p>
          {status}
        </div>
        {exit}
      </header>
      {notices}
      {steps}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6 rounded-[10px] border bg-card p-5">{children}</div>
        {aside && <div className="min-w-0 space-y-4 lg:sticky lg:top-6">{aside}</div>}
      </div>
      {footer}
    </div>
  )
}

/**
 * Back, Continue and the one final operation. Moving between steps and doing the real thing are two
 * different buttons (not one that changes its type), so a click that moves on can never also submit.
 * While the final operation is pending, nothing else can be pressed.
 */
export function ActionFooter({
  leading,
  onBack,
  onContinue,
  continueLabel,
  continueShort,
  skip,
  final,
  pending = false,
}: {
  /** Cancel and the draft status */
  leading?: React.ReactNode
  /** Absent on the first step */
  onBack?: () => void
  onContinue?: () => void
  /** Full text, for assistive technology and wide screens */
  continueLabel?: string
  /** Shorter visible text on a phone */
  continueShort?: string
  skip?: { label: string; onClick: () => void }
  /** Present on the last step: the real operation, and what it will do */
  final?: { label: string; pendingLabel: string; formId: string; /** Why the operation can't be done now; it stays visible, and pressing does nothing */ blockedReason?: string }
  pending?: boolean
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
      {final?.blockedReason && (
        <p id="final-blocked" className="order-last basis-full text-right text-xs text-warning">
          {final.blockedReason}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{leading}</div>
      <div className="flex flex-wrap items-center justify-end gap-2" aria-busy={pending}>
        {onBack && (
          <Button type="button" variant="outline" className="h-9" onClick={onBack} disabled={pending}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
        )}
        {skip && !final && (
          <Button type="button" variant="ghost" className="h-9" onClick={skip.onClick} disabled={pending}>
            <FastForward aria-hidden="true" />
            {skip.label}
          </Button>
        )}
        {final ? (
          <Button
            key="final"
            type="submit"
            form={final.formId}
            className="h-9 hover:bg-primary-hover aria-disabled:opacity-60"
            disabled={pending}
            aria-disabled={final.blockedReason ? true : undefined}
            aria-describedby={final.blockedReason ? "final-blocked" : undefined}
            onClick={(event) => final.blockedReason && event.preventDefault()}
          >
            {pending ? final.pendingLabel : final.label}
          </Button>
        ) : (
          <Button key="continue" type="button" className="h-9 hover:bg-primary-hover" onClick={onContinue} aria-label={continueLabel}>
            <span className="sm:hidden" aria-hidden="true">
              {continueShort ?? "Continue"}
            </span>
            <span className="hidden sm:inline" aria-hidden="true">
              {continueLabel ?? "Continue"}
            </span>
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}
