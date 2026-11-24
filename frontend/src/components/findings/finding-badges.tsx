import { CircleHelp, TriangleAlert } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FINDING_STATUS_LABEL, type FindingStatus } from "@/lib/findings"
import { cn } from "@/lib/utils"

const BASE = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap"

/** The seven statuses of the finding lifecycle (report, Figure 2.6), never by colour alone. */
const STYLE: Record<FindingStatus, string> = {
  new: "border-primary/50 text-primary",
  requires_confirmation: "border-dashed border-warning/60 text-warning",
  confirmed: "border-border-strong text-foreground",
  reopened: "border-warning/60 text-warning",
  false_positive: "border-border-strong text-muted-foreground",
  merged: "border-border-strong text-muted-foreground",
  fixed_and_verified: "border-success/40 text-success",
}

export function StatusBadge({ status }: { status: FindingStatus }) {
  if (status === "requires_confirmation") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={cn(BASE, STYLE[status])}>
            <CircleHelp className="size-3.5" aria-hidden="true" />
            {FINDING_STATUS_LABEL[status]}
          </span>
        </TooltipTrigger>
        <TooltipContent>An analyst has to confirm this finding before it counts towards the risk score.</TooltipContent>
      </Tooltip>
    )
  }
  return <span className={cn(BASE, STYLE[status])}>{FINDING_STATUS_LABEL[status]}</span>
}

/**
 * How often the attempts that tried this weakness reproduced it (FR-6.4): the share with a thin
 * bar, and the number itself for everyone who doesn't see the bar.
 */
export function Reproducibility({ value, className }: { value: string | null; className?: string }) {
  if (value === null) return <span className={cn("text-[13px] text-muted-foreground", className)}>Not rated yet</span>
  const share = Math.max(0, Math.min(1, Number(value)))
  return (
    <div className={cn("min-w-20", className)}>
      <span className="tabular text-[13px]">{Math.round(share * 100)} %</span>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-foreground/60" style={{ width: `${Math.max(share * 100, 2)}%` }} />
      </div>
    </div>
  )
}

/**
 * Always in the page, never in a tooltip or a collapsed part: a finding that only the LLM judge
 * supports is not a proven weakness until an analyst confirms it (NFR-9.3).
 */
export function ConfirmationNotice({ judgeOnly, className }: { judgeOnly: boolean; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm text-warning",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {judgeOnly
        ? "Only the LLM judge supports this finding, so it is not confirmed yet. "
        : "This finding is not confirmed yet. "}
      An analyst confirms or rejects it before it counts towards the target&apos;s risk score.
    </p>
  )
}
