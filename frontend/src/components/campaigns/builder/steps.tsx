"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Check, ChevronDown, Copy, Layers, ListChecks, Search, Sparkles, Zap } from "lucide-react"

import { Field } from "@/components/campaigns/builder/parts"
import {
  type Mode,
  type SavedSetup,
  type Setup,
  scheduleWords,
  whole,
} from "@/components/campaigns/builder/setup"
import { ScheduleFields } from "@/components/campaigns/schedule-fields"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { AdvancedSection } from "@/components/wizard/disclosure"
import { Readiness } from "@/components/wizard/status"
import { OutcomeNote, ReviewSection } from "@/components/wizard/summary"
import type { FinalAction } from "@/components/campaigns/builder/final-action"
import { type CampaignRow, type ThreatModelBrief, formatCount } from "@/lib/campaigns"
import { ENVIRONMENT_LABEL, TYPE_LABEL, type Target } from "@/lib/targets"
import type { SuiteItem } from "@/lib/test-library"
import { cn } from "@/lib/utils"

/** What one suite, or one preset, comes to on the chosen target: how many of its tests apply. */
export type Fit = { tests: number; skipped: number; attempts: number }
export type Fits = {
  targetId: string
  brief: ThreatModelBrief | null
  bySuite: Record<string, Fit>
  recommended: Fit | null
  /** The organization requires a Security Manager to approve a campaign's scope */
  approval: boolean
}

type Update = (patch: Partial<Setup>) => void

