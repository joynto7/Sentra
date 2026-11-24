import Link from "next/link"
import { Check, Loader2, TriangleAlert } from "lucide-react"
import { cn } from "cn"

import { safeHref, type Step } from "@/lib/assistant"

/** What the assistant did to answer, one line per tool, live while it works. */
export function StepList({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null
  return (
    <ol aria-label="What I did" className="space-y-1.5">
      {steps.map((step) => {
        const href = safeHref(step.href)
        return (
          <li key={step.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-4.5 shrink-0 place-items-center rounded-full",
                step.status === "running" && "text-primary",
                step.status === "done" && "bg-success/15 text-success",
                step.status === "failed" && "bg-destructive/15 text-destructive",
              )}
            >
              {step.status === "running" && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
              {step.status === "done" && <Check className="size-3" strokeWidth={3} />}
              {step.status === "failed" && <TriangleAlert className="size-3" />}
            </span>
            <span className={cn(step.status === "running" && "animate-pulse motion-reduce:animate-none")}>
              {step.label}
              {step.status === "running" ? "…" : ""}
            </span>
            {step.summary && step.status !== "running" && (
              <>
                <span aria-hidden="true">·</span>
                {href && step.status === "done" ? (
                  <Link href={href} className="font-medium text-link hover:underline">
                    {step.summary}
                  </Link>
                ) : (
                  <span className={cn(step.status === "failed" && "text-destructive")}>{step.summary}</span>
                )}
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}
