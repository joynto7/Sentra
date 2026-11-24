"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, CircleCheck, CircleDashed, History, Layers, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { TargetMark } from "@/components/sentra/target-picker"
import { AcceptGapDialog } from "@/components/threat-models/accept-gap-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { type CoverageDetail, getCoverageCell } from "@/lib/risk"
import { formatDate } from "@/lib/targets"
import { acceptThreatGap } from "@/lib/threat-models"
import { cn } from "@/lib/utils"

/** What the cell says, with the dates the page knows how to write (UC-7.4 steps 3-4). */
function sentence(detail: CoverageDetail): string {
  const cell = detail.cell
  if (cell.status === "tested" && cell.run) {
    return `Tested in ${cell.run.code} on ${formatDate(cell.run.ended_at)}.`
  }
  if (cell.status === "stale" && cell.run) {
    return `The target changed on ${formatDate(cell.changed_at)}, after the last test in ${cell.run.code} (${formatDate(cell.run.ended_at)}).`
  }
  return cell.reason
}

const STATUS_ICON = { tested: CircleCheck, stale: History, gap: CircleDashed } as const
const STATUS_TONE: Record<string, string> = {
  tested: "bg-success/10 text-success border-success/30",
  stale: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-text)] border-[var(--severity-medium)]/50",
  gap: "bg-muted text-text-secondary border-border-strong",
}

/** The risk of a threat (likelihood times impact), toned by how high it is; the number is always written. */
function riskTone(risk: number): string {
  if (risk >= 15) return "bg-[var(--severity-critical-bg)] text-[var(--severity-critical-text)]"
  if (risk >= 9) return "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-text)]"
  return "bg-muted text-text-secondary"
}

/**
 * The panel of Screen 43 (UC-7.4 steps 4-5): one cell of the matrix with the threats behind it,
 * the suites that would cover it (FR-3.4) and the way to accept the gap with a reason (5a1, as in
 * UC-3.3), so the decision is recorded in the same place as on Screen 27.
 */
