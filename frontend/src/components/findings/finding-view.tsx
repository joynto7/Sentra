"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react"

import { HistoryEntry } from "@/components/findings/finding-activity"
import { Reproducibility } from "@/components/findings/finding-badges"
import { FindingHeader } from "@/components/findings/finding-header"
import { FindingTabs } from "@/components/findings/finding-tabs"
import { EmptyState } from "@/components/layout/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { TriagePanel } from "@/components/findings/triage-panel"
import { type FindingDetail, type HistoryItem, getFinding, getHistory } from "@/lib/findings"
import { useCan } from "@/lib/permissions"
import { OPEN_STATUSES, type FindingSeverity, getFindingSeverity } from "@/lib/risk"
import { formatDate, formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-[10px] border bg-card p-5", className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

/** UC-7.1 step 5 and NFR-4.2: why the finding has this severity, in the words of the rating. */
function WhySevere({ code, severity }: { code: string; severity: string }) {
  const [rating, setRating] = useState<FindingSeverity | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getFindingSeverity(code, controller.signal)
      .then(setRating)
      .catch(() => undefined)
    return () => controller.abort()
  }, [code])

  const title = `Why ${severity[0].toUpperCase()}${severity.slice(1)}`
  if (!rating || !rating.factors.impact) {
    return (
      <Card title={title}>
        <p className="text-sm text-muted-foreground">
          {rating
            ? "Not rated yet: the severity is the one of its test definition until a campaign run has been evaluated (FR-4.2)."
            : "Loading…"}
        </p>
      </Card>
    )
  }

  const { impact, exploitability, reproducibility, likelihood } = rating.factors
  return (
    <Card title={title}>
      <dl className="divide-y">
        <Row term={`Impact · level ${impact.level}`}>
          <span className="font-medium">{impact.label}</span>
          <p className="text-xs text-muted-foreground">{impact.sentence}</p>
        </Row>
        {exploitability && (
          <Row term={`Exploitability · level ${exploitability.level}`}>
            {exploitability.sentences.map((sentence) => (
              <p key={sentence} className="text-xs text-muted-foreground">
                {sentence}
              </p>
            ))}
          </Row>
        )}
        {reproducibility && (
          <Row term="Reproducibility">
            <span className="tabular">{reproducibility.value}</span>
            <p className="text-xs text-muted-foreground">{reproducibility.sentence}</p>
          </Row>
        )}
        {likelihood && <Row term="Likelihood">{`Level ${likelihood.level}`}</Row>}
      </dl>
      <p className="text-xs text-muted-foreground">
        Calculated with Sentra&apos;s fixed rating matrix, so the same factors always give the same severity.
        {rating.provisional ? " It is provisional until the repetitions of the measurement are complete." : ""}
        {rating.adjusted && rating.calculated_severity
          ? ` An analyst set this severity; the matrix gave ${rating.calculated_severity}.`
          : ""}
      </p>
    </Card>
  )
}

