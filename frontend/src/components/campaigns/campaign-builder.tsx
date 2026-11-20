"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ApiError } from "@/lib/api"
import {
  EMPTY_DRAFT,
  type ScheduleDraft,
  ScheduleFields,
  scheduleInput,
  scheduleProblem,
} from "@/components/campaigns/schedule-fields"
import { type Estimate, createCampaign, estimateCampaign, formatCount } from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { ENVIRONMENT_LABEL, TYPE_LABEL, type Target, listTargets } from "@/lib/targets"
import { type SuiteItem, listSuites } from "@/lib/test-library"
import { cn } from "@/lib/utils"

const FIELD_ORDER = ["name", "target_id", "suites", "attempt_budget", "request_rate", "window", "repetitions"]
const FIELD_IDS: Record<string, string> = {
  name: "campaign-name",
  target_id: "campaign-target",
  suites: "campaign-suites",
  attempt_budget: "attempt-budget",
  request_rate: "request-rate",
  window: "window-start",
  repetitions: "repetitions",
  schedule_kind: "schedule-once",
  schedule_run_at: "schedule-run-at",
  schedule_at_time: "schedule-at-time",
}

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)
// The rate starts at three quarters of the target's safe rate; the user may raise it up to the limit.
const startingRate = (target: Target) => String(Math.max(1, Math.floor(target.max_request_rate * 0.75)))

