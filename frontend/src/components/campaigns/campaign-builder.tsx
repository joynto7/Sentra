"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Compass, X } from "lucide-react"
import { toast } from "sonner"

import { localDraftAdapter } from "@/components/campaigns/builder/draft-adapter"
import { entryFor } from "@/components/campaigns/builder/entry"
import { finalAction } from "@/components/campaigns/builder/final-action"
import { Preview, monthlyConflicts } from "@/components/campaigns/builder/preview"
import { Stepper, StepIntro, type StepInfo } from "@/components/campaigns/builder/parts"
import {
  BLANK,
  type Mode,
  QUICK,
  type SavedSetup,
  type Setup,
  type SetupSettings,
  assessmentName,
  type Draft,
  clearDraft,
  draftKey,
  guideSeen,
  loadDraft,
  loadSetups,
  markGuideSeen,
  modeOf,
  saveSetups,
  scheduleWords,
  setupsKey,
  startingRate,
  suggestedBudget,
  suggestedName,
  whole,
} from "@/components/campaigns/builder/setup"
import { type Fits, AssessmentStep, LimitsStep, ReviewStep, TargetStep } from "@/components/campaigns/builder/steps"
import { EMPTY_DRAFT, draftOf, scheduleInput, scheduleProblem } from "@/components/campaigns/schedule-fields"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  type CampaignDetail,
  type CampaignRow,
  type Estimate,
  createCampaign,
  estimateCampaign,
  getCampaign,
  listCampaigns,
} from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { type Target, listTargets } from "@/lib/targets"
import { type SuiteItem, listSuites } from "@/lib/test-library"
import { cn } from "@/lib/utils"
import { ActionFooter, WorkflowShell } from "@/components/wizard/shell"
import { DraftStatus, ErrorSummary } from "@/components/wizard/status"
import { useDraftFeedback } from "@/components/wizard/use-draft-feedback"

const STEPS: (StepInfo & { why: string })[] = [
  {
    label: "Target",
    question: "Which application are you assessing?",
    why: "Only a target whose ownership you have verified can be tested. Pick one and the rest of the steps adapt to it.",
  },
  {
    label: "Assessment",
    question: "What would you like to test?",
    why: "Start from a ready-made assessment, or choose the suites yourself. Each choice shows how many of its tests apply to this target.",
  },
  {
    label: "Limits & schedule",
    question: "How should this campaign run?",
    why: "How many attempts it may use, how fast it may go, and when it runs. Sensible values are already filled in.",
  },
  {
    label: "Review",
    question: "Ready to create this campaign?",
    why: "Check the plan. Each part has an Edit button, and the button at the bottom says exactly what it will do.",
  },
]

const FIELD_IDS: Record<string, string> = {
  name: "campaign-name",
  target_id: "campaign-target",
  suites: "campaign-suites",
  attempt_budget: "attempt-budget",
  request_rate: "request-rate",
  window: "window-start",
  repetitions: "repetitions",
  schedule_kind: "schedule-immediately",
  schedule_run_at: "schedule-run-at",
  schedule_at_time: "schedule-at-time",
}
// The step a field belongs to, so that an answer from the server opens the step that has the problem
const STEP_OF: Record<string, number> = {
  name: 0,
  target_id: 0,
  suites: 1,
  attempt_budget: 2,
  request_rate: 2,
  window: 2,
  repetitions: 2,
  schedule_kind: 2,
  schedule_run_at: 2,
  schedule_at_time: 2,
}

