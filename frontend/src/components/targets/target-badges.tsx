import { Archive, CircleCheck, ShieldAlert, Square } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ENVIRONMENT_LABEL, type Environment, type TargetStatus } from "@/lib/targets"
import { cn } from "@/lib/utils"

const BASE = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap"

/** Production is filled and staging is outlined, so the two differ by shape as well as colour. */
export function EnvironmentBadge({ environment, className }: { environment: Environment; className?: string }) {
  const production = environment === "production"
  return (
    <span className={cn(BASE, production ? "border-foreground bg-foreground text-background" : "border-border-strong text-foreground", className)}>
      <Square className={cn("size-2.5", production && "fill-current")} aria-hidden="true" />
      {ENVIRONMENT_LABEL[environment]}
    </span>
  )
}

/** Ownership as icon + text (never colour alone, NFR-4.3). An unverified target can't be tested. */
export function OwnershipBadge({ status, className }: { status: TargetStatus; className?: string }) {
  if (status === "verified") {
    return (
      <span className={cn(BASE, "border-success/40 text-success", className)}>
        <CircleCheck className="size-3.5" aria-hidden="true" />
        Verified
      </span>
    )
  }
  if (status === "archived") {
    return (
      <span className={cn(BASE, "border-border-strong text-muted-foreground", className)}>
        <Archive className="size-3.5" aria-hidden="true" />
        Archived
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn(BASE, "border-dashed border-warning/60 text-warning", className)}>
          <ShieldAlert className="size-3.5" aria-hidden="true" />
          Unverified
          <span className="sr-only">: ownership must be proved before any test can run</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Ownership must be proved before any test can run.</TooltipContent>
    </Tooltip>
  )
}