/** Screen 39: one finding in plain language, with its rating, its detection and its details. */
export function FindingView({ code }: { code: string }) {
  const canTriage = useCan("triage_findings")
  const [finding, setFinding] = useState<FindingDetail | null>(null)
  const [history, setHistory] = useState<HistoryItem[] | null>(null)
  const [triaging, setTriaging] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getFinding(code, controller.signal)
      .then(setFinding)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
    getHistory(code, controller.signal)
      .then(setHistory)
      .catch(() => undefined)
    return () => controller.abort()
  }, [code])

  if (notFound) {
    return (
      <EmptyState
        title="Finding not found"
        description="It doesn't exist, or it belongs to another organization."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/findings">Back to findings</Link>
          </Button>
        }
      />
    )
  }
  if (!finding) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the finding">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const detection = finding.detection

  return (
    <div>
      <FindingHeader
        finding={finding}
        action={
          canTriage &&
          (OPEN_STATUSES as readonly string[]).includes(finding.status) && (
            <Button className="h-9 hover:bg-primary-hover" onClick={() => setTriaging(true)}>
              Triage
            </Button>
          )
        }
      />
      <FindingTabs code={finding.code} active="summary" />

      <TriagePanel finding={finding} open={triaging} onOpenChange={setTriaging} onDone={setFinding} />

      {finding.merged_into && (
        <p role="status" className="mb-5 rounded-[10px] border bg-card p-4 text-sm">
          This finding was merged into{" "}
          <Link href={`/findings/${finding.merged_into}`} className="text-link underline underline-offset-2">
            {finding.merged_into}
          </Link>
          , which has the same root cause. Its evidence and history are read there as well (FR-6.6).
        </p>
      )}

      {finding.status === "false_positive" && (
        <p role="status" className="mb-5 rounded-[10px] border bg-card p-4 text-sm">
          <span className="font-medium">Marked a false positive</span>
          {finding.closed_by ? ` by ${finding.closed_by}` : ""}
          {finding.closed_at ? ` on ${formatDate(finding.closed_at)}` : ""}: {finding.close_reason} It is kept, so
          that the quality of Sentra&apos;s detection can be measured (UC-6.6, 2a1).
        </p>
      )}

      {detection?.requires_confirmation && (OPEN_STATUSES as readonly string[]).includes(finding.status) && (
        <p
          role="status"
          className="mb-5 flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Only the LLM judge supports this finding, so an analyst confirms or rejects it before it counts towards the
          target&apos;s risk score (NFR-9.3).
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="What happened">
              <p className="text-sm text-text-secondary">{finding.description}</p>
            </Card>
            <Card title="Why it matters">
              <p className="text-sm text-text-secondary">{finding.test.objective}</p>
            </Card>
            <Card title="How to fix it">
              <p className="text-sm text-text-secondary">{finding.test.recommended_mitigation}</p>
            </Card>
          </div>

          <WhySevere code={finding.code} severity={finding.severity} />

          <Card title="Detection">
            {detection ? (
              <>
                <p className="text-sm text-text-secondary">{detection.summary}</p>
                <ul className="divide-y rounded-[7px] border">
                  {detection.methods.map((method) => (
                    <li key={method.method} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      {method.outcome === "met" ? (
                        <CircleCheck className="size-4 text-success" aria-hidden="true" />
                      ) : (
                        <CircleX className="size-4 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="font-medium">{method.method_label}</span>
                      <span className="text-muted-foreground">
                        {method.role} · {method.outcome === "met" ? "met" : method.outcome.replace("_", " ")}
                      </span>
                      {method.confidence && (
                        <span className="tabular ml-auto text-xs text-muted-foreground">
                          confidence {method.confidence}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  From attempt {detection.attempt_no} of campaign run {detection.run.code}.
                  {detection.disagreement
                    ? " The LLM judge disagreed with the deterministic methods; the deterministic evidence decided (NFR-9.5)."
                    : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">The attempt behind this finding has not been evaluated.</p>
            )}
            <Button asChild variant="outline" size="sm" className="h-8 w-fit">
              <Link href={`/findings/${finding.code}/evidence`}>Open the evidence</Link>
            </Button>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Details">
            <dl className="divide-y">
              <Row term="Category">
                {finding.category} {finding.category_name}
              </Row>
              <Row term="MITRE ATLAS">{finding.atlas.length ? finding.atlas.join(", ") : "None recorded"}</Row>
              <Row term="Affected component">{finding.component.label}</Row>
              <Row term="Test definition">
                <span className="font-mono text-xs">{finding.test.code}</span> v{finding.test.version}
              </Row>
              <Row term="Success condition">
                <span className="text-xs text-muted-foreground">{finding.test.success_condition}</span>
              </Row>
              <Row term="Reproducibility">
                <Reproducibility value={finding.reproducibility} className="ml-auto" />
                {finding.repetitions && (
                  <div className="text-xs text-muted-foreground">
                    {finding.repetitions.label}
                    {finding.repetitions.status === "incomplete" ? ", incomplete" : ""}
                  </div>
                )}
              </Row>
              <Row term="Owner">{finding.owner ? finding.owner.name : "Nobody yet"}</Row>
              {finding.confirmed_by && (
                <Row term="Confirmed">
                  {finding.confirmed_by}
                  <div className="text-xs text-muted-foreground">
                    {finding.confirmed_at ? formatDateTime(finding.confirmed_at) : ""}
                  </div>
                </Row>
              )}
              {finding.severity_adjusted && (
                <Row term="Severity set by an analyst">
                  <span className="text-xs text-muted-foreground">{finding.severity_justification}</span>
                </Row>
              )}
              <Row term="Evidence records">{finding.evidence_count}</Row>
              <Row term="First seen">
                {formatDateTime(finding.first_seen_at)}
                <div className="font-mono text-xs text-muted-foreground">{finding.first_run.code}</div>
              </Row>
              <Row term="Last seen">
                {formatDateTime(finding.last_seen_at)}
                <div className="font-mono text-xs text-muted-foreground">{finding.last_run.code}</div>
              </Row>
            </dl>
          </Card>

          <Card title="Latest activity">
            {history === null ? (
              <Skeleton className="h-16 w-full" />
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ul className="flex flex-col">
                {history
                  .slice(-3)
                  .reverse()
                  .map((entry) => (
                    <HistoryEntry key={`${entry.finding}-${entry.number}`} entry={entry} code={finding.code} />
                  ))}
              </ul>
            )}
            <Button asChild variant="outline" size="sm" className="h-8 w-fit">
              <Link href={`/findings/${finding.code}/activity`}>The whole history</Link>
            </Button>
          </Card>

          <Card title={`Campaign runs (${finding.runs.length})`}>
            <ul className="space-y-2">
              {finding.runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-mono text-[13px]">{run.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {run.new ? "found here" : "seen again"} · {run.attempts}{" "}
                    {run.attempts === 1 ? "attempt" : "attempts"} · {formatDate(run.first_seen_at)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              A weakness found again adds its evidence to this finding instead of a second one (UC-6.2, 2a).
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