function Section({ number, id, title, children }: { number: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-[10px] border bg-card p-6">
      <h2 id={id} className="flex items-center gap-2.5 text-[15px] font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs" aria-hidden="true">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * Screen 34, the campaign builder: UC-5.1 Create Campaign (alternatives 2a and 6a). One page with
 * numbered sections and a summary card that estimates the attempts before saving. Creating a
 * campaign sends nothing to the target.
 */
export function CampaignBuilder({ target: preselected, suite }: { target?: string; suite?: string }) {
  const router = useRouter()
  const canCreate = useCan("manage_campaigns")
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", [])
  const [targets, setTargets] = useState<Target[] | null>(null)
  const [suites, setSuites] = useState<SuiteItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState("")
  const [targetId, setTargetId] = useState(preselected ?? "")
  // Screen 07 names one suite; Screen 43's gap panel names the suites that cover a category.
  const [chosen, setChosen] = useState<string[]>(suite ? suite.split(",").filter(Boolean) : [])
  const [adaptive, setAdaptive] = useState(false)
  const [budget, setBudget] = useState("1000")
  const [rate, setRate] = useState("")
  const [repetitions, setRepetitions] = useState("5")
  const [windowStart, setWindowStart] = useState("")
  const [windowEnd, setWindowEnd] = useState("")
  // UC-5.1 step 5: when the campaign runs. It saves no schedule when it runs immediately.
  const [schedule, setSchedule] = useState<ScheduleDraft>(EMPTY_DRAFT)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const leaving = useRef(false)
  // The target whose saved suites were already applied; a suite named in the address wins.
  const defaultsFor = useRef<string | null>(suite ? (preselected ?? null) : null)

  usePageCrumbs([{ label: "New Campaign" }])

  useEffect(() => {
    listTargets(new URLSearchParams({ tab: "active", page_size: "100" }))
      .then((list) => {
        setTargets(list.items)
        // "Create campaign" on a target (UC-5.1 trigger) preselects it, if it can be tested.
        const start = list.items.find((t) => t.id === preselected && t.status === "verified")
        if (start) setRate(startingRate(start))
        else setTargetId("")
      })
      .catch(() => setFailed(true))
    listSuites()
      .then((found) => {
        setSuites(found)
        // A suite chosen in advance that doesn't exist (any more) isn't kept.
        setChosen((current) => current.filter((code) => found.some((s) => s.code === code)))
      })
      .catch(() => setFailed(true))
  }, [preselected])

  const target = targets?.find((t) => t.id === targetId)
  const verified = targets?.filter((t) => t.status === "verified") ?? []

  // The summary card (UC-5.1 step 6), from the API shortly after the choices change.
  useEffect(() => {
    if (canCreate !== true) return
    let active = true
    const timer = setTimeout(() => {
      estimateCampaign({ target_id: targetId || null, suites: chosen, attempt_budget: whole(budget) })
        .then((result) => {
          if (!active) return
          setEstimate(result)
          // UC-5.1 step 2: the suites saved for the target's threat model (FR-3.4) start ticked.
          // Once per target, so a choice of the analyst's is never overwritten.
          const brief = result.threat_model
          if (targetId && brief && defaultsFor.current !== targetId) {
            defaultsFor.current = targetId
            if (brief.default_suites.length > 0) setChosen(brief.default_suites)
          }
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [targetId, chosen, budget, canCreate])

  useEffect(() => {
    if (!touched) return
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [touched])

  // UC-5.1, 6a: the safe-rate limit is named as soon as it is exceeded.
  const rateValue = whole(rate)
  const rateError =
    target && rateValue !== null && rateValue > target.max_request_rate
      ? `The rate can't exceed the target's safe rate of ${target.max_request_rate} per minute.`
      : errors.request_rate

  function touch() {
    setTouched(true)
  }

  function clearError(field: string) {
    setErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function focusFirst(found: Record<string, string>) {
    const first = FIELD_ORDER.find((field) => found[field])
    const element = first ? document.getElementById(FIELD_IDS[first]) : null
    const focusable = element?.matches("input, button") ? element : element?.querySelector<HTMLElement>("input, button")
    if (focusable) requestAnimationFrame(() => focusable.focus())
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    const wrong = scheduleProblem(schedule)
    if (wrong) {
      setErrors({ [schedule.kind === "once" ? "schedule_run_at" : "schedule_at_time"]: wrong })
      focusFirst({ [schedule.kind === "once" ? "schedule_run_at" : "schedule_at_time"]: wrong })
      return
    }
    setBusy(true)
    try {
      const saved = await createCampaign({
        name,
        target_id: targetId || null,
        suites: chosen,
        adaptive_agent: adaptive,
        attempt_budget: whole(budget),
        request_rate: whole(rate),
        repetitions: whole(repetitions),
        window_start: windowStart || null,
        window_end: windowEnd || null,
        time_zone: timeZone,
        schedule: scheduleInput(schedule),
      })
      leaving.current = true
      // UC-5.1 step 7: a campaign that runs immediately has its first run already (UC-5.3), and
      // the monitor is where it is followed; 7a and 3a say why no run started.
      if (saved.launched_run) {
        toast.success(`${saved.code} saved and launched`, { description: `Run ${saved.launched_run.code}` })
        router.push(`/campaigns/${saved.code}/runs/${saved.launched_run.number}`)
        return
      }
      toast.success(`${saved.code} saved`, {
        description: saved.launch_error ?? "Nothing has been sent to the target.",
      })
      router.push(`/campaigns/${saved.code}`)
    } catch (error) {
      setBusy(false)
      if (!(error instanceof ApiError)) {
        setFormError("Something went wrong. Try again.")
        return
      }
      const found: Record<string, string> = {}
      for (const detail of error.details ?? []) found[detail.field] = detail.message
      setErrors(found)
      setFormError(
        error.code === "validation_error" ? "Some settings need attention. Each problem is shown next to its field." : error.message,
      )
      focusFirst(found)
    }
  }

  if (canCreate === false) {
    return (
      <EmptyState
        title="Only Security Analysts create campaigns"
        description="You can follow the campaigns of your organization. Ask a Security Analyst to create one."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/campaigns">Back to campaigns</Link>
          </Button>
        }
      />
    )
  }
  if (failed) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>The campaign builder could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }
  if (!targets || !suites || canCreate === undefined) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the campaign builder">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const budgetValue = whole(budget)

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">New Campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What is tested, how much and how fast. Creating a campaign sends nothing to the target.
        </p>
      </div>

      {formError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form id="campaign" onSubmit={save} noValidate className="min-w-0 space-y-5">
          <div className="rounded-[10px] border bg-card p-6">
            <FormField id="campaign-name" label="Campaign name" error={errors.name}>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  touch()
                }}
                maxLength={120}
                autoComplete="off"
                placeholder="Quarterly assessment — Payments Operations Agent"
                className="h-9 sm:max-w-xl"
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? "campaign-name-error" : undefined}
              />
            </FormField>
          </div>

          <Section number={1} id="target-heading" title="Target">
            {verified.length === 0 ? (
              <p className="text-sm">
                No target of your organization is verified yet. A campaign can only test a target whose ownership
                has been verified.{" "}
                <Link href="/targets" className="font-medium text-link hover:underline">
                  Go to targets
                </Link>
              </p>
            ) : (
              <FormField id="campaign-target" label="Target" error={errors.target_id}>
                <Select
                  value={targetId}
                  onValueChange={(value) => {
                    setTargetId(value)
                    const next = targets.find((t) => t.id === value)
                    setRate(next ? startingRate(next) : "")
                    clearError("target_id")
                    touch()
                  }}
                >
                  <SelectTrigger
                    id="campaign-target"
                    className="h-9 w-full sm:max-w-xl"
                    aria-invalid={!!errors.target_id || undefined}
                    aria-describedby={describedBy(target && "campaign-target-help", errors.target_id && "campaign-target-error")}
                  >
                    <SelectValue placeholder="Choose a target" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={t.id} disabled={t.status !== "verified"}>
                        {t.name} ({ENVIRONMENT_LABEL[t.environment].toLowerCase()} ·{" "}
                        {t.status === "verified" ? "Verified" : "Verify ownership first"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {target && (
                  <p id="campaign-target-help" className="text-xs text-muted-foreground">
                    {TYPE_LABEL[target.type]} · safe rate {target.max_request_rate} per minute
                  </p>
                )}
              </FormField>
            )}
          </Section>

          <Section number={2} id="suites-heading" title="Test suites">
            {target && estimate && !estimate.threat_model && (
              // UC-5.1, 2a: without an approved threat model, no suites are recommended.
              <Alert role="status">
                <AlertDescription>
                  {target.name} has no approved threat model yet, so threat coverage can&apos;t be shown. Choose the test
                  suites yourself.
                </AlertDescription>
              </Alert>
            )}
            {target && estimate?.threat_model && (
              // UC-5.1 step 2: what the recommendation is based on, and what it leaves untested.
              <p className="text-sm text-muted-foreground" role="status">
                Based on threat model v{estimate.threat_model.version}
                {estimate.threat_model.approved_at
                  ? `, approved ${new Date(estimate.threat_model.approved_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                  : ""}
                {estimate.threat_model.approved_by ? ` by ${estimate.threat_model.approved_by}` : ""}.{" "}
                <Link
                  href={`/threat-models/${target.id}/recommendations`}
                  className="font-medium text-link underline underline-offset-4"
                >
                  Threats covered: {estimate.threat_model.threats_covered} of {estimate.threat_model.threats_total}
                </Link>
              </p>
            )}
            <fieldset id="campaign-suites" aria-describedby={errors.suites ? "campaign-suites-error" : undefined} className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Test suites</legend>
              <ul className="divide-y rounded-[10px] border">
                {suites.map((suite) => (
                  <li key={suite.code} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox
                      id={`suite-${suite.code}`}
                      checked={chosen.includes(suite.code)}
                      onCheckedChange={(on) => {
                        setChosen((current) =>
                          on ? [...current, suite.code] : current.filter((code) => code !== suite.code),
                        )
                        clearError("suites")
                        touch()
                      }}
                      className="mt-0.5"
                    />
                    <label htmlFor={`suite-${suite.code}`} className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{suite.name}</span>{" "}
                      <span className="text-muted-foreground">({suite.test_count})</span>
                      <span className="block text-xs text-muted-foreground">
                        {suite.origin === "custom" ? "Custom" : "Built-in"} · covers{" "}
                        <span className="font-mono">{suite.categories.join(", ")}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {errors.suites && (
                <p id="campaign-suites-error" className="text-xs text-destructive">
                  {errors.suites}
                </p>
              )}
            </fieldset>
            <div className="flex items-start gap-3 rounded-[10px] border p-3">
              <Switch
                id="adaptive-agent"
                checked={adaptive}
                onCheckedChange={(on) => {
                  setAdaptive(on)
                  touch()
                }}
                aria-describedby="adaptive-agent-help"
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="adaptive-agent">Allow the adaptive testing agent to refine tests</Label>
                <p id="adaptive-agent-help" className="mt-0.5 text-xs text-muted-foreground">
                  It stays within the selected categories, budget and rate, and explains every refinement.
                </p>
              </div>
            </div>
          </Section>

          <Section number={3} id="limits-heading" title="Limits">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="attempt-budget" label="Attempt budget" error={errors.attempt_budget}>
                <Input
                  id="attempt-budget"
                  inputMode="numeric"
                  value={budget}
                  onChange={(e) => {
                    setBudget(e.target.value)
                    touch()
                  }}
                  className="h-9"
                  aria-invalid={!!errors.attempt_budget || undefined}
                  aria-describedby={describedBy("attempt-budget-help", errors.attempt_budget && "attempt-budget-error")}
                />
                <p id="attempt-budget-help" className="text-xs text-muted-foreground">
                  The run stops when it is used up.
                </p>
              </FormField>
              <FormField id="request-rate" label="Maximum request rate (per minute)" error={rateError}>
                <Input
                  id="request-rate"
                  inputMode="numeric"
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value)
                    clearError("request_rate")
                    touch()
                  }}
                  className="h-9"
                  aria-invalid={!!rateError || undefined}
                  aria-describedby={describedBy(target && "request-rate-help", rateError && "request-rate-error")}
                />
                {target && (
                  <p id="request-rate-help" className="text-xs text-muted-foreground">
                    Target&apos;s safe rate: {target.max_request_rate} per minute.
                  </p>
                )}
              </FormField>
            </div>
            <fieldset id="window" className="space-y-2" aria-describedby={describedBy("window-help", errors.window && "window-error")}>
              <legend className="text-sm font-medium">Time window (optional)</legend>
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="window-start" className="sr-only">
                  From
                </Label>
                <Input
                  id="window-start"
                  type="time"
                  value={windowStart}
                  onChange={(e) => {
                    setWindowStart(e.target.value)
                    touch()
                  }}
                  className="h-9 w-32"
                  aria-invalid={!!errors.window || undefined}
                />
                <span className="text-sm text-muted-foreground" aria-hidden="true">
                  to
                </span>
                <Label htmlFor="window-end" className="sr-only">
                  To
                </Label>
                <Input
                  id="window-end"
                  type="time"
                  value={windowEnd}
                  onChange={(e) => {
                    setWindowEnd(e.target.value)
                    touch()
                  }}
                  className="h-9 w-32"
                  aria-invalid={!!errors.window || undefined}
                />
              </div>
              <p id="window-help" className="text-xs text-muted-foreground">
                Every day, in your time zone ({timeZone}). Leave both empty to run at any time.
              </p>
              {errors.window && (
                <p id="window-error" className="text-xs text-destructive">
                  {errors.window}
                </p>
              )}
            </fieldset>
            <FormField id="repetitions" label="Repetitions for reproducibility" error={errors.repetitions}>
              <Input
                id="repetitions"
                inputMode="numeric"
                value={repetitions}
                onChange={(e) => {
                  setRepetitions(e.target.value)
                  touch()
                }}
                className="h-9 w-32"
                aria-invalid={!!errors.repetitions || undefined}
                aria-describedby={describedBy("repetitions-help", errors.repetitions && "repetitions-error")}
              />
              <p id="repetitions-help" className="text-xs text-muted-foreground">
                Each successful attempt is repeated to measure how reliably it works.
              </p>
            </FormField>
          </Section>

          <Section number={4} id="schedule-heading" title="When it runs">
            <ScheduleFields
              draft={schedule}
              onChange={setSchedule}
              timeZone={timeZone}
              error={errors.schedule_kind ?? errors.schedule_run_at ?? errors.schedule_at_time}
            />
          </Section>
        </form>

        <aside aria-labelledby="campaign-summary-heading" className="space-y-3 rounded-[10px] border bg-card p-5 lg:sticky lg:top-6">
          <h2 id="campaign-summary-heading" className="text-[15px] font-semibold">
            Summary
          </h2>
          {!estimate || !chosen.length ? (
            <p className="text-sm text-muted-foreground">Choose a target and test suites to see the estimate.</p>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Estimated attempts</dt>
                <dd>
                  {formatCount(estimate.estimated_attempts)}
                  {budgetValue ? ` of ${formatCount(budgetValue)}` : ""}
                </dd>
                {budgetValue ? (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={cn("h-full rounded-full", estimate.estimated_attempts > budgetValue ? "bg-warning" : "bg-primary")}
                      style={{ width: `${Math.min(100, (estimate.estimated_attempts / budgetValue) * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Tests that will run</dt>
                <dd>
                  {estimate.tests}
                  {estimate.skipped ? ` (${estimate.skipped} skipped)` : ""}
                </dd>
              </div>
            </dl>
          )}
          {chosen.length > 0 &&
            estimate?.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
          <p className="border-t pt-3 text-xs text-muted-foreground">Creating a campaign sends nothing to the target.</p>
          <p className="sr-only" aria-live="polite">
            {estimate && chosen.length ? `About ${formatCount(estimate.estimated_attempts)} attempts.` : ""}
          </p>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <Button type="button" variant="outline" className="h-9" onClick={() => (touched ? setConfirmLeave(true) : router.push("/campaigns"))}>
          Cancel
        </Button>
        <Button type="submit" form="campaign" className="h-9 hover:bg-primary-hover" disabled={busy}>
          {busy ? "Saving…" : "Save campaign"}
        </Button>
      </div>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Discard this campaign?</DialogTitle>
            <DialogDescription>Nothing has been saved yet.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="h-9"
              onClick={() => {
                leaving.current = true
                router.push("/campaigns")
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function describedBy(...ids: (string | false | undefined | null)[]): string | undefined {
  return ids.filter(Boolean).join(" ") || undefined
}
