"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { type Setup, BLANK, scheduleWords, startingRate, whole } from "@/components/campaigns/builder/setup"
import { LimitsStep } from "@/components/campaigns/builder/steps"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdvancedSection, HelpArea } from "@/components/wizard/disclosure"
import { CLEAN, type DraftFeedback } from "@/components/wizard/draft-state"
import { StepIntro, Stepper } from "@/components/wizard/parts"
import { ActionFooter, WorkflowShell } from "@/components/wizard/shell"
import { DraftStatus, Readiness, type ReadinessKind } from "@/components/wizard/status"
import { type ImpactItem, ImpactSummary, OutcomeNote, ReviewSection } from "@/components/wizard/summary"
import { type DraftAdapter, DraftUnsupportedError, useDraftFeedback } from "@/components/wizard/use-draft-feedback"
import type { Target } from "@/lib/targets"

/**
 * A local preview of the shared guided-workflow components. Everything here is sample data: the target,
 * the numbers, the save outcomes. It proves how the components look and behave, not what the backend
 * supports, and the buttons on it create nothing.
 */

const SAMPLE_TARGET: Target = {
  id: "sample",
  name: "Sample support assistant",
  type: "chatbot",
  endpoint_url: "https://assistant.sample.example/api/chat",
  endpoint_host: "assistant.sample.example",
  environment: "staging",
  max_request_rate: 20,
  request_format: "openai_chat",
  request_template: null,
  reply_path: "$.output.text",
  tool_calls_path: null,
  status: "verified",
  owner: { id: "sample-owner", name: "Sample Developer" },
  credentials: [],
  created_at: "2026-11-01T09:00:00Z",
  updated_at: "2026-11-01T09:00:00Z",
  is_lab: false,
  verified_at: "2026-11-04T09:00:00Z",
  verified_by: null,
  verification_method: null,
  last_connection_test: null,
  profile_status: null,
  archived_at: null,
  archived_by: null,
  active_run: null,
}

const STEPS = [
  { label: "Target", question: "Which application is this for?", why: "Only a target whose ownership is verified can be tested." },
  { label: "Limits & schedule", question: "How should this run?", why: "Limits keep a test from overloading the application or the budget. Sensible values are filled in." },
  { label: "Review", question: "Check it, then finish", why: "Nothing is done until you press the last button. Edit takes you back without losing anything else." },
]

type SaveOutcome = "succeeds" | "fails" | "slow" | "unsupported"
type ImpactData = "normal" | "unknown" | "stale"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function simulatedAdapter(outcome: SaveOutcome): DraftAdapter<Setup> {
  let calls = 0
  return {
    async save() {
      calls += 1
      if (outcome === "unsupported") throw new DraftUnsupportedError("Sample: this browser doesn't allow a draft to be kept")
      if (outcome === "fails") {
        await wait(500)
        throw new Error("Sample failure: the place that keeps drafts did not answer.")
      }
      // The first answer comes late and the next ones early: answers arrive out of order
      await wait(outcome === "slow" && calls === 1 ? 2200 : 300)
      return { savedAt: new Date().toISOString() }
    },
  }
}

function validate(step: number, setup: Setup, budget: string, rate: string): Record<string, string> {
  const found: Record<string, string> = {}
  if (step === 1) {
    const attempts = whole(budget)
    if (attempts === null || attempts < 1) found.attempt_budget = "Enter a whole number of attempts, 1 or more."
    const rateValue = whole(rate)
    if (rateValue === null || rateValue < 1) found.request_rate = "Enter a whole number of requests per minute, 1 or more."
    else if (rateValue > SAMPLE_TARGET.max_request_rate) found.request_rate = `The rate can't exceed the target's safe rate of ${SAMPLE_TARGET.max_request_rate} per minute.`
    if (Boolean(setup.windowStart) !== Boolean(setup.windowEnd)) found.window = "Set both ends of the time window, or leave both empty."
  }
  return found
}