// What each field is called in the summary of what needs attention
const FIELD_LABEL: Record<string, string> = {
  name: "Campaign name",
  target_id: "Target",
  suites: "Assessment",
  attempt_budget: "Attempt budget",
  request_rate: "Request rate",
  window: "Time window",
  repetitions: "Repetitions",
  schedule_kind: "When it runs",
  schedule_run_at: "Run time",
  schedule_at_time: "Time of day",
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/**
 * Screen 34, the campaign builder: UC-5.1 Create Campaign (alternatives 2a and 6a), as four short
 * steps (target, assessment, limits and schedule, review) with a summary that estimates the tests,
 * the attempts and the cost as the choices are made. Nothing is sent to the target until a run starts;
 * the last button says whether saving starts one (Phase 02: "Save campaign", "Save and start run" or "Submit for approval").
 *
 * It follows what the research on guided task flows asks for: the question of each step in the
 * person's words, ready-made assessments as starting points, the detail only when it is asked for,
 * the effect of a choice shown at once, help beside the control that needs it, defaults that say where
 * they came from, a draft kept on this device, small changes of state that say what happened, and
 * shortcuts for the person who has done it before (copy a campaign, saved setups, jump to review).
 */
export function CampaignBuilder({ target: preselected, suite, from }: { target?: string; suite?: string; from?: string }) {
  const router = useRouter()
  const canCreate = useCan("manage_campaigns")
  const session = useSession()
  const organizationName = session.organization?.name ?? ""
  const draftId = draftKey(session.id, session.organization?.id ?? "")
  const setupsId = setupsKey(session.id, session.organization?.id ?? "")
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", [])

  const [targets, setTargets] = useState<Target[] | null>(null)
  const [suites, setSuites] = useState<SuiteItem[] | null>(null)
  const [recent, setRecent] = useState<CampaignRow[]>([])
  const [setups, setSetups] = useState<SavedSetup[]>([])
  const [failed, setFailed] = useState(false)
  const [setup, setSetup] = useState<Setup>({ ...BLANK, targetId: preselected ?? "", chosen: suite ? suite.split(",").filter(Boolean) : [] })
  const [step, setStep] = useState(0)
  // The furthest step opened: a step is ticked as done once it has been passed, not because its defaults are valid
  const [furthest, setFurthest] = useState(0)
  const [backwards, setBackwards] = useState(false)
  const [fits, setFits] = useState<Fits | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [answered, setAnswered] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [conflict, setConflict] = useState<{ at: string; data: Draft } | null>(null)
  const [dropped, setDropped] = useState<string[]>([])
  const [estimateStale, setEstimateStale] = useState(false)
  const [estimateTick, setEstimateTick] = useState(0)
  const [ack, setAck] = useState("")
  const saving = useRef(false)
  const holdDraft = useRef(false)
  const chosenNow = useRef<string[]>([])
  const adapter = useMemo(() => localDraftAdapter(draftId), [draftId])
  const draft = useDraftFeedback<Draft>(adapter, 500)
  const { noteEdit } = draft
  const [restoredAt, setRestoredAt] = useState<string | null>(null)
  // What the current targets and suites did to a draft or a copy: shown, never done silently
  const [reviewNotes, setReviewNotes] = useState<string[]>([])
  const [guide, setGuide] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  usePageCrumbs([{ label: "New Campaign" }])

  const update = useCallback((patch: Partial<Setup>) => {
    setSetup((now) => ({ ...now, ...patch }))
    setTouched(true)
    setErrors({})
    setConflict(null)
  }, [])

  // The targets, the suites and what the person has done before: all in at once, so the first step is whole.
  useEffect(() => {
    Promise.all([listTargets(new URLSearchParams({ tab: "active", page_size: "100" })), listSuites(), listCampaigns().catch(() => [] as CampaignRow[])])
      .then(([list, found, campaigns]) => {
        setTargets(list.items)
        setSuites(found)
        setRecent(campaigns.slice(0, 20))
        setSetups(loadSetups(setupsId))
        setGuide(!guideSeen())
        const usable = (id: string | undefined) => list.items.find((one) => one.id === id && one.status === "verified")
        const exists = (code: string) => found.some((one) => one.code === code)
        const kept = loadDraft(draftId)
        const entry = entryFor({
          hasDraft: kept !== null,
          draftTargetId: kept?.data.setup.targetId ?? "",
          linkTarget: preselected,
          linkSuite: suite,
          linkFrom: from,
        })
        if (entry === "restore" && kept) {
          const restored = kept.data.setup
          const notes: string[] = []
          if (restored.targetId && !usable(restored.targetId)) notes.push("Its target is not available or not verified any more, so none is chosen: choose a target again.")
          const dropped = restored.chosen.filter((code) => !exists(code))
          if (dropped.length) notes.push(`${dropped.length === 1 ? "1 test suite is" : `${dropped.length} test suites are`} no longer in the library and ${dropped.length === 1 ? "was" : "were"} removed: ${dropped.join(", ")}.`)
          setReviewNotes(notes)
          setSetup({
            ...BLANK,
            ...restored,
            targetId: usable(restored.targetId)?.id ?? "",
            chosen: restored.chosen.filter(exists),
          })
          const back = usable(restored.targetId) ? Math.min(kept.data.step, 3) : 0
          setStep(back)
          setFurthest(back)
          setRestoredAt(kept.savedAt)
          draft.restored(kept.savedAt)
          return
        }
        // A link that disagrees with a saved draft: the draft is kept until the person changes something here
        if (entry === "ask" && kept) {
          holdDraft.current = true
          setConflict({ at: kept.savedAt, data: kept.data })
        }
        if (from) {
          getCampaign(from)
            .then((detail) => copyOf(detail, list.items, found))
            .catch(() => {
              setReviewNotes([`The campaign you asked to copy (${from}) isn't available to you, so this form starts empty. Choose a target to begin.`])
              toast.error("That campaign could not be copied.")
            })
          return
        }
        // "Create campaign" on a target (UC-5.1 trigger) preselects it, if it can be tested.
        setSetup((now) => ({
          ...now,
          targetId: usable(preselected) ? now.targetId : "",
          chosen: now.chosen.filter(exists),
        }))
      })
      .catch(() => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, from the address and what is kept
  }, [])

  /** A campaign copied: its settings become this one's, and the review is where the person checks them. */
  function copyOf(detail: CampaignDetail, list: Target[], known: SuiteItem[]) {
    const target = list.find((one) => one.id === detail.target?.id && one.status === "verified")
    let schedule = detail.schedule ? draftOf(detail.schedule) : EMPTY_DRAFT
    const notes: string[] = [`Copied from ${detail.code} (${detail.name}). Nothing is sent or approved until you save.`]
    if (!target) notes.push(`Its target ${detail.target?.name ? `(${detail.target.name}) ` : ""}is not available or not verified now, so none is chosen: choose another.`)
    const lost = detail.suites.map((one) => one.code).filter((code) => !known.some((suite) => suite.code === code))
    if (lost.length) notes.push(`${lost.length === 1 ? "1 test suite is" : `${lost.length} test suites are`} no longer in the library and ${lost.length === 1 ? "was" : "were"} left out: ${lost.join(", ")}.`)
    if (target && detail.request_rate > target.max_request_rate) notes.push(`Its request rate was lowered from ${detail.request_rate} to ${target.max_request_rate}, the most this target accepts.`)
    if (schedule.kind === "once" && new Date(schedule.runAt).getTime() <= Date.now()) {
      schedule = EMPTY_DRAFT
      notes.push("Its one-time schedule was in the past, so no schedule is set.")
    }
    setReviewNotes(notes)
    setSetup({
      ...BLANK,
      targetId: target?.id ?? "",
      chosen: detail.suites.map((one) => one.code).filter((code) => known.some((suite) => suite.code === code)),
      adaptive: detail.adaptive_agent,
      budget: String(detail.attempt_budget),
      budgetEdited: true,
      rate: String(target ? Math.min(detail.request_rate, target.max_request_rate) : detail.request_rate),
      rateEdited: true,
      repetitions: String(detail.repetitions),
      windowStart: detail.window_start?.slice(0, 5) ?? "",
      windowEnd: detail.window_end?.slice(0, 5) ?? "",
      schedule,
    })
    // While a saved draft is waiting for the person's choice, a copy does not overwrite it
    setTouched(!holdDraft.current)
    setErrors({})
    setStep(target ? 3 : 0)
    setFurthest(target ? 3 : 0)
    toast.success(`Settings copied from ${detail.name}`, {
      description: target ? "Check the review, change what you need and save." : "Its target can't be tested now, so choose another.",
    })
  }

  const target = targets?.find((one) => one.id === setup.targetId)
  const fitsHere = fits?.targetId === setup.targetId ? fits : null
  const brief = fitsHere?.brief ?? null
  const mode: Mode | null = setup.mode ?? modeOf(setup.chosen, brief)
  const suggestion = suggestedName(mode, setup.chosen, suites ?? [], target)
  const name = setup.nameEdited ? setup.name : suggestion
  const rate = setup.rateEdited ? setup.rate : target ? startingRate(target) : ""
  const budgetParam = setup.budgetEdited ? whole(setup.budget) : null
  const budget = setup.budgetEdited ? setup.budget : estimate && setup.chosen.length > 0 ? suggestedBudget(estimate.estimated_attempts) : setup.budget
  const budgetValue = whole(budget)
  const needsApproval = estimate?.requires_scope_approval ?? fitsHere?.approval ?? false
  const conflicts = monthlyConflicts(estimate, budgetValue)
  const conflictsKey = conflicts.join("|")

  // What each suite, and the recommendation, comes to on this target: the exact tests that apply.
  useEffect(() => {
    const id = setup.targetId
    if (!id || canCreate !== true || !suites) return
    let active = true
    void (async () => {
      const [head, ...each] = await Promise.allSettled([
        estimateCampaign({ target_id: id, suites: [], attempt_budget: null }),
        ...suites.map((one) => estimateCampaign({ target_id: id, suites: [one.code], attempt_budget: null })),
      ])
      if (!active) return
      const model = head.status === "fulfilled" ? head.value.threat_model : null
      const bySuite: Fits["bySuite"] = {}
      suites.forEach((one, index) => {
        const result = each[index]
        if (result.status === "fulfilled") {
          bySuite[one.code] = { tests: result.value.tests, skipped: result.value.skipped, attempts: result.value.estimated_attempts }
        }
      })
      let recommended: Fits["recommended"] = null
      if (model && model.default_suites.length > 0) {
        try {
          const one = await estimateCampaign({ target_id: id, suites: model.default_suites, attempt_budget: null })
          recommended = { tests: one.tests, skipped: one.skipped, attempts: one.estimated_attempts }
        } catch {
          recommended = null
        }
      }
      if (!active) return
      // Switching target revalidates what was chosen: a suite none of whose tests apply here can't stay chosen
      const dead = chosenNow.current.filter((code) => bySuite[code] !== undefined && bySuite[code].tests === 0)
      if (dead.length > 0) setDropped(dead.map((code) => suites.find((one) => one.code === code)?.name ?? code))
      setFits({ targetId: id, brief: model, bySuite, recommended, approval: head.status === "fulfilled" && head.value.requires_scope_approval })
      // UC-5.1 step 2: the suites saved for the target's threat model (FR-3.4) start chosen; failing
      // that, a quick regression. Only while nothing is chosen, so a choice is never overwritten.
      setSetup((now) => {
        if (now.targetId !== id) return now
        if (dead.length > 0) {
          const left = now.chosen.filter((code) => !dead.includes(code))
          now = { ...now, chosen: left, mode: left.length === 0 ? null : now.mode === "recommended" || now.mode === "quick" || now.mode === "full" ? "custom" : now.mode }
        }
        if (now.chosen.length > 0) return now
        if (model && model.default_suites.length > 0) return { ...now, mode: "recommended", chosen: model.default_suites }
        if (suites.some((one) => one.code === QUICK)) return { ...now, mode: "quick", chosen: [QUICK] }
        return now
      })
    })()
    return () => {
      active = false
    }
  }, [setup.targetId, canCreate, suites])

  // The summary (UC-5.1 step 6): from the API shortly after the choices change.
  const asked = JSON.stringify([setup.targetId, setup.chosen, budgetParam])
  useEffect(() => {
    if (canCreate !== true) return
    let active = true
    const timer = setTimeout(() => {
      estimateCampaign({ target_id: setup.targetId || null, suites: setup.chosen, attempt_budget: budgetParam })
        .then((result) => {
          if (!active) return
          setEstimate(result)
          setAnswered(asked)
          setEstimateStale(false)
        })
        .catch(() => active && setEstimateStale(true))
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [asked, canCreate, setup.targetId, setup.chosen, budgetParam, estimateTick])

  // The draft is kept on this device a moment after the last change; the status says what really happened.
  useEffect(() => {
    if (touched) noteEdit({ step, setup })
  }, [touched, setup, step, noteEdit])
  useEffect(() => {
    chosenNow.current = setup.chosen
  }, [setup.chosen])

  // A step opens with its question focused, so that a screen reader says where it is.
  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    heading.current?.focus()
  }, [step])

  // ---------------------------------------------------------------- the choices

  function chooseTarget(id: string) {
    const next = targets?.find((one) => one.id === id)
    setSetup((now) => ({
      ...now,
      targetId: id,
      // The recommendation belongs to the target it was made for
      mode: now.mode === "recommended" ? null : now.mode,
      chosen: now.mode === "recommended" ? [] : now.chosen,
      rate: now.rateEdited && next ? String(Math.min(whole(now.rate) ?? 0, next.max_request_rate) || startingRate(next)) : now.rate,
    }))
    setTouched(true)
    setErrors({})
    setConflict(null)
    setDropped([])
  }

  function chooseMode(next: Mode) {
    const pick = (codes: string[]) => update({ mode: next, chosen: codes })
    if (next === "recommended") pick(brief?.default_suites ?? [])
    else if (next === "quick") pick([QUICK])
    else if (next === "full") pick(["FULL-ASSESSMENT"])
    else update({ mode: "custom" })
  }

  function toggleSuite(code: string, on: boolean) {
    update({ mode: "custom", chosen: on ? [...setup.chosen, code] : setup.chosen.filter((one) => one !== code) })
  }

  function applySetup(saved: SavedSetup) {
    update(saved.settings)
    toast.success(`Started from “${saved.label}”`, { description: "Your target and name are still to choose." })
  }

  function keepSetup(label: string) {
    const settings: SetupSettings = {
      mode: setup.mode ?? mode,
      chosen: setup.chosen,
      adaptive: setup.adaptive,
      budget,
      budgetEdited: true,
      rate,
      rateEdited: true,
      repetitions: setup.repetitions,
      windowStart: setup.windowStart,
      windowEnd: setup.windowEnd,
      schedule: setup.schedule,
    }
    const list = [{ id: crypto.randomUUID(), label, savedAt: new Date().toISOString(), settings }, ...setups.filter((one) => one.label !== label)]
    saveSetups(setupsId, list)
    setSetups(list.slice(0, 8))
  }

  // ---------------------------------------------------------------- the steps

  /** What is wrong with a step, before anything is sent (UC-5.1, 6a: the rate's limit is named at once). */
  function problems(index: number): Record<string, string> {
    const found: Record<string, string> = {}
    if (index === 0) {
      if (!target) found.target_id = "Choose the target to assess."
      else if (!name.trim()) found.name = "Name the campaign. The suggestion is a good start."
    }
    if (index === 1 && setup.chosen.length === 0) found.suites = "Choose an assessment, or tick at least one test suite."
    if (index === 2) {
      if (budgetValue === null || budgetValue < 1) found.attempt_budget = "Enter a whole number of attempts, 1 or more."
      const rateValue = whole(rate)
      if (rateValue === null || rateValue < 1) found.request_rate = "Enter a whole number of requests per minute, 1 or more."
      else if (target && rateValue > target.max_request_rate) {
        found.request_rate = `The rate can't exceed the target's safe rate of ${target.max_request_rate} per minute.`
      }
      const times = whole(setup.repetitions)
      if (times === null || times < 1) found.repetitions = "Enter a whole number, 1 or more."
      if (Boolean(setup.windowStart) !== Boolean(setup.windowEnd)) found.window = "Set both ends of the time window, or leave both empty."
      const wrong = scheduleProblem(setup.schedule)
      if (wrong) found[setup.schedule.kind === "once" ? "schedule_run_at" : "schedule_at_time"] = wrong
    }
    return found
  }
  const finished = [0, 1, 2].map((index) => Object.keys(problems(index)).length === 0)
  const done = [...finished.map((ok, index) => ok && index < Math.max(furthest, step)), false]
  const reachable = STEPS.map((_, index) => index <= step || finished.slice(0, index).every(Boolean))
  const everyStepReady = finished.every(Boolean)

  function focusFirst(found: Record<string, string>) {
    const first = Object.keys(found).find((field) => FIELD_IDS[field])
    const element = first ? document.getElementById(FIELD_IDS[first]) : null
    const focusable = element?.matches("input, button") ? element : element?.querySelector<HTMLElement>("input, button")
    if (focusable) setTimeout(() => focusable.focus(), 60)
  }

  function go(index: number) {
    setBackwards(index < step)
    setStep(index)
    setFurthest((now) => Math.max(now, index))
  }

  function next() {
    const found = problems(step)
    if (Object.keys(found).length > 0) {
      setErrors(found)
      focusFirst(found)
      return
    }
    setErrors({})
    go(step + 1)
  }

  function jumpToReview() {
    setErrors({})
    go(3)
  }

  async function save() {
    // One request at a time: a second press, or Enter, while the first is on its way does nothing
    if (saving.current) return
    setFormError(null)
    for (const index of [0, 1, 2]) {
      const found = problems(index)
      if (Object.keys(found).length > 0) {
        setErrors(found)
        go(index)
        focusFirst(found)
        return
      }
    }
    if (conflictsKey && ack !== conflictsKey) {
      setFormError("Tick the box that says you understand the run may stop early, or change the limits.")
      return
    }
    saving.current = true
    setBusy(true)
    try {
      const saved = await createCampaign({
        name: name.trim(),
        target_id: setup.targetId || null,
        suites: setup.chosen,
        adaptive_agent: setup.adaptive,
        attempt_budget: budgetValue,
        request_rate: whole(rate),
        repetitions: whole(setup.repetitions),
        window_start: setup.windowStart || null,
        window_end: setup.windowEnd || null,
        time_zone: timeZone,
        schedule: scheduleInput(setup.schedule),
      })
      clearDraft(draftId)
      draft.reset()
      // UC-5.1 step 7: a campaign that runs immediately has its first run already (UC-5.3), and
      // the monitor is where it is followed; 7a and 3a say why no run started.
      if (saved.launched_run) {
        toast.success(`${saved.code} saved and launched`, { description: `Run ${saved.launched_run.code}` })
        router.push(`/campaigns/${saved.code}/runs/${saved.launched_run.number}`)
        return
      }
      toast.success(
        saved.approval_status === "awaiting_approval" ? `${saved.code} submitted for approval` : `${saved.code} saved`,
        {
          description:
            saved.approval_status === "awaiting_approval"
              ? "A Security Manager has been asked to approve its scope."
              : (saved.launch_error ?? "Nothing has been sent to the target."),
        },
      )
      router.push(`/campaigns/${saved.code}`)
    } catch (error) {
      saving.current = false
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
      const first = Math.min(...Object.keys(found).map((field) => STEP_OF[field] ?? 3), 3)
      if (first < 3) go(first)
      focusFirst(found)
    }
  }

  if (canCreate === false) {
    return (
      <EmptyState
        title="Only Security Analysts create campaigns"
        description="Ask a Security Analyst."
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

  const rateValue = whole(rate)
  const rateError =
    target && rateValue !== null && rateValue > target.max_request_rate
      ? `The rate can't exceed the target's safe rate of ${target.max_request_rate} per minute.`
      : errors.request_rate
  const last = step === STEPS.length - 1
  const suggestedBudgetText =
    !setup.budgetEdited && estimate && setup.chosen.length > 0
      ? `Suggested: the ${estimate.estimated_attempts.toLocaleString("en-GB")} attempts these tests need, plus a quarter for repeats. The run stops when it is used up.`
      : null

  const timeline = scheduleWords(setup.schedule, timeZone, needsApproval)
  const final = finalAction({
    needsApproval,
    immediate: setup.schedule.kind === "immediately",
    targetName: target?.name ?? "the target",
    when: timeline,
  })
  const acknowledged = conflictsKey !== "" && ack === conflictsKey
  const problemList = Object.entries(errors)
    .filter(([field]) => FIELD_IDS[field])
    .map(([field, message]) => ({ field, label: FIELD_LABEL[field] ?? field, message }))
  const goToField = (field: string) => {
    const wanted = STEP_OF[field] ?? step
    if (wanted !== step) go(wanted)
    focusFirst({ [field]: "" })
  }
  const draftTarget = conflict ? targets.find((one) => one.id === conflict.data.setup.targetId) : undefined
  const linkTarget = preselected ? targets.find((one) => one.id === preselected) : undefined

  return (
    <>
      <WorkflowShell
        title="New Campaign"
        purpose="What is tested, how much and how fast. Nothing is sent to the target until a run starts; the last step says whether saving starts one."
        status={<DraftStatus feedback={draft.feedback} onRetry={() => void draft.retry()} className="pt-1" />}
        exit={
          <Button type="button" variant="ghost" className="h-9" onClick={() => (touched ? setConfirmLeave(true) : router.push("/campaigns"))}>
            Cancel
          </Button>
        }
        notices={
          <>
            {guide && step === 0 && !conflict && (
              <div className="flex items-start gap-3 rounded-[10px] border border-primary/30 bg-primary/5 p-4 motion-safe:animate-in motion-safe:fade-in-0">
                <Compass className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">First campaign? Four short steps.</p>
                  <p className="mt-0.5 text-text-secondary">Target, tests, limits, review. Your draft is kept on this device.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-mt-1 -mr-1 size-8 shrink-0"
                  aria-label="Dismiss the introduction"
                  onClick={() => {
                    markGuideSeen()
                    setGuide(false)
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )}

            {!guide && step === 0 && !conflict && (
              <p className="text-[13px] text-muted-foreground">
                Hints are hidden. Nothing here depends on them: the target and its verification are required whether they are shown or not.{" "}
                <button type="button" className="rounded text-link underline underline-offset-2" onClick={() => setGuide(true)}>
                  Show the short guide
                </button>
              </p>
            )}

            {conflict && (
              <Alert role="status">
                <AlertDescription className="space-y-2">
                  <p>
                    You have a draft from {when(conflict.at)}
                    {draftTarget ? ` for ${draftTarget.name}` : ""}. This link starts from{" "}
                    {from ? "a copied campaign" : linkTarget ? linkTarget.name : "the choices in the link"}. The draft stays until you change something here; then it is replaced.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const restored = conflict.data.setup
                        const usable = targets.find((one) => one.id === restored.targetId && one.status === "verified")
                        setSetup({ ...BLANK, ...restored, targetId: usable?.id ?? "", chosen: restored.chosen.filter((code) => suites.some((one) => one.code === code)) })
                        const back = usable ? Math.min(conflict.data.step, 3) : 0
                        setStep(back)
                        setFurthest(back)
                        setRestoredAt(conflict.at)
                        draft.restored(conflict.at)
                        setTouched(false)
                        holdDraft.current = false
                        setConflict(null)
                      }}
                    >
                      Continue my draft
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setConflict(null)}>
                      Start from this link
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {reviewNotes.length > 0 && !conflict && (
              <Alert role="status">
                <AlertDescription>
                  <p className="font-medium">What changed since this was kept</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {reviewNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {restoredAt && !conflict && (
              <Alert role="status">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>Your draft from {when(restoredAt)} was restored.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      clearDraft(draftId)
                      draft.reset()
                      setSetup(BLANK)
                      setStep(0)
                      setFurthest(0)
                      setTouched(false)
                      setRestoredAt(null)
                      setReviewNotes([])
                    }}
                  >
                    Start over
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {formError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </>
        }
        steps={
          <>
            <Stepper steps={STEPS} current={step} done={done} reachable={reachable} onGo={go} />
            <p className="sr-only" aria-live="polite">
              Step {step + 1} of {STEPS.length}: {STEPS[step].question}
            </p>
          </>
        }
        aside={
          <Preview
            estimate={estimate}
            estimating={answered !== asked}
            stale={estimateStale}
            onRetry={() => setEstimateTick((n) => n + 1)}
            chosenCount={setup.chosen.length}
            assessment={setup.chosen.length > 0 ? assessmentName(mode, setup.chosen, suites) : null}
            targetName={target?.name ?? null}
            budget={budgetValue}
            when={timeline}
            organizationName={organizationName}
            conflicts={conflicts}
          />
        }
        footer={
          <ActionFooter
            onBack={step > 0 ? () => go(step - 1) : undefined}
            onContinue={next}
            continueLabel={last ? undefined : `Next: ${STEPS[step + 1].label}`}
            continueShort="Next"
            skip={!last && everyStepReady && step < 2 ? { label: "Skip to review", onClick: jumpToReview } : undefined}
            final={
              last
                ? {
                    label: final.label,
                    pendingLabel: final.pendingLabel,
                    formId: "campaign",
                    blockedReason: conflicts.length > 0 && !acknowledged ? "Tick the box above to confirm you have read the month's limit, or change the limits." : undefined,
                  }
                : undefined
            }
            pending={busy}
          />
        }
      >
        <form
          id="campaign"
          noValidate
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault()
            // Enter inside a field goes on to the next step; only the last step saves
            if (last) void save()
            else next()
          }}
        >
          <div
            key={step}
            className={cn(
              "space-y-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200",
              backwards ? "motion-safe:slide-in-from-left-3" : "motion-safe:slide-in-from-right-3",
            )}
          >
            <ErrorSummary problems={problemList} onGo={goToField} />
            <StepIntro step={step + 1} total={STEPS.length} question={STEPS[step].question} why={STEPS[step].why} headingRef={heading} />
            {step === 0 && (
              <TargetStep
                targets={targets}
                target={target}
                setup={setup}
                onTarget={chooseTarget}
                update={update}
                name={name}
                suggestion={suggestion}
                errors={errors}
                recent={recent}
                onDuplicate={(code) => {
                  getCampaign(code)
                    .then((detail) => copyOf(detail, targets, suites))
                    .catch(() => toast.error("That campaign could not be copied."))
                }}
                setups={setups}
                onApplySetup={applySetup}
              />
            )}
            {step === 1 && target && (
              <AssessmentStep
                suites={suites}
                fits={fits}
                target={target}
                mode={mode}
                chosen={setup.chosen}
                onMode={chooseMode}
                onToggle={toggleSuite}
                error={errors.suites}
                dropped={dropped}
                onDismissDropped={() => setDropped([])}
              />
            )}
            {step === 2 && target && (
              <LimitsStep
                setup={setup}
                update={update}
                target={target}
                suggestedBudgetText={suggestedBudgetText}
                budget={budget}
                rate={rate}
                timeZone={timeZone}
                needsApproval={needsApproval}
                errors={errors}
                rateError={rateError}
              />
            )}
            {step === 3 && target && (
              <ReviewStep
                setup={setup}
                name={name}
                suggestion={suggestion}
                update={update}
                target={target}
                suites={suites}
                estimateTests={estimate && answered === asked ? estimate.tests : null}
                estimateSkipped={estimate && answered === asked ? estimate.skipped : null}
                budget={budget}
                rate={rate}
                timeZone={timeZone}
                needsApproval={needsApproval}
                conflicts={conflicts}
                acknowledged={acknowledged}
                onAcknowledge={(yes) => setAck(yes ? conflictsKey : "")}
                final={final}
                errors={errors}
                onEdit={go}
                onSaveSetup={keepSetup}
                canSaveSetup
              />
            )}
          </div>
        </form>
      </WorkflowShell>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Leave this campaign?</DialogTitle>
            <DialogDescription>
              Nothing has been created. Your draft is kept on this device, so you can carry on from here later, or you can discard it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button variant="outline" className="h-9" onClick={() => router.push("/campaigns")}>
              Leave, keep the draft
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              onClick={() => {
                clearDraft(draftId)
                router.push("/campaigns")
              }}
            >
              Discard the draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
