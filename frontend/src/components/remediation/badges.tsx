import { CircleDot, CircleHelp, CircleSlash, ShieldCheck, Wrench } from "lucide-react"

import {
  type BenignOutcome,
  type Enforcement,
  type FixKind,
  STATUS_LABEL,
  type RemediationStatus,
  type RetestSummary,
} from "@/lib/remediation"
import { cn } from "@/lib/utils"

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap"

/** The lifecycle of a proposal (report, Figure 2.7), never by colour alone. */
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
 * policy or a retrieval rule; everything else is a change in the application, which its own
 * developer makes (UC-8.5). A target without a gateway leaves every fix to the application, and
 * the card says why (6a).
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

/**
 * What a retest said about the weakness (UC-8.6 step 5, 5a). The word is always there, so the
 * verdict never rests on colour alone (WCAG 1.4.1); while the retest runs, the chip says so, and
 * a rollback that took the fixes out of the traffic again makes it out of date (UC-8.8).
 */
export function RetestChip({ retest }: { retest: RetestSummary }) {
  if (retest.out_of_date) {
    return (
      <span className={cn(CHIP, "border-border-strong text-muted-foreground")}>
        <CircleSlash className="size-3.5" aria-hidden="true" />
        Out of date
      </span>
    )
  }
  if (retest.running) {
    return (
      <span className={cn(CHIP, "border-warning/60 text-warning")}>
        <CircleDot className="size-3.5" aria-hidden="true" />
        Retesting
      </span>
    )
  }
  const style =
    retest.verdict === "closed"
      ? "border-success/40 text-success"
      : retest.verdict === "still_open"
        ? "border-destructive/50 text-destructive"
        : "border-border-strong text-muted-foreground"
  const Icon = retest.verdict && retest.verdict !== "inconclusive" ? CircleDot : CircleHelp
  return (
    <span className={cn(CHIP, style)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {retest.verdict_label ?? retest.status_label}
    </span>
  )
}

/** What the fix did to one request of normal use (UC-8.6 step 4), in words and not in colour. */
export function OutcomeChip({ outcome, label }: { outcome: BenignOutcome; label: string }) {
  const style =
    outcome === "answered"
      ? "border-success/40 text-success"
      : outcome === "failed"
        ? "border-border-strong text-muted-foreground"
        : "border-warning/60 text-warning"
  return (
    <span className={cn(CHIP, style)}>
      <CircleDot className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}
