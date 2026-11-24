import type { Target } from "@/lib/targets"

export type DraftSummary = { targetId: string; suites: number; step: number; savedAt: string }
export type EntryStatus = {
  state: "ok" | "no-target" | "unverified" | "archived" | "gone" | "forbidden"
  /** In words: what is true now about this draft, and what opening it will do */
  message: string
  canContinue: boolean
}

/**
 * What a kept campaign draft can still do, judged against the target as the server answers now and
 * the person's permission now. A draft never opens as valid work by itself: a target that is gone,
 * archived or not verified any more is said, and the draft opens at the target step where a choice has
 * to be made again. Nothing is substituted for the person.
 *
 * `target` is the server's answer for the draft's target: a Target, `null` when the server says it does
 * not exist or is not this organization's, `undefined` while it is still being asked.
 */
export function draftEntryStatus(draft: DraftSummary, target: Target | null | undefined, canCreate: boolean): EntryStatus | null {
  if (target === undefined && draft.targetId) return null
  if (!canCreate)
    return { state: "forbidden", message: "Your role can't create campaigns now, so this draft can't be continued. It is kept on this device until you discard it.", canContinue: false }
  if (!draft.targetId) return { state: "no-target", message: "No target is chosen yet. Opening it continues from the target step.", canContinue: true }
  if (target === null || target === undefined)
    return { state: "gone", message: "Its target is not available in this organization any more. Opening it asks you to choose a target again; nothing is substituted.", canContinue: true }
  if (target.status === "archived" || target.archived_at)
    return { state: "archived", message: `${target.name} has been archived. Opening it asks you to choose another target.`, canContinue: true }
  if (target.status !== "verified")
    return { state: "unverified", message: `${target.name} is not verified now, so a campaign can't run against it. Opening it keeps your other choices and asks for a verified target.`, canContinue: true }
  return { state: "ok", message: `${target.name} is available and verified. Your choices are checked again against the current suites when it opens.`, canContinue: true }
}