const READINESS_TEXT: Record<ReadinessKind, { title: string; detail: string; action?: string }> = {
  ready: { title: "Sample support assistant is ready", detail: "Its ownership was verified on 4 Nov. It can be tested within the limits you set next." },
  checking: { title: "Checking the target…", detail: "This takes a few seconds. You can fill in the next step meanwhile." },
  missing: {
    title: "Its ownership is not verified yet",
    detail: "Only the AI Application Developer who owns it can verify it. Until then no campaign can be saved for it.",
    action: "Show the ownership steps",
  },
  waiting: {
    title: "Waiting for a Security Manager",
    detail: "Your organization requires scope approval. You can finish setting this up; nothing runs before they approve.",
  },
  blocked: {
    title: "This target is archived",
    detail: "An archived target can't be tested. Restore it from its page, or choose another target.",
    action: "Choose another target",
  },
}

export function OnboardingPreview() {
  const [setup, setSetup] = useState<Setup>({ ...BLANK, targetId: SAMPLE_TARGET.id })
  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [outcome, setOutcome] = useState<SaveOutcome>("succeeds")
  const [readiness, setReadiness] = useState<ReadinessKind>("ready")
  const [impact, setImpact] = useState<ImpactData>("normal")
  const [sampleDone, setSampleDone] = useState(false)
  const [note, setNote] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  const adapter = useMemo(() => simulatedAdapter(outcome), [outcome])
  const draft = useDraftFeedback<Setup>(adapter, 400)

  // One owner for the values: the shared components only show them and say what changed
  function update(patch: Partial<Setup>) {
    const next = { ...setup, ...patch }
    setSetup(next)
    setErrors({})
    draft.noteEdit(next)
  }

  const budget = setup.budgetEdited ? setup.budget : "200"
  const rate = setup.rateEdited ? setup.rate : startingRate(SAMPLE_TARGET)
  const needsApproval = readiness === "waiting"
  const when = scheduleWords(setup.schedule, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", needsApproval)
  const more = [
    setup.adaptive ? "adaptive agent on" : "adaptive agent off",
    `${setup.repetitions || "5"} repetitions`,
    setup.windowStart && setup.windowEnd ? `${setup.windowStart}–${setup.windowEnd}` : "any time of day",
  ].join(" · ")

  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    heading.current?.focus()
  }, [step])

  function go(index: number) {
    setStep(index)
    setFurthest((now) => Math.max(now, index))
    setNote("")
  }

  function next() {
    const found = validate(step, setup, budget, rate)
    if (Object.keys(found).length > 0) {
      setErrors(found)
      const first = Object.keys(found)[0] === "attempt_budget" ? "attempt-budget" : Object.keys(found)[0] === "request_rate" ? "request-rate" : "more-settings"
      setTimeout(() => document.getElementById(first)?.focus(), 60)
      return
    }
    setErrors({})
    go(step + 1)
  }

  const impactItems: ImpactItem[] =
    impact === "unknown"
      ? [
          { label: "Tests that will run", value: "8 of 12", kind: "known" },
          { label: "Estimated attempts", kind: "unknown", note: "The estimate didn't answer. You can go on; the server checks again when you finish." },
          { label: "Estimated LLM cost", kind: "unknown", note: "Measured from this organization's own judged attempts, once it has some." },
          { label: "Attempt budget", value: `${budget} attempts`, kind: "known" },
        ]
      : impact === "stale"
        ? [
            { label: "Tests that will run", value: "8 of 12", kind: "known" },
            {
              label: "Estimated attempts",
              value: "about 120",
              kind: "stale",
              note: "Calculated before you changed the limits.",
              fix: { label: "Recalculate", onClick: () => setImpact("normal") },
            },
            { label: "Estimated LLM cost", value: "$4.55–$6.82", kind: "stale", fix: { label: "Edit the limits", onClick: () => go(1) } },
            { label: "Attempt budget", value: `${budget} attempts`, kind: "known" },
          ]
        : [
            { label: "Tests that will run", value: "8 of 12", kind: "known", note: "4 skipped: they don't apply to this target" },
            { label: "Estimated attempts", value: "about 120", kind: "estimate", note: "From the tests that apply to this target" },
            { label: "Estimated LLM cost", value: "$4.55–$6.82", kind: "estimate", note: "At what judged attempts have cost this organization" },
            { label: "Attempt budget", value: `${budget} attempts`, kind: "known" },
          ]

  const ready = readiness === "ready" || readiness === "waiting"
  const finalLabel = needsApproval ? "Submit for approval" : setup.schedule.kind === "immediately" ? "Save and start run" : "Save campaign"
  const finalEffect = needsApproval
    ? "A Security Manager reviews the scope first. Nothing runs before they approve."
    : setup.schedule.kind === "immediately"
      ? "The first run starts now. Sentra sends test requests to the target within the limits you set."
      : "The campaign is created and runs at the time you chose. Nothing is sent before then."

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8">
      <div role="note" className="rounded-[10px] border border-warning/50 bg-warning/10 p-4 text-sm">
        <p className="font-semibold">Component preview: sample data only</p>
        <p className="mt-0.5 text-text-secondary">Fixtures only. Nothing is saved or sent.</p>
      </div>

      <section aria-labelledby="controls-heading" className="rounded-[10px] border bg-card p-4">
        <h2 id="controls-heading" className="text-[15px] font-semibold">
          Fixture controls
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["Draft save outcome", outcome, (v: string) => setOutcome(v as SaveOutcome), [["succeeds", "Succeeds"], ["fails", "Fails"], ["slow", "First answer arrives late"], ["unsupported", "Can't keep drafts here"]]],
              ["Target readiness", readiness, (v: string) => setReadiness(v as ReadinessKind), [["ready", "Ready"], ["checking", "Checking"], ["missing", "Needs verification"], ["waiting", "Needs approval"], ["blocked", "Blocked"]]],
              ["Impact data", impact, (v: string) => setImpact(v as ImpactData), [["normal", "Known and estimated"], ["unknown", "Unknown"], ["stale", "Out of date"]]],
            ] as [string, string, (v: string) => void, string[][]][]
          ).map(([label, value, onChange, options]) => (
            <div key={label} className="space-y-1.5">
              <Label htmlFor={`fx-${label}`}>{label}</Label>
              <select
                id={`fx-${label}`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {options.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="demo-heading" className="space-y-3">
        <div>
          <h2 id="demo-heading" className="text-lg font-semibold">
            1. A guided task, composed from the real limits step
          </h2>
          <p className="text-sm text-muted-foreground">The middle step is the campaign builder&apos;s own limits step. Try an empty budget, then Continue.</p>
        </div>
        <form
          id="sample-task"
          onSubmit={(event) => {
            event.preventDefault()
            setSampleDone(true)
          }}
        >
          <WorkflowShell
            title="New campaign (sample)"
            purpose="Choose what to test and how far it may go. Saving a draft never starts anything."
            status={<DraftStatus feedback={draft.feedback} onRetry={() => void draft.retry()} className="pt-1" />}
            exit={
              <Button type="button" variant="ghost" className="h-9" onClick={() => setNote("Sample: this would ask before leaving, because there are unsaved changes.")}>
                Cancel
              </Button>
            }
            steps={
              <Stepper
                steps={STEPS}
                current={step}
                done={STEPS.map((_, i) => i < furthest && Object.keys(validate(i, setup, budget, rate)).length === 0)}
                reachable={STEPS.map((_, i) => i <= furthest)}
                onGo={go}
              />
            }
            aside={
              <>
                <ImpactSummary
                  items={impactItems}
                  updating={readiness === "checking"}
                  footnote="Estimates come from the tests that apply. Saving a draft sends nothing to the target."
                  warnings={impact === "stale" ? ["These numbers don't match your current limits yet."] : []}
                />
                <HelpArea
                  title="About this step"
                  more={
                    <p>An attempt is one prompt sent and judged. The budget caps cost. The rate stays under the safe rate.</p>
                  }
                >
                  <p>{step === 0 ? "Check the target is ready, then continue." : step === 1 ? "Keep the suggested limits, or change them. The summary updates as you type." : "Check each block. Edit returns to that step with everything else kept."}</p>
                </HelpArea>
              </>
            }
            footer={
              <ActionFooter
                leading={
                  <p className="text-xs text-muted-foreground">
                    Step {step + 1} of {STEPS.length}
                  </p>
                }
                onBack={step > 0 ? () => go(step - 1) : undefined}
                onContinue={next}
                continueLabel={`Next: ${STEPS[Math.min(step + 1, 2)].label}`}
                continueShort="Next"
                skip={step < 1 ? { label: "Skip to review", onClick: () => go(2) } : undefined}
                final={
                  step === 2
                    ? {
                        label: finalLabel,
                        pendingLabel: "Working…",
                        formId: "sample-task",
                        blockedReason: ready ? undefined : "This can't be done yet: the target isn't ready. See the first step.",
                      }
                    : undefined
                }
              />
            }
          >
            <StepIntro step={step + 1} total={STEPS.length} question={STEPS[step].question} why={STEPS[step].why} headingRef={heading} />
            {step === 0 && (
              <div className="space-y-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Target</dt>
                    <dd className="font-medium">{SAMPLE_TARGET.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Environment</dt>
                    <dd className="font-medium">Staging</dd>
                  </div>
                </dl>
                <Readiness
                  status={readiness}
                  title={READINESS_TEXT[readiness].title}
                  detail={READINESS_TEXT[readiness].detail}
                  action={READINESS_TEXT[readiness].action ? { label: READINESS_TEXT[readiness].action!, onClick: () => setNote("Sample: this would open the page that explains it.") } : undefined}
                />
              </div>
            )}
            {step === 1 && (
              <LimitsStep
                setup={setup}
                update={update}
                target={SAMPLE_TARGET}
                suggestedBudgetText={setup.budgetEdited ? null : "Suggested from the estimate, with a quarter more for repeated attempts."}
                budget={budget}
                rate={rate}
                timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}
                needsApproval={needsApproval}
                errors={errors}
                rateError={errors.request_rate}
              />
            )}
            {step === 2 && (
              <div className="space-y-4">
                <ReviewSection title="Target" onEdit={() => go(0)} items={[{ label: "Target", value: SAMPLE_TARGET.name }, { label: "Readiness", value: READINESS_TEXT[readiness].title }]} />
                <ReviewSection
                  title="Limits and schedule"
                  onEdit={() => go(1)}
                  items={[
                    { label: "Attempt budget", value: `${budget} attempts` },
                    { label: "Request rate", value: `${rate} per minute (safe rate ${SAMPLE_TARGET.max_request_rate})` },
                    { label: "Runs", value: when },
                    { label: "More settings", value: more },
                  ]}
                />
                <OutcomeNote operation={finalLabel} effect={finalEffect} sample />
                {sampleDone && (
                  <Alert role="status">
                    <AlertDescription>Sample result: the button was pressed and nothing was created. A real result would name the campaign and where to follow it.</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            {note && (
              <p role="status" className="text-xs text-muted-foreground">
                {note}
              </p>
            )}
          </WorkflowShell>
        </form>
      </section>

      <States />
    </div>
  )
}

// ---------------------------------------------------------------- the states, one at a time

const AT = "2026-11-15T10:42:00.000Z"
const DRAFT_STATES: [string, DraftFeedback][] = [
  ["Nothing changed yet", CLEAN],
  ["Unsaved changes", { phase: "unsaved", edit: 3, savedEdit: 2, savedAt: AT, error: null }],
  ["Saving", { phase: "saving", edit: 3, savedEdit: 2, savedAt: AT, error: null }],
  ["Saved, acknowledged for the latest change", { phase: "saved", edit: 3, savedEdit: 3, savedAt: AT, error: null }],
  ["Save failed", { phase: "failed", edit: 3, savedEdit: 2, savedAt: AT, error: "The place that keeps drafts did not answer." }],
  ["Can't be kept here", { phase: "unsupported", edit: 3, savedEdit: 0, savedAt: null, error: null }],
]

function States() {
  const [open, setOpen] = useState(false)
  const [kept, setKept] = useState("Keep this value")
  const [edited, setEdited] = useState("")
  return (
    <section aria-labelledby="states-heading" className="space-y-6">
      <div>
        <h2 id="states-heading" className="text-lg font-semibold">
          2. The states, one at a time
        </h2>
        <p className="text-sm text-muted-foreground">Fixed examples of what each component can say. They are drawn from fixtures and are not a test of any backend.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-[10px] border bg-card p-4">
          <h3 className="text-sm font-semibold">Draft feedback</h3>
          <ul className="space-y-2.5">
            {DRAFT_STATES.map(([label, feedback]) => (
              <li key={label} className="space-y-0.5">
                <p className="text-xs font-medium">{label}</p>
                <DraftStatus feedback={feedback} onRetry={() => undefined} />
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 rounded-[10px] border bg-card p-4">
          <h3 className="text-sm font-semibold">Readiness</h3>
          {(Object.keys(READINESS_TEXT) as ReadinessKind[]).map((status) => (
            <Readiness key={status} status={status} title={READINESS_TEXT[status].title} detail={READINESS_TEXT[status].detail} action={READINESS_TEXT[status].action ? { label: READINESS_TEXT[status].action!, onClick: () => undefined } : undefined} />
          ))}
        </div>

        <div className="space-y-3 rounded-[10px] border bg-card p-4">
          <h3 className="text-sm font-semibold">Advanced section keeps its values</h3>
          <AdvancedSection id="advanced-example" title="More settings" summary={kept ? `Kept value: ${kept}` : "Defaults"} open={open} onOpenChange={setOpen}>
            <div className="space-y-1.5">
              <Label htmlFor="advanced-input">A specialist setting</Label>
              <Input id="advanced-input" value={kept} onChange={(event) => setKept(event.target.value)} className="h-9" />
            </div>
          </AdvancedSection>
          <p className="text-xs text-muted-foreground">Close it and open it again: the value is still there, and its summary stays visible while it is closed.</p>
        </div>

        <div className="space-y-3 rounded-[10px] border bg-card p-4">
          <h3 className="text-sm font-semibold">Help area</h3>
          <HelpArea title="About the attempt budget" more={<p>The budget is also the ceiling on cost: the run stops when it is used up.</p>}>
            <p>The most attempts one run may use. Essential instructions are always on the page.</p>
          </HelpArea>
          <Label htmlFor="edit-note" className="sr-only">
            A note
          </Label>
          <Input id="edit-note" value={edited} onChange={(event) => setEdited(event.target.value)} placeholder="Type here, then use Edit on the review below" className="h-9" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ReviewSection
          title="Review with a way back"
          onEdit={() => setEdited("Edit pressed: the step opens again and every other value stays")}
          items={[
            { label: "Target", value: "Sample support assistant" },
            { label: "Attempt budget", value: "200 attempts" },
            { label: "Request rate", value: "15 per minute" },
            { label: "More settings", value: "adaptive agent off · 5 repetitions · any time of day" },
          ]}
        />
        <ImpactSummary
          title="Summary with all four kinds of value"
          items={[
            { label: "Attempt budget", value: "200 attempts", kind: "known" },
            { label: "Estimated attempts", value: "about 120", kind: "estimate", note: "From the tests that apply" },
            { label: "Estimated LLM cost", kind: "unknown", note: "Measured once this organization has judged attempts" },
            { label: "Threats covered", value: "8 of 12", kind: "stale", note: "Before the suites changed", fix: { label: "Recalculate", onClick: () => undefined } },
          ]}
          warnings={["The estimate is more than what is left of this month's limit, so the run may stop early."]}
        />
      </div>
    </section>
  )
}