/** A choice drawn as a card: a native radio inside a label, so the arrow keys and the labels are the browser's own. */
function Card({
  name,
  value,
  checked,
  disabled,
  onSelect,
  children,
}: {
  name: string
  value: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className={cn(
        "group/card relative flex cursor-pointer gap-3 rounded-[10px] border bg-card p-3.5 transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none",
        "hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:shadow-[0_0_0_1px_var(--primary)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        disabled && "cursor-not-allowed opacity-60 hover:border-border",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className="absolute top-3 right-3 hidden size-5 place-items-center rounded-full bg-primary text-primary-foreground group-has-[:checked]/card:grid motion-safe:group-has-[:checked]/card:animate-in motion-safe:group-has-[:checked]/card:zoom-in-50"
      >
        <Check className="size-3.5" />
      </span>
      {children}
    </label>
  )
}

// ---------------------------------------------------------------- step 1

export function TargetStep({
  targets,
  target,
  setup,
  onTarget,
  update,
  name,
  suggestion,
  errors,
  recent,
  onDuplicate,
  setups,
  onApplySetup,
}: {
  targets: Target[]
  target: Target | undefined
  setup: Setup
  onTarget: (id: string) => void
  update: Update
  name: string
  suggestion: string
  errors: Record<string, string>
  recent: CampaignRow[]
  onDuplicate: (code: string) => void
  setups: SavedSetup[]
  onApplySetup: (setup: SavedSetup) => void
}) {
  const [query, setQuery] = useState("")
  const verified = targets.filter((one) => one.status === "verified")
  const found = useMemo(() => {
    const words = query.trim().toLowerCase()
    if (!words) return targets
    return targets.filter((one) =>
      `${one.name} ${TYPE_LABEL[one.type]} ${ENVIRONMENT_LABEL[one.environment]}`.toLowerCase().includes(words),
    )
  }, [targets, query])

  if (verified.length === 0) {
    return (
      <p className="text-sm">
        No target of your organization is verified yet. A campaign can only test a target whose ownership has been verified.{" "}
        <Link href="/targets" className="font-medium text-link hover:underline">
          Go to targets
        </Link>
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {(recent.length > 0 || setups.length > 0) && (
        <div className="rounded-[10px] border border-dashed p-3.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Copy className="size-4 text-muted-foreground" aria-hidden="true" />
            Done this before? Start from something you have
          </p>
          <div className="mt-2.5 flex flex-wrap items-end gap-3">
            {recent.length > 0 && (
              <div className="min-w-0 space-y-1">
                <Label htmlFor="duplicate-from" className="text-xs text-muted-foreground">
                  Copy a campaign
                </Label>
                <Select value="" onValueChange={onDuplicate}>
                  <SelectTrigger id="duplicate-from" className="h-9 w-64 max-w-full">
                    <SelectValue placeholder="Choose a campaign to copy" />
                  </SelectTrigger>
                  <SelectContent>
                    {recent.map((row) => (
                      <SelectItem key={row.code} value={row.code}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {setups.length > 0 && (
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-muted-foreground" id="saved-setups">
                  Your saved setups
                </p>
                <ul className="flex flex-wrap gap-1.5" aria-labelledby="saved-setups">
                  {setups.map((saved) => (
                    <li key={saved.id}>
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onApplySetup(saved)}>
                        <Sparkles aria-hidden="true" />
                        {saved.label}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <fieldset aria-describedby={errors.target_id ? "campaign-target-error" : undefined} className="space-y-2.5">
        <legend className="sr-only">Target</legend>
        {targets.length > 5 && (
          <div className="relative sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="campaign-target-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, type or environment"
              aria-label="Search targets"
              className="h-9 pl-9"
            />
          </div>
        )}
        <div id="campaign-target" className="grid gap-2.5 sm:grid-cols-2" role="presentation">
          {found.map((one) => {
            const ok = one.status === "verified"
            return (
              <Card
                key={one.id}
                name="campaign-target"
                value={one.id}
                checked={setup.targetId === one.id}
                disabled={!ok}
                onSelect={() => onTarget(one.id)}
              >
                <span className="min-w-0 pr-6">
                  <span className="block truncate text-sm font-medium">{one.name}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded border px-1.5 py-0.5 text-text-secondary">{TYPE_LABEL[one.type]}</span>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5",
                        one.environment === "production" ? "border-warning/60 text-warning" : "text-text-secondary",
                      )}
                    >
                      {ENVIRONMENT_LABEL[one.environment]}
                    </span>
                    <span className={cn("inline-flex items-center gap-1", ok ? "text-success" : "text-muted-foreground")}>
                      {ok && <Check className="size-3" aria-hidden="true" />}
                      {ok ? "Verified" : "Verify ownership first"}
                    </span>
                  </span>
                </span>
              </Card>
            )
          })}
          {found.length === 0 && <p className="text-sm text-muted-foreground">No target matches “{query}”.</p>}
        </div>
        {targets.length > verified.length && (
          <Readiness
            status="missing"
            title={`${targets.length - verified.length} ${targets.length - verified.length === 1 ? "target is" : "targets are"} waiting for ownership verification`}
            detail="They are greyed out above. Only the AI Application Developer who owns a target can verify it; until then a campaign can't test it."
            action={{ label: "Open the targets", href: "/targets" }}
          />
        )}
        {errors.target_id && (
          <p id="campaign-target-error" className="text-xs text-destructive">
            {errors.target_id}
          </p>
        )}
      </fieldset>

      {target && (
        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
          <NameField name={name} suggestion={suggestion} edited={setup.nameEdited} update={update} error={errors.name} />
        </div>
      )}
    </div>
  )
}

/** The campaign's name: suggested from what was chosen, and the person's own from the first key they press. */
export function NameField({
  name,
  suggestion,
  edited,
  update,
  error,
}: {
  name: string
  suggestion: string
  edited: boolean
  update: Update
  error?: string
}) {
  return (
    <Field
      id="campaign-name"
      label="Campaign name"
      error={error}
      hint={
        edited ? (
          suggestion ? (
            <>
              <button
                type="button"
                className="rounded-[4px] text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => update({ name: "", nameEdited: false })}
              >
                Use the suggestion
              </button>{" "}
              “{suggestion}”
            </>
          ) : undefined
        ) : (
          "Suggested from your choices. Change it any time; it follows them until you do."
        )
      }
    >
      {(aria) => (
        <Input
          id="campaign-name"
          value={name}
          onChange={(event) => update({ name: event.target.value, nameEdited: true })}
          maxLength={120}
          autoComplete="off"
          className="h-9 sm:max-w-xl"
          {...aria}
        />
      )}
    </Field>
  )
}

// ---------------------------------------------------------------- step 2

function FitLine({ fit, target }: { fit: Fit | undefined; target: Target }) {
  if (!fit) return <span className="block text-xs text-muted-foreground">Checking this target…</span>
  if (fit.tests === 0) {
    return <span className="block text-xs font-medium text-destructive">None of its tests apply to a {TYPE_LABEL[target.type].toLowerCase()}</span>
  }
  return (
    <span className="block text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {fit.tests} {fit.tests === 1 ? "test applies" : "tests apply"}
      </span>
      {fit.skipped > 0 ? ` · ${fit.skipped} skipped, written for other target types` : " · all of them fit"}
      {` · about ${formatCount(fit.attempts)} attempts`}
    </span>
  )
}

export function AssessmentStep({
  suites,
  fits,
  target,
  mode,
  chosen,
  onMode,
  onToggle,
  error,
  dropped,
  onDismissDropped,
}: {
  suites: SuiteItem[]
  fits: Fits | null
  target: Target
  mode: Mode | null
  chosen: string[]
  onMode: (mode: Mode) => void
  onToggle: (code: string, on: boolean) => void
  error?: string
  /** Suites taken out of the choice because none of their tests apply to this target */
  dropped: string[]
  onDismissDropped: () => void
}) {
  const fit = fits?.targetId === target.id ? fits : null
  const brief = fit?.brief ?? null
  const byCode = (code: string) => suites.find((suite) => suite.code === code)
  const quick = byCode("QUICK-REGRESSION")
  const full = byCode("FULL-ASSESSMENT")
  const recommended = brief && brief.default_suites.length > 0 ? brief : null
  const named = (codes: string[]) => codes.map((code) => byCode(code)?.name ?? code).join(", ")

  return (
    <div className="space-y-4">
      {dropped.length > 0 && (
        <Alert role="status">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {dropped.join(", ")} {dropped.length === 1 ? "was" : "were"} taken out of your choice: none of {dropped.length === 1 ? "its" : "their"} tests apply to {target.name}.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onDismissDropped}>
              Got it
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <fieldset aria-describedby={error ? "campaign-suites-error" : undefined} className="space-y-3" id="campaign-suites">
        <legend className="sr-only">Assessment</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {recommended && (
            <Card name="assessment" value="recommended" checked={mode === "recommended"} onSelect={() => onMode("recommended")}>
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 space-y-1 pr-6">
                <span className="block text-sm font-semibold">Recommended for {target.name}</span>
                <span className="block text-[13px] text-text-secondary">
                  What threat model v{recommended.version} says matters here: {named(recommended.default_suites)}.
                </span>
                <FitLine fit={fit?.recommended ?? undefined} target={target} />
              </span>
            </Card>
          )}
          {quick && (
            <Card name="assessment" value="quick" checked={mode === "quick"} onSelect={() => onMode("quick")}>
              <Zap className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 space-y-1 pr-6">
                <span className="block text-sm font-semibold">Quick regression</span>
                <span className="block text-[13px] text-text-secondary">{quick.purpose}</span>
                <FitLine fit={fit?.bySuite[quick.code]} target={target} />
              </span>
            </Card>
          )}
          {full && (
            <Card name="assessment" value="full" checked={mode === "full"} onSelect={() => onMode("full")}>
              <Layers className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 space-y-1 pr-6">
                <span className="block text-sm font-semibold">Full assessment</span>
                <span className="block text-[13px] text-text-secondary">{full.purpose}</span>
                <FitLine fit={fit?.bySuite[full.code]} target={target} />
              </span>
            </Card>
          )}
          <Card name="assessment" value="custom" checked={mode === "custom"} onSelect={() => onMode("custom")}>
            <ListChecks className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 space-y-1 pr-6">
              <span className="block text-sm font-semibold">Choose the test suites yourself</span>
              <span className="block text-[13px] text-text-secondary">
                Tick the suites you want: one category, several, or your own suites from the Test Library.
              </span>
            </span>
          </Card>
        </div>
        {!brief && fit && (
          <p className="text-[13px] text-muted-foreground" role="status">
            {target.name} has no approved threat model yet, so threat coverage can&apos;t be shown and nothing is recommended for it.{" "}
            <Link href={`/threat-models/${target.id}`} className="font-medium text-link hover:underline">
              Open its threat model
            </Link>
          </p>
        )}
        {error && (
          <p id="campaign-suites-error" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </fieldset>

      {mode === "custom" ? (
        <div className="space-y-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
          <p className="text-sm font-medium" id="suite-list-heading">
            Test suites
          </p>
          <ul className="divide-y rounded-[10px] border" aria-labelledby="suite-list-heading">
            {suites.map((suite) => {
              const one = fit?.bySuite[suite.code]
              const none = one !== undefined && one.tests === 0
              return (
                <li key={suite.code} className="flex items-start gap-3 px-3 py-2.5">
                  <Checkbox
                    id={`suite-${suite.code}`}
                    checked={chosen.includes(suite.code)}
                    disabled={none}
                    onCheckedChange={(on) => onToggle(suite.code, on === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor={`suite-${suite.code}`} className={cn("min-w-0 flex-1 text-sm", none && "text-muted-foreground")}>
                    <span className="font-medium">{suite.name}</span>{" "}
                    <span className="text-muted-foreground">
                      ({suite.test_count}) · v{suite.version}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {suite.origin === "custom" ? "Custom" : "Built-in"} · covers <span className="font-mono">{suite.categories.join(", ")}</span>
                    </span>
                    <FitLine fit={one} target={target} />
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        mode && (
          <details className="group rounded-[10px] border px-3.5 py-2.5 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[4px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <span>What&apos;s included</span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>
            <ul className="mt-2 space-y-2.5">
              {chosen.map((code) => {
                const suite = byCode(code)
                return suite ? (
                  <li key={code}>
                    <p className="font-medium">
                      {suite.name} <span className="font-normal text-muted-foreground">({suite.test_count} tests) · v{suite.version}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Covers <span className="font-mono">{suite.categories.join(", ")}</span>. {suite.purpose}
                    </p>
                    {suite.warnings.length > 0 && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {suite.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ) : null
              })}
            </ul>
            <Button type="button" variant="link" className="mt-2 h-auto p-0 text-[13px]" onClick={() => onMode("custom")}>
              Customize these tests
            </Button>
          </details>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------- step 3

export function LimitsStep({
  setup,
  update,
  target,
  suggestedBudgetText,
  budget,
  rate,
  timeZone,
  needsApproval,
  errors,
  rateError,
}: {
  setup: Setup
  update: Update
  target: Target
  /** Where the suggested budget came from, while it is still the suggestion */
  suggestedBudgetText: string | null
  budget: string
  rate: string
  timeZone: string
  needsApproval: boolean
  errors: Record<string, string>
  rateError?: string
}) {
  const [more, setMore] = useState(false)
  const moreErrors = Boolean(errors.repetitions || errors.window)
  const customised = setup.adaptive || setup.repetitions !== "5" || setup.windowStart !== "" || setup.windowEnd !== ""
  const gist = [
    setup.adaptive ? "adaptive agent on" : "adaptive agent off",
    `${setup.repetitions || "5"} repetitions`,
    setup.windowStart && setup.windowEnd ? `${setup.windowStart}–${setup.windowEnd}` : "any time of day",
  ].join(" · ")

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="attempt-budget"
          label="Attempt budget"
          help="The most attempts one run may use. An attempt is one prompt sent to the target and judged. The run stops when the budget is used up, so it is also the ceiling on cost."
          hint={suggestedBudgetText ?? "The run stops when it is used up."}
          error={errors.attempt_budget}
        >
          {(aria) => (
            <Input
              id="attempt-budget"
              inputMode="numeric"
              value={budget}
              onChange={(event) => update({ budget: event.target.value, budgetEdited: true })}
              className="h-9"
              {...aria}
            />
          )}
        </Field>
        <Field
          id="request-rate"
          label="Maximum request rate (per minute)"
          help="How many requests a minute Sentra may send to the target. It can't go above the target's safe rate, so a test never overloads the application."
          hint={
            setup.rateEdited
              ? `Target's safe rate: ${target.max_request_rate} per minute.`
              : `Suggested: three quarters of the target's safe rate of ${target.max_request_rate} per minute.`
          }
          error={rateError}
        >
          {(aria) => (
            <Input
              id="request-rate"
              inputMode="numeric"
              value={rate}
              onChange={(event) => update({ rate: event.target.value, rateEdited: true })}
              className="h-9"
              {...aria}
            />
          )}
        </Field>
      </div>

      <section aria-labelledby="schedule-heading" className="space-y-3">
        <h3 id="schedule-heading" className="text-sm font-semibold">
          When it runs
        </h3>
        <ScheduleFields
          draft={setup.schedule}
          onChange={(schedule) => update({ schedule })}
          timeZone={timeZone}
          needsApproval={needsApproval}
          error={errors.schedule_kind ?? errors.schedule_run_at ?? errors.schedule_at_time}
        />
      </section>

      <AdvancedSection
        id="more-settings"
        title="More settings"
        summary={`${customised ? "Changed from the defaults: " : "Defaults: "}${gist}`}
        open={more}
        onOpenChange={setMore}
        hasError={moreErrors}
      >
        <Field
          id="repetitions"
          label="Repetitions for reproducibility"
          help="Each successful attempt is repeated this many times, to measure how reliably it works rather than whether it worked once. More repetitions give firmer findings and use more of the budget."
          hint="Each successful attempt is repeated to measure how reliably it works."
          error={errors.repetitions}
          className="max-w-72"
        >
          {(aria) => (
            <Input
              id="repetitions"
              inputMode="numeric"
              value={setup.repetitions}
              onChange={(event) => update({ repetitions: event.target.value })}
              className="h-9 w-32"
              {...aria}
            />
          )}
        </Field>
        <fieldset className="space-y-1.5" id="window" aria-describedby="window-help">
          <legend className="text-sm font-medium">Time window (optional)</legend>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="window-start" className="sr-only">
              From
            </Label>
            <Input
              id="window-start"
              type="time"
              value={setup.windowStart}
              onChange={(event) => update({ windowStart: event.target.value })}
              className="h-9 w-32"
              aria-invalid={errors.window ? true : undefined}
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
              value={setup.windowEnd}
              onChange={(event) => update({ windowEnd: event.target.value })}
              className="h-9 w-32"
              aria-invalid={errors.window ? true : undefined}
            />
          </div>
          <p id="window-help" className="text-xs text-muted-foreground">
            Every day, in your time zone ({timeZone}). Testing only happens inside the window, for example outside business hours. Leave both empty to run at any time.
          </p>
          {errors.window && <p className="text-xs text-destructive">{errors.window}</p>}
        </fieldset>
        <div className="flex items-start gap-3 rounded-[10px] border p-3">
          <Switch
            id="adaptive-agent"
            checked={setup.adaptive}
            onCheckedChange={(on) => update({ adaptive: on })}
            aria-describedby="adaptive-agent-help"
            className="mt-0.5"
          />
          <div>
            <Label htmlFor="adaptive-agent">Allow the adaptive testing agent to refine tests</Label>
            <p id="adaptive-agent-help" className="mt-0.5 text-xs text-muted-foreground">Tries better follow-ups within your categories, budget and rate.</p>
          </div>
        </div>
      </AdvancedSection>
    </div>
  )
}

// ---------------------------------------------------------------- step 4

export function ReviewStep({
  setup,
  name,
  suggestion,
  update,
  target,
  suites,
  estimateTests,
  estimateSkipped,
  budget,
  rate,
  timeZone,
  needsApproval,
  conflicts,
  acknowledged,
  onAcknowledge,
  final,
  errors,
  onEdit,
  onSaveSetup,
  canSaveSetup,
}: {
  setup: Setup
  name: string
  suggestion: string
  update: Update
  target: Target
  suites: SuiteItem[]
  estimateTests: number | null
  estimateSkipped: number | null
  budget: string
  rate: string
  timeZone: string
  needsApproval: boolean
  conflicts: string[]
  /** The person has read that the month may run out before the campaign ends */
  acknowledged: boolean
  onAcknowledge: (yes: boolean) => void
  final: FinalAction
  errors: Record<string, string>
  onEdit: (step: number) => void
  onSaveSetup: (label: string) => void
  canSaveSetup: boolean
}) {
  const [label, setLabel] = useState("")
  const [saved, setSaved] = useState(false)
  const chosen = setup.chosen.map((code) => {
    const suite = suites.find((one) => one.code === code)
    return suite ? `${suite.name} v${suite.version}` : code
  })
  const keep = () => {
    if (!label.trim()) return
    onSaveSetup(label.trim())
    setSaved(true)
    setLabel("")
  }
  const attempts = whole(budget)
  return (
    <div className="space-y-3">
      <div className="rounded-[10px] border p-4">
        <NameField name={name} suggestion={suggestion} edited={setup.nameEdited} update={update} error={errors.name} />
      </div>
      <ReviewSection
        title="Target"
        onEdit={() => onEdit(0)}
        items={[
          { label: "Target", value: target.name },
          { label: "Type and environment", value: `${TYPE_LABEL[target.type]} · ${ENVIRONMENT_LABEL[target.environment]} · Ownership verified` },
        ]}
      />
      <ReviewSection
        title="Assessment"
        onEdit={() => onEdit(1)}
        items={[
          { label: "Test suites (version)", value: chosen.join(", ") || "Nothing chosen" },
          ...(estimateTests !== null
            ? [
                {
                  label: "Tests that will run",
                  value: `${estimateTests}${estimateSkipped ? `; ${estimateSkipped} skipped because they don't apply to a ${TYPE_LABEL[target.type].toLowerCase()}` : ""}`,
                },
              ]
            : []),
        ]}
      />
      <ReviewSection
        title="Limits and schedule"
        onEdit={() => onEdit(2)}
        items={[
          { label: "Attempt budget", value: attempts !== null ? formatCount(attempts) : budget },
          { label: "Request rate", value: `${rate} per minute (safe rate ${target.max_request_rate})` },
          { label: "Repetitions", value: setup.repetitions },
          { label: "Time window", value: setup.windowStart && setup.windowEnd ? `${setup.windowStart} to ${setup.windowEnd}` : "Any time" },
          { label: "Adaptive testing agent", value: setup.adaptive ? "On" : "Off" },
          { label: "Runs", value: scheduleWords(setup.schedule, timeZone, needsApproval) },
          { label: "Time zone", value: timeZone },
          { label: "Scope approval", value: needsApproval ? "Required: a Security Manager approves first" : "Not required in this organization" },
        ]}
      />

      {conflicts.length > 0 && (
        <Alert role="status">
          <AlertDescription className="space-y-2">
            {conflicts.map((conflict) => (
              <p key={conflict}>{conflict}</p>
            ))}
            <label className="flex items-start gap-2 pt-1 font-medium">
              <Checkbox id="acknowledge-limits" checked={acknowledged} onCheckedChange={(on) => onAcknowledge(on === true)} className="mt-0.5" />
              <span>I understand the run may stop before it finishes</span>
            </label>
          </AlertDescription>
        </Alert>
      )}

      <OutcomeNote operation={final.label} effect={final.effect} />

      {canSaveSetup && (
        // Not a form of its own: the builder is one form, and Enter here must not save the campaign
        <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-dashed p-3.5">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="setup-label" className="text-xs text-muted-foreground">
              Save these settings to start from next time (target and name are not kept)
            </Label>
            <Input
              id="setup-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value)
                setSaved(false)
              }}
              maxLength={40}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  keep()
                }
              }}
              placeholder="A name for it, such as Weekly regression"
              className="h-9 w-80 max-w-full"
            />
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={!label.trim()} onClick={keep}>
            Save setup
          </Button>
          {saved && (
            <span className="text-xs text-success" role="status">
              Saved on this device
            </span>
          )}
        </div>
      )}
    </div>
  )
}