export function CoveragePanel({
  code,
  targetId,
  framework,
  onClose,
  onChanged,
}: {
  code: string | null
  targetId: string | null
  framework: "owasp" | "atlas"
  onClose: () => void
  /** An accepted gap changes the matrix, so the page reads it again. */
  onChanged: () => void
}) {
  const canManage = useCan("manage_threat_models")
  const canCampaign = useCan("manage_campaigns")
  const [detail, setDetail] = useState<CoverageDetail | null>(null)
  const [error, setError] = useState(false)
  const [accepting, setAccepting] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const open = code !== null && targetId !== null

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!code || !targetId) return
      getCoverageCell(code, new URLSearchParams({ target_id: targetId, framework }), signal)
        .then((found) => {
          setDetail(found)
          setError(false)
        })
        .catch(() => !signal?.aborted && setError(true))
    },
    [code, targetId, framework],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const shown = detail && detail.code === code && detail.target.id === targetId ? detail : null
  const gap = shown?.threats.find((threat) => threat.number === accepting)

  async function accept(threat: number, reason: string) {
    if (!shown || shown.threat_model_version === null || !targetId) return
    setBusy(true)
    try {
      await acceptThreatGap(targetId, shown.threat_model_version, threat, reason)
      toast.success("The gap is accepted with your reason.")
      setAccepting(null)
      load()
      onChanged()
    } catch (problem) {
      toast.error(problem instanceof ApiError ? problem.message : "The gap could not be accepted.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-[480px]">
        {shown ? (
          <>
            <SheetHeader className="border-b bg-[linear-gradient(160deg,#dbe4ff_0%,#f3f6ff_60%,#ffffff_100%)] pb-4 dark:bg-[linear-gradient(160deg,#27346e_0%,#151b30_80%)]">
              <div className="pr-8">
                <span className="inline-block rounded-full border border-[#c9d4f7] bg-white px-2.5 py-0.5 font-mono text-xs font-bold dark:border-white/15 dark:bg-white/10">
                  {shown.code}
                </span>
                <SheetTitle className="mt-2 text-left text-xl leading-tight">{shown.name}</SheetTitle>
                <SheetDescription className="mt-2 flex items-center gap-2 text-left">
                  <TargetMark name={shown.target.name} className="size-6 text-[10px]" />
                  {shown.target.name}
                </SheetDescription>
              </div>
              {(() => {
                const Icon = STATUS_ICON[shown.cell.status as keyof typeof STATUS_ICON] ?? CircleDashed
                return (
                  <span
                    className={cn(
                      "mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
                      STATUS_TONE[shown.cell.status] ?? STATUS_TONE.gap,
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {shown.cell.label}
                  </span>
                )
              })()}
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto bg-muted/30 px-4 py-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Last test</p>
                  <p className="mt-1 leading-snug text-text-secondary">{sentence(shown)}</p>
                </div>
                <div className="rounded-2xl border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Open findings</p>
                  <p className="tabular mt-0.5 text-3xl leading-tight font-semibold">{shown.cell.open_findings}</p>
                  {shown.cell.open_findings > 0 && (
                    <Link
                      href={`/findings?view=open&category=${shown.code}&target_id=${shown.target.id}`}
                      className="mt-1 inline-flex items-center gap-0.5 rounded-md py-0.5 text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${shown.cell.open_findings} open ${shown.cell.open_findings === 1 ? "finding" : "findings"} in this category: see them`}
                    >
                      See them
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </div>

              {shown.accepted_gap && (
                <div className="rounded-2xl border border-warning/40 bg-warning/5 p-3">
                  <p className="font-medium">Gap accepted</p>
                  <p className="mt-1 text-text-secondary">
                    Threat {shown.accepted_gap.threat}: {shown.accepted_gap.reason} ({formatDate(shown.accepted_gap.accepted_at)})
                  </p>
                </div>
              )}

              <section aria-labelledby="panel-threats">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id="panel-threats" className="flex items-center gap-2 text-[13px] font-semibold">
                    <ShieldAlert className="size-4 text-muted-foreground" aria-hidden="true" />
                    Why it applies
                    {shown.threats.length > 0 && (
                      <span className="tabular rounded-full bg-muted px-1.5 text-xs font-normal text-text-secondary">
                        {shown.threats.length}
                      </span>
                    )}
                  </h3>
                  {shown.threat_model_version !== null && shown.threats.length > 0 && (
                    <span className="text-xs text-muted-foreground">threat model v{shown.threat_model_version}</span>
                  )}
                </div>
                {shown.threats.length === 0 ? (
                  <p className="mt-2 rounded-2xl border border-dashed p-3 text-text-secondary">
                    No threat of the approved threat model names this category.{" "}
                    {shown.cell.status === "gap" ? "Sentra's library can test it for this kind of target, so it is still a gap." : ""}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {shown.threats.map((threat) => (
                      <li key={threat.number} className="rounded-2xl border bg-card p-3">
                        <p className="leading-snug font-medium">{threat.title}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-text-secondary">{threat.component}</span>
                            <span className={cn("tabular rounded-full px-2 py-0.5 font-medium", riskTone(threat.risk))}>
                              Risk {threat.risk}
                            </span>
                          </span>
                          {canManage && shown.threat_model_version !== null && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 rounded-full px-3 text-link hover:text-link"
                              onClick={() => setAccepting(threat.number)}
                            >
                              Accept gap…
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="panel-suites">
                <h3 id="panel-suites" className="flex items-center gap-2 text-[13px] font-semibold">
                  <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                  Test suites that cover it
                  {shown.suites.length > 0 && (
                    <span className="tabular rounded-full bg-muted px-1.5 text-xs font-normal text-text-secondary">
                      {shown.suites.length}
                    </span>
                  )}
                </h3>
                {shown.suites.length === 0 ? (
                  <p className="mt-2 rounded-2xl border border-dashed p-3 text-text-secondary">
                    No test of Sentra&apos;s library covers this for a {shown.target.type.replace(/_/g, " ")}. Write a custom test for it,
                    or record why the gap is accepted.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y overflow-hidden rounded-2xl border bg-card">
                    {shown.suites.map((suite) => (
                      <li key={suite.code} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <span className="min-w-0 leading-snug">{suite.name}</span>
                        <span className="tabular shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-text-secondary">
                          {suite.covering} of {suite.tests} tests
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {shown.suites.length > 0 && canCampaign && (
              <div className="border-t bg-card p-4">
                <Button asChild className="h-10 w-full rounded-full hover:bg-primary-hover">
                  <Link href={`/campaigns/new?target=${shown.target.id}&suite=${shown.suites.map((suite) => suite.code).join(",")}`}>
                    Create campaign with these suites
                  </Link>
                </Button>
              </div>
            )}
            <AcceptGapDialog
              gap={
                gap
                  ? {
                      number: gap.number,
                      title: gap.title,
                      component_name: gap.component,
                      owasp: [],
                      risk: gap.risk,
                      out_of_scope: !shown.in_scope,
                      accepted: null,
                    }
                  : null
              }
              busy={busy}
              onClose={() => setAccepting(null)}
              onAccept={accept}
            />
          </>
        ) : (
          <div className="space-y-3 p-4" role="status" aria-label="Loading the category">
            {error ? (
              <p className="text-sm text-destructive">This category could not be loaded.</p>
            ) : (
              <>
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-32 w-full" />
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
