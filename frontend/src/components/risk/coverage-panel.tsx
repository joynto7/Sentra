"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { AcceptGapDialog } from "@/components/threat-models/accept-gap-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { COVERAGE_SYMBOL, type CoverageDetail, getCoverageCell } from "@/lib/risk"
import { formatDate } from "@/lib/targets"
import { acceptThreatGap } from "@/lib/threat-models"

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
            <SheetHeader>
              <SheetTitle className="text-left">
                {shown.code} {shown.name}
              </SheetTitle>
              <SheetDescription className="text-left">{shown.target.name}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-4 pb-4 text-sm">
              <p className="rounded-[7px] border bg-muted/40 p-3">
                <span className="font-medium">
                  <span aria-hidden="true">{COVERAGE_SYMBOL[shown.cell.status]} </span>
                  {shown.cell.label}
                </span>
                <span className="mt-1 block text-text-secondary">{sentence(shown)}</span>
                {shown.cell.open_findings > 0 && (
                  <Link
                    href={`/findings?view=open&category=${shown.code}&target_id=${shown.target.id}`}
                    className="mt-2 inline-block py-1 text-link hover:underline"
                  >
                    {shown.cell.open_findings} open{" "}
                    {shown.cell.open_findings === 1 ? "finding" : "findings"} in this category
                  </Link>
                )}
              </p>

              {shown.accepted_gap && (
                <p className="rounded-[7px] border border-warning/40 bg-warning/5 p-3">
                  <span className="font-medium">Gap accepted</span>
                  <span className="mt-1 block text-text-secondary">
                    Threat {shown.accepted_gap.threat}: {shown.accepted_gap.reason} (
                    {formatDate(shown.accepted_gap.accepted_at)})
                  </span>
                </p>
              )}

              <section aria-labelledby="panel-threats">
                <h3 id="panel-threats" className="text-[13px] font-medium text-muted-foreground">
                  {shown.threats.length > 0
                    ? `Why it applies — threat model v${shown.threat_model_version}`
                    : "Why it applies"}
                </h3>
                {shown.threats.length === 0 ? (
                  <p className="mt-1 text-text-secondary">
                    No threat of the approved threat model names this category.{" "}
                    {shown.cell.status === "gap"
                      ? "Sentra's library can test it for this kind of target, so it is still a gap."
                      : ""}
                  </p>
                ) : (
                  <ul className="mt-1 space-y-2">
                    {shown.threats.map((threat) => (
                      <li key={threat.number} className="flex items-start justify-between gap-3">
                        <span>
                          {threat.title}
                          <span className="block text-xs text-muted-foreground">
                            {threat.component} · risk {threat.risk}
                          </span>
                        </span>
                        {canManage && shown.threat_model_version !== null && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => setAccepting(threat.number)}
                          >
                            Accept gap…
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="panel-suites">
                <h3 id="panel-suites" className="text-[13px] font-medium text-muted-foreground">
                  Test suites that cover it
                </h3>
                {shown.suites.length === 0 ? (
                  <p className="mt-1 text-text-secondary">
                    No test of Sentra&apos;s library covers this for a {shown.target.type.replace(/_/g, " ")}.
                    Write a custom test for it (FR-4.3), or record why the gap is accepted.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {shown.suites.map((suite) => (
                      <li key={suite.code} className="flex justify-between gap-3">
                        <span>{suite.name}</span>
                        <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                          {suite.covering} of {suite.tests} tests
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {shown.suites.length > 0 && canCampaign && (
                <Button asChild className="h-9 w-full hover:bg-primary-hover">
                  <Link
                    href={`/campaigns/new?target=${shown.target.id}&suite=${shown.suites
                      .map((suite) => suite.code)
                      .join(",")}`}
                  >
                    Create campaign with these suites
                  </Link>
                </Button>
              )}
            </div>
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
