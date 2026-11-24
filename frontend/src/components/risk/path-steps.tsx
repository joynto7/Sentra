import Link from "next/link"
import { Check } from "lucide-react"

import { SeverityBadge } from "@/components/sentra/severity-badge"
import type { AttackPath, PathStep } from "@/lib/risk"
import { cn } from "@/lib/utils"

type State = "idle" | "done" | "current" | "next"

/** The findings of one step, with the chip that marks what still needs confirmation. */
export function StepFindings({ step }: { step: PathStep }) {
  if (step.findings.length === 0) return null
  return (
    <ul className="mt-2 space-y-1.5">
      {step.findings.map((finding) => (
        <li key={finding.code} className="rounded-[7px] bg-muted/60 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/findings/${finding.code}`}
              className="inline-block py-0.5 text-[13px] font-medium text-link hover:underline"
            >
              {finding.code}
            </Link>
            <SeverityBadge severity={finding.severity} />
            {finding.unconfirmed && (
              <span className="rounded border border-dashed border-warning/60 px-1.5 py-0.5 text-xs text-warning">
                Unconfirmed
              </span>
            )}
          </div>
          <p className="text-[13px]">{finding.title}</p>
        </li>
      ))}
    </ul>
  )
}

/**
 * The mark of a step: a ring, with a tick when the step is behind the reader, a dot on the step
 * they are at and nothing on the steps ahead. The meaning is in the shape and in the words beside
 * it, never in the colour alone.
 */
function Mark({ state, number }: { state: State; number: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full border-[3px] bg-card",
        state === "current" ? "border-primary/40" : "border-[var(--border-strong)]",
      )}
    >
      {state === "done" && (
        <span className="grid size-5 place-items-center rounded-full bg-success text-background">
          <Check className="size-3.5" strokeWidth={3.5} />
        </span>
      )}
      {state === "current" && <span className="size-3.5 rounded-full bg-primary" />}
      {state === "idle" && <span className="text-xs font-semibold text-text-secondary">{number}</span>}
    </span>
  )
}

/**
 * One path as a vertical list of steps. With a `step`, the ones before it are ticked and the
 * line between them turns green, as in an installer; without one, every step is a plain numbered
 * ring. A click on a step title moves the graph to that step.
 */
export function PathSteps({
  path,
  step,
  onStep,
}: {
  path: AttackPath
  /** The step the reader is at, or null while the whole route is shown. */
  step: number | null
  onStep?: (index: number) => void
}) {
  const total = path.steps.length
  return (
    <div>
      {step !== null && (
        <p className="text-[13px] text-text-secondary tabular" aria-live="polite">
          Step {step + 1} of {total}
        </p>
      )}
      <ol className={cn(step !== null && "mt-3")}>
        {path.steps.map((one, index) => {
          const state: State = step === null ? "idle" : index < step ? "done" : index === step ? "current" : "next"
          const last = index === total - 1
          const title = `${one.number}. ${one.component.label}`
          return (
            <li
              key={one.number}
              aria-current={state === "current" ? "step" : undefined}
              className="flex gap-3"
            >
              <div className="flex flex-col items-center">
                <Mark state={state} number={one.number} />
                {!last && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "my-1 w-0.5 flex-1 rounded-full",
                      state === "done" ? "bg-success" : "bg-[var(--border-strong)]",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0 flex-1 pt-1", !last && "pb-5")}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {onStep ? (
                    <button
                      type="button"
                      onClick={() => onStep(index)}
                      className={cn(
                        "-mx-1 rounded-[5px] px-1 text-left text-[15px] hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        state === "current" ? "font-semibold" : "font-medium",
                        state === "next" && "text-text-secondary",
                      )}
                    >
                      {title}
                    </button>
                  ) : (
                    <span className="text-[15px] font-medium">{title}</span>
                  )}
                  {state === "done" && <span className="text-xs text-success">Reached</span>}
                  {state === "current" && <span className="text-xs font-medium text-primary">Current step</span>}
                </div>
                <p className="mt-0.5 text-[13px] text-text-secondary">{one.sentence}</p>
                <StepFindings step={one} />
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
