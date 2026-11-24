import { EMPTY_DRAFT, type ScheduleDraft } from "@/components/campaigns/schedule-fields"
import type { ThreatModelBrief } from "@/lib/campaigns"
import { WEEKDAYS } from "@/lib/campaigns"
import type { Target } from "@/lib/targets"
import type { SuiteItem } from "@/lib/test-library"

/**
 * What the campaign builder holds while someone fills it in, and the things kept on this device
 * so that a half-made campaign is not lost: the draft, and the setups the person saved to start from.
 */

/** How the assessment was chosen: a preset, the threat model's own, or the person's own list. */
export type Mode = "recommended" | "quick" | "full" | "custom"

export const QUICK = "QUICK-REGRESSION"
export const FULL = "FULL-ASSESSMENT"

export type Setup = {
  name: string
  /** A name the person typed or cleared stays; until then it follows the suggestion */
  nameEdited: boolean
  targetId: string
  mode: Mode | null
  chosen: string[]
  adaptive: boolean
  budget: string
  budgetEdited: boolean
  rate: string
  rateEdited: boolean
  repetitions: string
  windowStart: string
  windowEnd: string
  schedule: ScheduleDraft
}

export const BLANK: Setup = {
  name: "",
  nameEdited: false,
  targetId: "",
  mode: null,
  chosen: [],
  adaptive: false,
  budget: "1000",
  budgetEdited: false,
  rate: "",
  rateEdited: false,
  repetitions: "5",
  windowStart: "",
  windowEnd: "",
  schedule: EMPTY_DRAFT,
}

export const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)

/** The rate starts at three quarters of the target's safe rate; the person may raise it up to the limit. */
export const startingRate = (target: Target) => String(Math.max(1, Math.floor(target.max_request_rate * 0.75)))

/** The attempt budget a campaign starts with: what its tests need, and a quarter more for repeats. */
export const suggestedBudget = (estimated: number) => String(Math.max(100, Math.ceil((estimated * 1.25) / 100) * 100))

/** Which way the chosen suites were picked, when the person did not say. */
export function modeOf(chosen: string[], brief: ThreatModelBrief | null): Mode | null {
  if (chosen.length === 0) return null
  if (chosen.length === 1 && chosen[0] === QUICK) return "quick"
  if (chosen.length === 1 && chosen[0] === FULL) return "full"
  const recommended = brief?.default_suites ?? []
  if (recommended.length > 0 && recommended.length === chosen.length && recommended.every((code) => chosen.includes(code))) {
    return "recommended"
  }
  return "custom"
}

export function assessmentName(mode: Mode | null, chosen: string[], suites: SuiteItem[]): string {
  if (mode === "quick") return "Quick Regression"
  if (mode === "full") return "Full Assessment"
  if (mode === "recommended") return "Threat-model assessment"
  if (chosen.length === 1) return suites.find((suite) => suite.code === chosen[0])?.name ?? "Custom assessment"
  return chosen.length > 1 ? "Custom assessment" : "Assessment"
}

/** "Quick Regression — Payments Operations Agent": a name to start from, and the person's to change. */
export function suggestedName(mode: Mode | null, chosen: string[], suites: SuiteItem[], target: Target | undefined): string {
  return target ? `${assessmentName(mode, chosen, suites)} — ${target.name}` : ""
}

/** When it runs, in words. */
export function scheduleWords(draft: ScheduleDraft, timeZone: string, needsApproval: boolean): string {
  if (draft.kind === "immediately") {
    return needsApproval ? "Immediately after a Security Manager approves it" : "Immediately after you save it"
  }
  if (draft.kind === "once") {
    const at = draft.runAt ? new Date(draft.runAt) : null
    return at && !Number.isNaN(at.getTime())
      ? `Once, ${at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${timeZone})`
      : "Once, at a time still to choose"
  }
  const when =
    draft.frequency === "weekly"
      ? `Every ${WEEKDAYS[draft.weekday] ?? "week"}`
      : draft.frequency === "monthly"
        ? `On day ${draft.dayOfMonth} of every month`
        : "Every day"
  return `${when} at ${draft.atTime} (${timeZone})`
}

// ------------------------------------------------------------------ kept on this device

type Stored<T> = { v: 1; savedAt: string; data: T }

function read<T>(key: string): Stored<T> | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const found = JSON.parse(raw) as Stored<T>
    return found?.v === 1 ? found : null
  } catch {
    return null
  }
}

function write<T>(key: string, data: T): string | null {
  try {
    const savedAt = new Date().toISOString()
    window.localStorage.setItem(key, JSON.stringify({ v: 1, savedAt, data } satisfies Stored<T>))
    return savedAt
  } catch {
    // Private windows and blocked site data: the builder works as before, without a draft
    return null
  }
}

function drop(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // nothing kept, nothing to remove
  }
}

const scope = (userId: string, organizationId: string) => `${userId}:${organizationId}`

export type Draft = { step: number; setup: Setup }
export const draftKey = (userId: string, organizationId: string) => `sentra.campaign-draft.v1:${scope(userId, organizationId)}`
export const loadDraft = (key: string) => read<Draft>(key)
export const saveDraft = (key: string, draft: Draft) => write(key, draft)
export const clearDraft = (key: string) => drop(key)

/** What a saved setup keeps: the settings, not the target or the name. */
export type SetupSettings = Omit<Setup, "name" | "nameEdited" | "targetId">
export type SavedSetup = { id: string; label: string; savedAt: string; settings: SetupSettings }

export const setupsKey = (userId: string, organizationId: string) => `sentra.campaign-setups.v1:${scope(userId, organizationId)}`
export const loadSetups = (key: string): SavedSetup[] => read<SavedSetup[]>(key)?.data ?? []
export const saveSetups = (key: string, list: SavedSetup[]) => write(key, list.slice(0, 8))

const GUIDE = "sentra.campaign-builder.guide.v1"
export function guideSeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE) === "seen"
  } catch {
    return true
  }
}
export function markGuideSeen() {
  try {
    window.localStorage.setItem(GUIDE, "seen")
  } catch {
    // shown again next time
  }
}
