"use client"

import { useId, useState } from "react"
import { Check, CircleHelp } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function describedBy(...ids: (string | false | undefined | null)[]): string | undefined {
  return ids.filter(Boolean).join(" ") || undefined
}

/**
 * A field with its label, an optional help that opens right under it (contextual help: the
 * explanation is at the control, said when asked for), the control, a hint and its error. The help is
 * a button that opens text in the page, so it works with a keyboard and a screen reader and nothing
 * floats over the form.
 */
export function Field({
  id,
  label,
  help,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: string
  help?: string
  hint?: React.ReactNode
  error?: string
  children: (aria: { "aria-describedby"?: string; "aria-invalid"?: true }) => React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const helpId = `${id}-explained`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        {help && (
          <button
            type="button"
            onClick={() => setOpen((now) => !now)}
            aria-expanded={open}
            aria-controls={helpId}
            aria-label={`What is ${label.toLowerCase()}?`}
            className="grid size-6 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CircleHelp className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {help && open && (
        <p
          id={helpId}
          className="rounded-[7px] border bg-muted/50 px-3 py-2 text-[13px] text-text-secondary motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
        >
          {help}
        </p>
      )}
      {children({
        "aria-describedby": describedBy(hint ? hintId : null, error ? errorId : null),
        "aria-invalid": error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** A value that is lit for a moment when it changes, so a change in the summary is seen (not for reduced motion). */
export function Flash({ value, children, className }: { value: string | number; children: React.ReactNode; className?: string }) {
  return (
    <span key={value} className={cn("value-flash", className)}>
      {children}
    </span>
  )
}

export type StepInfo = { label: string; question: string }

/**
 * The four steps, each a button once it can be reached: a finished step is a check, the current one
 * is marked for assistive technology too, and the line between them fills as the person goes on.
 */
export function Stepper({
  steps,
  current,
  done,
  reachable,
  onGo,
}: {
  steps: StepInfo[]
  current: number
  done: boolean[]
  reachable: boolean[]
  onGo: (index: number) => void
}) {
  return (
    <nav aria-label="Campaign steps">
      <ol className="flex items-start">
        {steps.map((step, index) => {
          const active = index === current
          const finished = done[index] && !active
          const last = index === steps.length - 1
          return (
            <li key={step.label} className={cn("flex min-w-0 items-start", !last && "flex-1")}>
              <button
                type="button"
                onClick={() => onGo(index)}
                disabled={!reachable[index]}
                aria-current={active ? "step" : undefined}
                className="group flex min-w-0 flex-col items-center gap-1.5 rounded-[7px] px-1 py-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed sm:flex-row sm:gap-2.5"
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none",
                    active && "border-primary bg-primary text-primary-foreground",
                    finished && "border-primary bg-primary/10 text-primary",
                    !active && !finished && "bg-card text-muted-foreground",
                  )}
                >
                  {finished ? (
                    <Check className="size-4 motion-safe:animate-in motion-safe:zoom-in-50" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "text-center text-xs sm:text-left sm:text-[13px]",
                    active ? "font-semibold text-foreground" : "text-muted-foreground",
                    reachable[index] && !active && "group-hover:text-foreground",
                  )}
                >
                  {step.label}
                  {finished && <span className="sr-only"> (done)</span>}
                </span>
              </button>
              {!last && (
                <span aria-hidden="true" className="mx-2 mt-3.5 hidden h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-border sm:block">
                  <span
                    className={cn(
                      "block h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none",
                      done[index] && index < current ? "w-full" : "w-0",
                    )}
                  />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** The question a step answers and why it matters: guided task onboarding, at the moment it is needed. */
export function StepIntro({
  step,
  total,
  question,
  why,
  headingRef,
}: {
  step: number
  total: number
  question: string
  why: string
  headingRef: React.Ref<HTMLHeadingElement>
}) {
  const id = useId()
  return (
    <header className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        Step {step} of {total}
      </p>
      <h2 id={id} ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
        {question}
      </h2>
      <p className="text-sm text-muted-foreground">{why}</p>
    </header>
  )
}
