"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleCheck, CircleHelp, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { PageHeader } from "@/components/layout/page-header"
import { OutcomeChip } from "@/components/remediation/badges"
import { BeforeAfter } from "@/components/remediation/before-after"
import { ReportDialog } from "@/components/reports/report-dialog"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type BenignCheck,
  type Retest,
  getRetest,
  reviewBenignCheck,
  startRetest,
} from "@/lib/remediation"
import { BAND_LABEL, type RiskBand } from "@/lib/risk"
import { formatDateTime } from "@/lib/targets"

const POLL = 4000

/** The banner of UC-8.6 step 5: what the retest decided, in words and with the counts behind it. */
function Verdict({ retest }: { retest: Retest }) {
  const attack = retest.figures.attack_success
  if (retest.running) {
    return (
      <Alert role="status" className="mb-4">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <AlertDescription>
          <span className="font-medium text-foreground">{retest.status_label}.</span> Sentra repeats
          the {retest.attempts_repeated}{" "}
          {retest.attempts_repeated === 1 ? "request" : "requests"} that proved {retest.finding.code}{" "}
          {retest.repetitions} times each, and sends the requests of normal use beside them. The
          comparison appears here when it is finished.
        </AlertDescription>
      </Alert>
    )
  }
  if (retest.status === "failed" || retest.status === "cancelled") {
    return (
      <Alert variant={retest.status === "failed" ? "destructive" : undefined} role="status" className="mb-4">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <AlertDescription>
          <span className="font-medium">{retest.status_label}.</span>{" "}
          {retest.message ?? "The finding stays as it was."}
        </AlertDescription>
      </Alert>
    )
  }
  const closed = retest.verdict === "closed"
  const open = retest.verdict === "still_open"
  const Icon = closed ? CircleCheck : open ? TriangleAlert : CircleHelp
  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-3 rounded-[10px] border p-4 ${
        closed
          ? "border-success/40 bg-success/5"
          : open
            ? "border-destructive/40 bg-destructive/5"
            : "border-border-strong bg-muted/30"
      }`}
    >
      <Icon
        className={`mt-0.5 size-5 shrink-0 ${closed ? "text-success" : open ? "text-destructive" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">
          {retest.verdict_label}
          {" — "}
          {closed
            ? `no repeated attempt succeeded after the fix (${attack.after_successes} of ${attack.after_attempts})`
            : open
              ? `${attack.after_successes} of ${attack.after_attempts} repeated attempts still succeed`
              : "the measurement does not support a conclusion"}
        </h2>
        {retest.out_of_date && (
          <p className="mt-1 text-[13px] text-warning">A rollback has removed this fix from the traffic.</p>
        )}
      </div>
    </div>
  )
}

