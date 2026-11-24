"use client"

import { ShieldAlert, TriangleAlert } from "lucide-react"

import { type ImpactItem, ImpactSummary } from "@/components/wizard/summary"
import { type Estimate, formatCount } from "@/lib/campaigns"
import { cn } from "@/lib/utils"

/** "$492.00" — the LLM cost amounts (FR-10.4). */
export const money = (usd: string | null) =>
  `$${Number(usd ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * What the chosen settings would use of the organization's month, set against what is left of it. A
 * campaign whose estimate is more than the month has left is told here, in words, before anything is
 * saved: the cost and the limits were two separate figures, and nothing said that they disagree.
 */
export function monthlyConflicts(estimate: Estimate | null, budget: number | null): string[] {
  if (!estimate) return []
  const out: string[] = []
  const cost = estimate.llm_cost
  const llm = estimate.monthly.limits.find((limit) => limit.kind === "llm_cost")
  if (llm && cost.high_usd) {
    const left = Number(llm.limit) - Number(llm.used)
    const low = Number(cost.low_usd)
    const high = Number(cost.high_usd)
    if (left <= 0) {
      out.push(`This month's LLM cost limit (${money(llm.limit)}) is already reached, so no new run starts until it is raised.`)
    } else if (low > left) {
      out.push(
        `This campaign is estimated at ${money(cost.low_usd)}–${money(cost.high_usd)}, but only ${money(String(left))} of this month's ${money(llm.limit)} LLM limit is left. It will be stopped when the limit is reached; choose fewer tests, or ask a Platform Administrator to raise the limit.`,
      )
    } else if (high > left) {
      out.push(
        `This campaign is estimated at ${money(cost.low_usd)}–${money(cost.high_usd)} and ${money(String(left))} of this month's LLM limit is left, so it may be stopped before it finishes.`,
      )
    }
  }
  const attempts = estimate.monthly.limits.find((limit) => limit.kind === "attempts")
  if (attempts) {
    const left = Number(attempts.limit) - Number(attempts.used)
    const needs = budget ? Math.min(budget, estimate.estimated_attempts) : estimate.estimated_attempts
    if (left <= 0) out.push("This month's attempt limit is already reached, so no new run starts until it is raised.")
    else if (needs > left) {
      out.push(`This campaign needs about ${formatCount(needs)} attempts and ${formatCount(left)} are left of this month's limit.`)
    }
  }
  return out
}

/**
 * The live impact preview of the campaign builder, drawn by the shared ImpactSummary: what the choices
 * come to, from the form and from the estimate API. Each value says whether it is known, an estimate,
 * not known yet or out of date (the estimate could not be refreshed); it calculates nothing itself.
 */
export function Preview({
  estimate,
  estimating,
  stale,
  onRetry,
  chosenCount,
  assessment,
  targetName,
  budget,
  when,
  organizationName,
  conflicts,
  className,
}: {
  estimate: Estimate | null
  estimating: boolean
  /** The last request for an estimate failed: the numbers shown are for earlier choices */
  stale: boolean
  onRetry: () => void
  chosenCount: number
  assessment: string | null
  targetName: string | null
  budget: number | null
  when: string
  organizationName: string
  conflicts: string[]
  className?: string
}) {
  const ready = estimate !== null && chosenCount > 0
  const kind = stale ? ("stale" as const) : ("estimate" as const)
  const fix = stale ? { label: "Try again", onClick: onRetry } : undefined

  const items: ImpactItem[] = [
    targetName ? { label: "Target", value: targetName, kind: "known" } : { label: "Target", kind: "unknown", unknownText: "Not chosen yet" },
    assessment ? { label: "Assessment", value: assessment, kind: "known" } : { label: "Assessment", kind: "unknown", unknownText: "Not chosen yet" },
  ]
  if (ready) {
    items.push({
      label: "Tests that will run",
      value: String(estimate.tests),
      kind: "known",
      note: estimate.skipped ? `${estimate.skipped} skipped: they don't apply to this target` : undefined,
    })
    items.push({
      label: "Estimated attempts",
      value: `${formatCount(estimate.estimated_attempts)}${budget ? ` of ${formatCount(budget)} allowed` : ""}`,
      kind,
      fix,
    })
    if (estimate.threat_model) {
      items.push({
        label: "Threats covered",
        value: `${estimate.threat_model.threats_covered} of ${estimate.threat_model.threats_total}`,
        kind: "known",
        note: `Threat model v${estimate.threat_model.version}`,
      })
    }
    items.push(
      estimate.llm_cost.low_usd
        ? {
            label: "Estimated LLM cost",
            value: `${money(estimate.llm_cost.low_usd)}–${money(estimate.llm_cost.high_usd)}`,
            kind,
            note: `${formatCount(estimate.llm_cost.judged_attempts)} judged attempts, at what they have cost this organization.`,
          }
        : {
            label: "Estimated LLM cost",
            kind: "unknown",
            note: "Measured from this organization's own judged attempts, once it has some.",
          },
    )
    items.push({ label: "Runs", value: when, kind: "known" })
  }

  const warnings = [
    ...conflicts,
    ...(ready && budget && estimate.estimated_attempts > budget ? ["The budget is lower than the estimate, so the run stops before every test is done."] : []),
    ...(ready ? estimate.warnings : []),
  ]

  return (
    <ImpactSummary
      title="Summary"
      items={items}
      warnings={warnings}
      updating={estimating}
      footnote="Nothing is sent to the target until a run starts. The last step says whether saving starts one."
      className={cn("lg:sticky lg:top-6", className)}
    >
      {!ready && (
        <p className="border-t pt-3 text-sm text-muted-foreground">Choose a target and an assessment for an estimate.</p>
      )}
      {ready && budget ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn("h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none", estimate.estimated_attempts > budget ? "bg-warning" : "bg-primary")}
            style={{ width: `${Math.min(100, (estimate.estimated_attempts / budget) * 100)}%` }}
          />
        </div>
      ) : null}

      {/* The organization's month: what it has left, set against what this campaign would use */}
      {estimate && (
        <div className="border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">{organizationName ? `${organizationName} this month` : "This month"}</h3>
          <dl className="mt-2 space-y-2.5 text-sm">
            {estimate.monthly.limits.map((limit) => (
              <div key={limit.kind}>
                <dt className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{limit.label}</span>
                  <span className="tabular">
                    {limit.kind === "llm_cost"
                      ? `${money(limit.used)} of ${money(limit.limit)}`
                      : `${formatCount(Number(limit.used))} of ${formatCount(Number(limit.limit))}`}
                  </span>
                </dt>
                <dd>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={cn("h-full rounded-full", limit.reached ? "bg-destructive" : limit.warning ? "bg-warning" : "bg-primary")}
                      style={{ width: `${Math.min(100, limit.percent)}%` }}
                    />
                  </div>
                  {(limit.warning || limit.reached) && (
                    <p className={cn("mt-1 flex items-start gap-1.5 text-xs font-medium", limit.reached ? "text-destructive" : "text-warning")}>
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {limit.reached
                        ? "The monthly limit is reached, so no new run starts. A Platform Administrator can raise it."
                        : `${limit.percent}% of the monthly limit is used.`}
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {estimate?.requires_scope_approval && (
        <p className="flex items-start gap-2 border-t pt-3 text-sm text-text-secondary">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{organizationName || "Your organization"} requires scope approval. A Security Manager reviews this campaign before it can run.</span>
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {ready ? `About ${formatCount(estimate.estimated_attempts)} attempts, ${estimate.tests} tests.` : ""}
      </p>
    </ImpactSummary>
  )
}
