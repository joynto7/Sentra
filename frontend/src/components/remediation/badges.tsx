import { CircleDot, ShieldCheck, Wrench } from "lucide-react"

import {
  type Enforcement,
  type FixKind,
  STATUS_LABEL,
  type RemediationStatus,
} from "@/lib/remediation"
import { cn } from "@/lib/utils"

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap"

/** The lifecycle of a proposal (report, Figure 2.7), never by colour alone. FR-8.1 writes drafts;
 * the other statuses arrive with the approval of FR-8.2 and the retest of FR-8.5. */
const STATUS_STYLE: Record<RemediationStatus, string> = {
  draft: "border-primary/50 text-primary",
  awaiting_approval: "border-warning/60 text-warning",
  rejected: "border-border-strong text-muted-foreground",
  approved: "border-confirm/50 text-confirm",
  applying: "border-warning/60 text-warning",
  effective: "border-success/40 text-success",
  ineffective: "border-destructive/50 text-destructive",
}

export function StatusChip({ status }: { status: RemediationStatus }) {
  return (
    <span className={cn(CHIP, STATUS_STYLE[status])}>
      <CircleDot className="size-3.5" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  )
}

/**
 * Where a fix takes effect (UC-8.2 step 6): a Sentra Shield gateway can carry a guardrail, a tool
 * policy or a retrieval rule; everything else is a change in the application. Until FR-8.3
 * connects gateways, every fix is a change in the application, and the card says why (6a).
 */
export function EnforcementChip({ enforcement }: { enforcement: Enforcement }) {
  const gateway = enforcement === "gateway"
  const Icon = gateway ? ShieldCheck : Wrench
  return (
    <span
      className={cn(CHIP, gateway ? "border-confirm/50 text-confirm" : "border-border-strong text-text-secondary")}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {gateway ? "Gateway" : "Application change"}
    </span>
  )
}

/** The kind of a fix with where it takes effect, as Screen 45 lists them in one chip. */
export function FixChip({
  kind,
  label,
  enforcement,
}: {
  kind: FixKind
  label: string
  enforcement: Enforcement
}) {
  return (
    <span
      key={kind}
      className={cn(CHIP, "border-border-strong font-normal text-text-secondary")}
      title={`${label}, ${enforcement === "gateway" ? "carried by a Sentra Shield gateway" : "a change in the application"}`}
    >
      {label}
      <span className="text-muted-foreground">·</span>
      {enforcement === "gateway" ? "Gateway" : "App"}
    </span>
  )
}