/** One of the three cards, with its figure large and the same figure in words under it. */
function Card({
  title,
  figure,
  words,
  note,
  action,
}: {
  title: string
  figure: React.ReactNode
  words: string
  note?: string
  action?: React.ReactNode
}) {
  return (
    <div className="min-w-0 rounded-[10px] border bg-card p-4">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      <p className="tabular mt-2 text-xl font-semibold">{figure}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{words}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** UC-8.7 step 3: one request of normal use the fix refused or changed, with what came back. */
function BenignExample({
  check,
  code,
  canRequest,
  onReviewed,
}: {
  check: BenignCheck
  code: string
  /** undefined while the reader's permissions are still being read. */
  canRequest: boolean | undefined
  onReviewed: (retest: Retest) => void
}) {
  const [busy, setBusy] = useState<"fine" | "needs_revision" | null>(null)

  const judge = useCallback(
    async (judgement: "fine" | "needs_revision") => {
      setBusy(judgement)
      try {
        onReviewed(await reviewBenignCheck(code, check.id, judgement))
        toast.success(
          judgement === "fine"
            ? "Noted: the answer still does its job."
            : "Noted: this one needs a revised remediation.",
        )
      } catch (problem) {
        toast.error(
          problem instanceof ApiError ? problem.message : "The judgement could not be saved.",
        )
      } finally {
        setBusy(null)
      }
    },
    [check.id, code, onReviewed],
  )

  return (
    <li className="rounded-[7px] border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm">{check.text}</p>
        <OutcomeChip outcome={check.outcome} label={check.outcome_label} />
      </div>
      {check.what_happened && (
        <p className="mt-1 text-[13px] text-muted-foreground">{check.what_happened}</p>
      )}
      {check.reply && (
        <p className="mt-2 border-l-2 pl-3 text-[13px] text-text-secondary">{check.reply}</p>
      )}
      {check.review === "pending" ? (
        canRequest && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={busy !== null}
              onClick={() => judge("fine")}
            >
              {busy === "fine" ? "Saving…" : "Looks fine"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={busy !== null}
              onClick={() => judge("needs_revision")}
            >
              {busy === "needs_revision" ? "Saving…" : "Needs revision"}
            </Button>
          </div>
        )
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {check.review_label}
          {check.reviewed_by ? ` · ${check.reviewed_by}` : ""}
          {check.reviewed_at ? ` · ${formatDateTime(check.reviewed_at)}` : ""}
        </p>
      )}
    </li>
  )
}

/**
 * Screen 51 (UC-8.6 and UC-8.7): what the retest measured before and after the fix, and what it
 * means. The attack success is a rate over repeated attempts and never a single outcome, the
 * requests of normal use say what the fix did to them with the examples themselves, and the
 * conclusion is in plain language (NFR-4.2). From here a person keeps the remediation, asks for a
 * revision (5a1, 5b1), rolls the policy back (UC-8.8) or puts the comparison in a report (5c1).
 */
export function RetestView({ code, number }: { code: string; number?: number }) {
  const canRequest = useCan("request_remediations")
  const [data, setData] = useState<Retest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [showing, setShowing] = useState<number | null>(number ?? null)
  const [history, setHistory] = useState<number[]>([])

  usePageCrumbs([
    { label: code, href: `/remediation/${code}` },
    { label: showing && history.length > 1 ? `Retest ${showing}` : "Retest" },
  ])

  useEffect(() => {
    const controller = new AbortController()
    getRetest(code, showing ?? undefined, controller.signal)
      .then((found) => {
        setData(found)
        setError(null)
        setShowing(found.number)
        setHistory((now) => (now.includes(found.number) ? now : [...now, found.number].sort((a, b) => b - a)))
      })
      .catch((problem) => {
        if (controller.signal.aborted) return
        setError(problem instanceof ApiError ? problem.message : "The retest could not be loaded.")
      })
    return () => controller.abort()
  }, [code, showing, attempt])

  // While the retest runs, the page follows it: its run sends the attempts and then the requests
  // of normal use, and the comparison is there when both halves are in (UC-8.6 steps 2-4).
  useEffect(() => {
    if (!data?.running) return
    const timer = setInterval(() => setAttempt((n) => n + 1), POLL)
    return () => clearInterval(timer)
  }, [data?.running])

  const again = useCallback(async () => {
    setBusy(true)
    try {
      const made = await startRetest(code)
      setShowing(made.number)
      setAttempt((n) => n + 1)
      toast.success("Sentra is retesting the finding.")
    } catch (problem) {
      toast.error(
        problem instanceof ApiError ? problem.message : "The retest could not be started again.",
      )
    } finally {
      setBusy(false)
    }
  }, [code])

  if (error) {
    return (
      <>
        <PageHeader title={`Retest of ${code}`} />
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            {error}
            <Button asChild variant="outline" size="sm">
              <Link href={`/remediation/${code}`}>Open the proposal</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </>
    )
  }

  if (!data) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the retest">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const { figures } = data
  const normal = figures.normal_use
  const risk = figures.risk_score
  const affected = data.benign_checks.filter((one) => one.outcome !== "answered")
  const canStartAgain = canRequest && (data.status === "failed" || data.status === "cancelled")

  return (
    <>
      <PageHeader
        title={`Retest of ${data.finding.code}`}
        description={data.finding.title}
        action={
          canStartAgain ? (
            <Button className="h-9 hover:bg-primary-hover" onClick={again} disabled={busy}>
              {busy ? "Starting…" : "Start the retest again"}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <SeverityBadge severity={data.finding.severity} />
        <Link href={`/findings/${data.finding.code}`} className="py-1 text-link hover:underline">
          Open the finding
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/targets/${data.finding.target_id}`} className="py-1 text-link hover:underline">
          {data.finding.target_name}
        </Link>
        {data.run_code && (
          <>
            <span className="text-muted-foreground">·</span>
            {/* A retest run belongs to no campaign, so there is no run page to open; the code is
                here to find it again in the audit log and in the logs. */}
            <span className="py-1">Retest run {data.run_code}</span>
          </>
        )}
        <span className="text-muted-foreground">· {formatDateTime(data.started_at)}</span>
        {history.length > 1 && (
          <FilterSelect
            label="Retest"
            value={String(data.number)}
            onChange={(value) => setShowing(Number(value))}
            options={history.map((one) => ({
              value: String(one),
              label: `Retest ${one}${one === history[0] ? " (newest)" : ""}`,
            }))}
            allLabel={null}
            changed={data.number !== history[0]}
          />
        )}
      </div>

      <Verdict retest={data} />

      {!data.running && data.status === "completed" && (
        <>
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <Card
              title="Attack success"
              figure={
                <>
                  {figures.attack_success.before_rate ?? 0} % <span aria-hidden="true">→</span>{" "}
                  <span className="sr-only">down to</span>
                  {figures.attack_success.after_rate ?? 0} %
                </>
              }
              words={`Before ${figures.attack_success.before_words} → after ${figures.attack_success.after_words}`}
              note={`${data.test_code} · ${data.repetitions} repetitions of each request`}
            />
            <Card
              title="Normal use affected"
              figure={
                normal.total ? (
                  <>
                    {normal.affected} of {normal.total}
                  </>
                ) : (
                  "not measured"
                )
              }
              words={
                normal.total
                  ? `${normal.affected_words} — ${normal.blocked} refused, ${normal.changed} changed`
                  : "No request of normal use was answered, so the effect on normal use isn't measured."
              }
              note={normal.generic_set ? "Generic examples, not this target's own" : undefined}
              action={
                affected.length > 0 ? (
                  <Button asChild variant="link" className="h-6 p-0 text-[13px]">
                    <a href="#normal-use">Review examples</a>
                  </Button>
                ) : undefined
              }
            />
            <Card
              title="Risk score"
              figure={
                risk.before !== null && risk.after !== null ? (
                  <>
                    {risk.before} <span aria-hidden="true">→</span>{" "}
                    <span className="sr-only">then</span>
                    {risk.after}
                  </>
                ) : (
                  "—"
                )
              }
              words={
                risk.after !== null && risk.band_after
                  ? `${BAND_LABEL[risk.band_after as RiskBand]}${
                      risk.change === 0
                        ? " — unchanged"
                        : risk.change !== null
                          ? ` — ${risk.change > 0 ? "up" : "down"} ${Math.abs(risk.change)}`
                          : ""
                    }`
                  : "The target has no risk score yet."
              }
              note={
                risk.band_before && risk.band_after && risk.band_before !== risk.band_after
                  ? `${BAND_LABEL[risk.band_before as RiskBand]} before`
                  : "Other findings of this target count towards it too."
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
              <BeforeAfter figures={figures} />

              {data.conclusion && (
                <section
                  aria-labelledby="conclusion"
                  className="rounded-[10px] border bg-card p-4"
                >
                  <h2 id="conclusion" className="text-[15px] font-semibold">
                    What this means
                  </h2>
                  <p className="mt-1 text-sm">{data.conclusion}</p>
                </section>
              )}

              <section
                id="normal-use"
                aria-labelledby="normal-use-heading"
                className="rounded-[10px] border bg-card p-4"
              >
                <h2 id="normal-use-heading" className="text-[15px] font-semibold">
                  {affected.length > 0
                    ? `Requests of normal use the fix affected (${affected.length})`
                    : "Requests of normal use"}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {normal.total === 0
                    ? "No example of normal use was answered during this retest, so what the fix does to ordinary requests is not measured."
                    : affected.length === 0
                      ? `All ${normal.total} examples of normal use were answered as before: the fix does not get in the way of ordinary requests.`
                      : "Each example was sent to the application the way a person would use it. Say whether the answer still does its job."}
                </p>
                {affected.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {affected.map((check) => (
                      <BenignExample
                        key={check.id}
                        check={check}
                        code={code}
                        canRequest={canRequest}
                        onReviewed={(found) => setData(found)}
                      />
                    ))}
                  </ul>
                )}
                {normal.generic_set && (
                  <p className="mt-3 border-t pt-3 text-[13px] text-warning">
                    This target has no Benign Request Set of its own, so a generic set was used and
                    this half of the comparison is less reliable.{" "}
                    <Link
                      href={`/targets/${data.finding.target_id}/profile`}
                      className="text-link underline underline-offset-2"
                    >
                      Add examples of normal use
                    </Link>
                    .
                  </p>
                )}
              </section>
            </div>

            <aside aria-labelledby="verified" className="space-y-4">
              <section className="rounded-[10px] border bg-card p-4">
                <h2 id="verified" className="text-[15px] font-semibold">
                  What was verified
                </h2>
                <dl className="mt-2 space-y-2 text-[13px]">
                  <div>
                    <dt className="text-muted-foreground">Remediation</dt>
                    <dd>
                      <Link
                        href={`/remediation/${code}`}
                        className="text-link hover:underline"
                      >
                        Version {data.version} of the proposal
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">In the traffic</dt>
                    <dd>
                      {data.policy_version ? (
                        <Link
                          href={`/targets/${data.finding.target_id}/shield`}
                          className="text-link underline underline-offset-2"
                        >
                          Shield Policy v{data.policy_version}
                        </Link>
                      ) : (
                        "No gateway policy — the fixes are changes in the application"
                      )}
                      {data.changes_marked > 0 &&
                        ` · ${data.changes_marked} application ${data.changes_marked === 1 ? "change" : "changes"} marked`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Measured with</dt>
                    <dd>
                      {data.test_code} · the same {data.attempts_repeated}{" "}
                      {data.attempts_repeated === 1 ? "request" : "requests"} that proved the
                      finding, {data.repetitions} times each
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Normal use</dt>
                    <dd>
                      {normal.total
                        ? `${normal.total} ${normal.generic_set ? "generic examples" : "examples of this target's own"}`
                        : "not measured"}
                    </dd>
                  </div>
                  {data.finished_at && (
                    <div>
                      <dt className="text-muted-foreground">Finished</dt>
                      <dd>{formatDateTime(data.finished_at)}</dd>
                    </div>
                  )}
                </dl>
              </section>

              <section aria-labelledby="next" className="rounded-[10px] border bg-card p-4">
                <h2 id="next" className="text-[15px] font-semibold">
                  What now
                </h2>
                <div className="mt-2 space-y-2">
                  {canRequest && (
                    <Button asChild variant="outline" className="h-9 w-full">
                      <Link href={`/remediation/${code}`}>Request revised remediation</Link>
                    </Button>
                  )}
                  {data.policy_version && canRequest && (
                    <Button asChild variant="outline" className="h-9 w-full">
                      <Link href={`/targets/${data.finding.target_id}/shield`}>
                        Roll back policy
                      </Link>
                    </Button>
                  )}
                  {/* 5c1: the comparison as evidence for management or an audit (FR-9.1). */}
                  <Button
                    variant="link"
                    className="h-8 w-full p-0 text-[13px]"
                    onClick={() => setReporting(true)}
                  >
                    Add to report
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {data.verdict === "closed"
                    ? "Keeping the remediation needs no action: the finding is fixed and verified."
                    : "The finding stays open until a retest finds nothing."}
                </p>
              </section>
            </aside>
          </div>

          <ReportDialog
            open={reporting}
            preset={{
              target_id: data.finding.target_id,
              period_days: 90,
              category: null,
              label: `${data.finding.target_name}, with the verification of its findings`,
              from: "this target",
              type: "technical",
            }}
            onClose={() => setReporting(false)}
            onDone={() => setReporting(false)}
          />
        </>
      )}
    </>
  )
}
