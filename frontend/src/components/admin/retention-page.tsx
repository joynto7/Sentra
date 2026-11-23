"use client"

import { useCallback, useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { AdminNav } from "@/components/admin/admin-nav"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { fieldErrors } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  KINDS,
  type Periods,
  type Retention,
  type RetentionPreview,
  formatBytes,
  formatCount,
  getRetention,
  previewRetention,
  saveRetention,
} from "@/lib/retention"
import { formatDateTime } from "@/lib/targets"

/** The periods as they are stored, so the page can tell a change from the saved state. */
const periodsOf = (data: Retention): Periods => ({
  evidence_days: data.evidence.days,
  campaign_days: data.campaign.days,
  report_days: data.reports.days,
})

const same = (a: Periods, b: Periods) =>
  a.evidence_days === b.evidence_days &&
  a.campaign_days === b.campaign_days &&
  a.report_days === b.report_days

/**
 * Screen 60 (UC-10.7, UC-10.8): the three retention periods of the organization, what each one
 * holds today, what the next clean-up would delete with the periods being typed, and what the
 * last clean-up did. Saving writes the periods and deletes nothing.
 */
export function RetentionPage() {
  const canManage = useCan("manage_data_settings")
  const organization = useSession().organization
  const [data, setData] = useState<Retention | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [periods, setPeriods] = useState<Periods | null>(null)
  // The preview is kept with the periods it was asked about, so numbers of an earlier state can
  // never be shown next to the numbers being typed.
  const [preview, setPreview] = useState<{ asked: Periods; result: RetentionPreview } | null>(null)
  const [password, setPassword] = useState("")
  const [understood, setUnderstood] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState("")
  const [busy, setBusy] = useState(false)

  usePageCrumbs([{ label: "Data Retention" }])

  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController()
    getRetention(controller.signal)
      .then((found) => {
        setData(found)
        setPeriods(periodsOf(found))
        setFailed(false)
      })
      .catch(() => !controller.signal.aborted && setFailed(true))
    return () => controller.abort()
  }, [canManage, reloads])

  /** What is wrong with a period, in the page's own words (the server says it again on save). */
  const wrong = useCallback(
    (field: keyof Periods): string | undefined => {
      const kind = KINDS.find((one) => one.field === field)
      const value = periods?.[field]
      if (!kind || !data || value === undefined) return undefined
      const { minimum, maximum } = data[kind.key]
      if (!Number.isInteger(value) || value < minimum || value > maximum) {
        return `Keep ${kind.label.toLowerCase()} between ${formatCount(minimum)} and ${formatCount(
          maximum,
        )} days.`
      }
      return undefined
    },
    [data, periods],
  )

  const valid = periods !== null && KINDS.every((kind) => !wrong(kind.field))
  const changed = data !== null && periods !== null && !same(periods, periodsOf(data))

  // Step 4: the preview follows what is typed, a moment later, and only for periods that could
  // be saved at all. It is the same code that deletes, asked to count.
  useEffect(() => {
    if (!periods || !valid || !changed) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      previewRetention(periods, controller.signal)
        .then((result) => setPreview({ asked: periods, result }))
        .catch(() => undefined)
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [periods, valid, changed])

  if (canManage === false) {
    return (
      <EmptyState
        title="Only Organization Administrators set the retention periods"
        description="Ask an Organization Administrator of your organization how long Sentra keeps its data."
      />
    )
  }

  const shown = preview && periods && changed && same(preview.asked, periods) ? preview.result : null
  const warns = (shown?.open_findings.length ?? 0) > 0
  const save = async () => {
    if (!periods) return
    setBusy(true)
    setErrors({})
    setProblem("")
    try {
      const saved = await saveRetention(periods, password)
      setData(saved)
      setPeriods(periodsOf(saved))
      setPassword("")
      setUnderstood(false)
      setPreview(null)
      toast.success("The retention periods are saved", {
        description: `They apply from the next clean-up, daily at ${saved.clean_up_at}.`,
      })
    } catch (error) {
      const named = fieldErrors(error)
      if (Object.keys(named).length) setErrors(named)
      else setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const name = organization?.name ?? "the organization"
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AdminNav />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data Retention</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How long {name} keeps evidence, campaign data and reports.
          </p>
        </div>

        {failed && (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The retention periods could not be loaded.
              <Button variant="outline" size="sm" onClick={() => setReloads((n) => n + 1)}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!data && !failed && (
          <div className="space-y-3" role="status" aria-label="Loading the retention periods">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {data && periods && (
          <>
            {data.using_defaults && (
              <p className="text-[13px] text-text-secondary">
                These are the platform&apos;s default periods. {name} has not set its own yet.
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              {KINDS.map((kind) => {
                const amount = data[kind.key]
                const invalid = wrong(kind.field)
                return (
                  <section
                    key={kind.key}
                    className="rounded-[10px] border bg-card p-4"
                    aria-labelledby={`${kind.key}-heading`}
                  >
                    <h2 id={`${kind.key}-heading`} className="text-[15px] font-semibold">
                      {kind.label}
                    </h2>
                    <p className="mt-1 text-xs text-text-secondary">{kind.about}</p>
                    <div className="mt-3">
                      <Label htmlFor={`${kind.key}-days`} className="text-[13px]">
                        {/* The three fields read the same on screen, so each one names its kind
                            for anybody who hears the form instead of seeing it (WCAG 2.4.6). */}
                        Kept for<span className="sr-only"> ({kind.label})</span>
                      </Label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Input
                          id={`${kind.key}-days`}
                          type="number"
                          inputMode="numeric"
                          min={amount.minimum}
                          max={amount.maximum}
                          value={periods[kind.field]}
                          aria-describedby={`${kind.key}-range ${kind.key}-stored`}
                          aria-invalid={invalid ? true : undefined}
                          onChange={(event) =>
                            setPeriods({
                              ...periods,
                              [kind.field]: Number(event.target.value),
                            })
                          }
                          className="h-9 w-28 tabular"
                        />
                        <span className="text-[13px] text-text-secondary">days</span>
                      </div>
                      <p id={`${kind.key}-range`} className="mt-1.5 text-xs text-muted-foreground">
                        Allowed: {formatCount(amount.minimum)}–{formatCount(amount.maximum)} days
                      </p>
                      {invalid && (
                        <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                          {invalid}
                        </p>
                      )}
                      {errors[kind.field] && (
                        <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                          {errors[kind.field]}
                        </p>
                      )}
                    </div>
                    <p id={`${kind.key}-stored`} className="mt-3 border-t pt-3 text-[13px]">
                      <span className="tabular">{formatBytes(amount.bytes)}</span>
                      <span className="text-text-secondary">
                        {" "}
                        · {formatCount(amount.items)}{" "}
                        {kind.key === "reports"
                          ? amount.items === 1
                            ? "file"
                            : "files"
                          : amount.items === 1
                            ? "item"
                            : "items"}
                      </span>
                    </p>
                  </section>
                )
              })}
            </div>

            <section
              aria-labelledby="change-heading"
              className="space-y-4 rounded-[10px] border bg-card p-5"
            >
              <h2 id="change-heading" className="text-[15px] font-semibold">
                {changed ? "Save the new periods" : "Change the periods"}
              </h2>

              <div aria-live="polite" className="space-y-3">
                {!changed && (
                  <p className="text-[13px] text-text-secondary">
                    Change a period above to see what the next clean-up would delete. Nothing is
                    deleted when you save: the clean-up runs daily at {data.clean_up_at}, so a
                    change can still be corrected before any data is gone.
                  </p>
                )}
                {shown && (
                  <p className="rounded-[7px] border bg-muted/40 p-3 text-[13px]">
                    With these periods, the next clean-up (daily at {data.clean_up_at}) would
                    delete <span className="tabular">{formatCount(shown.evidence_items)}</span>{" "}
                    evidence {shown.evidence_items === 1 ? "item" : "items"} (
                    {formatBytes(shown.evidence_bytes)}),{" "}
                    <span className="tabular">{formatCount(shown.attempts)}</span>{" "}
                    {shown.attempts === 1 ? "attempt" : "attempts"} and{" "}
                    <span className="tabular">{formatCount(shown.reports)}</span>{" "}
                    {shown.reports === 1 ? "report" : "reports"}.
                    {shown.postponed > 0 && (
                      <>
                        {" "}
                        <span className="tabular">{formatCount(shown.postponed)}</span>{" "}
                        {shown.postponed === 1 ? "item waits" : "items wait"} for a later
                        clean-up, because a run is still using them or their evidence is kept
                        longer.
                      </>
                    )}
                  </p>
                )}
                {warns && shown && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-3 text-[13px] text-warning"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div className="space-y-2">
                      <p>
                        The evidence of {formatCount(shown.open_findings.length)} open{" "}
                        {shown.open_findings.length === 1 ? "finding" : "findings"} would be
                        deleted. Their summaries are kept, so the findings stay in Sentra without
                        their proof: {shown.open_findings.join(", ")}.
                      </p>
                      {/* Named by its own label, as every other checkbox of the app is: the
                          sentence above is the warning, not a description of the box. */}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="retention-understood"
                          checked={understood}
                          onCheckedChange={(on) => setUnderstood(Boolean(on))}
                        />
                        <label htmlFor="retention-understood" className="font-medium">
                          I understand
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="max-w-sm">
                <Label htmlFor="retention-password" className="text-[13px]">
                  Confirm with your password
                </Label>
                <Input
                  id="retention-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={errors.password ? true : undefined}
                  className="mt-1.5 h-9"
                />
                {errors.password && (
                  <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                    {errors.password}
                  </p>
                )}
              </div>

              {problem && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{problem}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={save}
                disabled={busy || !changed || !valid || !password || (warns && !understood)}
                className="h-9 hover:bg-primary-hover"
              >
                Save retention periods
              </Button>
            </section>

            <section
              aria-labelledby="last-heading"
              className="rounded-[10px] border bg-card p-5 text-[13px]"
            >
              <h2 id="last-heading" className="text-[15px] font-semibold">
                Last clean-up
              </h2>
              {data.last_run ? (
                <p className="mt-2">
                  {formatDateTime(data.last_run.started_at)} · deleted{" "}
                  <span className="tabular">{formatCount(data.last_run.evidence_deleted)}</span>{" "}
                  evidence {data.last_run.evidence_deleted === 1 ? "item" : "items"},{" "}
                  <span className="tabular">{formatCount(data.last_run.attempts_deleted)}</span>{" "}
                  {data.last_run.attempts_deleted === 1 ? "attempt" : "attempts"} and{" "}
                  <span className="tabular">{formatCount(data.last_run.reports_deleted)}</span>{" "}
                  {data.last_run.reports_deleted === 1 ? "report" : "reports"} ·{" "}
                  <span className="tabular">{formatCount(data.last_run.failures)}</span>{" "}
                  {data.last_run.failures === 1 ? "failure" : "failures"}
                  {data.last_run.postponed > 0 && (
                    <>
                      {" "}
                      · <span className="tabular">{formatCount(data.last_run.postponed)}</span>{" "}
                      postponed
                    </>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-text-secondary">
                  No clean-up has run yet. The first one runs at {data.clean_up_at}.
                </p>
              )}
              <p className="mt-3 border-t pt-3 text-muted-foreground">
                The audit log isn&apos;t affected by these periods and is kept for at least{" "}
                {Math.round(data.audit_log_days / 365)} year
                {data.audit_log_days >= 730 ? "s" : ""}.
              </p>
              {data.changed_at && (
                <p className="mt-1 text-muted-foreground">
                  Periods last changed {formatDateTime(data.changed_at)}
                  {data.changed_by ? `, by ${data.changed_by}` : ""}.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
