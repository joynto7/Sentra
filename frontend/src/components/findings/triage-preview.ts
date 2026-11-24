import type { Decision, FindingStatus, TriageOptions } from "@/lib/findings"

/** What the person has filled in. `decision` is "" until they choose one: nothing is chosen for them. */
export type TriageDraft = {
  decision: Decision | ""
  reason: string
  mergeInto: string
  severity: string
  justification: string
  ownerId: string
  comment: string
}

export type TriagePreview = {
  /** What saving will do now, one plain sentence each, in the order the server records them */
  effects: string[]
  /** What is still missing, by field, so the person can fix it before pressing Save */
  missing: Partial<Record<"decision" | "reason" | "mergeInto" | "justification", string>>
  /** Saving would record at least one change */
  changes: boolean
}

const label = (status: FindingStatus) => status.replace(/_/g, " ")

/**
 * What saving a triage will do, computed from the options the server gave and the draft, and
 * nothing else: it states the real rules (UC-6.6), it does not predict a result. The server stays
 * the authority; this only keeps the person from pressing Save without knowing what it does.
 */
export function triagePreview(code: string, options: TriageOptions, draft: TriageDraft): TriagePreview {
  const effects: string[] = []
  const missing: TriagePreview["missing"] = {}

  if (draft.decision === "confirm") {
    if (options.status === "confirmed") effects.push(`${code} is already confirmed, so confirming changes nothing.`)
    else
      effects.push(
        options.requires_confirmation
          ? `Status: ${label(options.status)} → confirmed. It does not count towards the target's risk score until then; once confirmed it does.`
          : `Status: ${label(options.status)} → confirmed.`,
      )
  } else if (draft.decision === "false_positive") {
    if (!draft.reason.trim()) missing.reason = "Give the reason it is not a real weakness."
    effects.push(
      `Status: ${label(options.status)} → false positive, closed with your reason. It is kept, so detection quality can be measured.`,
    )
  } else if (draft.decision === "merge") {
    const survivor = options.duplicates.find((other) => other.code === draft.mergeInto)
    if (!survivor) missing.mergeInto = "Choose the finding this one duplicates."
    else
      effects.push(
        `${code} is closed as merged into ${survivor.code} (${survivor.title}), which stays open. Evidence is never moved: ${code} keeps its own records and both histories are read together under ${survivor.code}.`,
      )
  }

  const changedSeverity = draft.severity !== options.severity
  if (changedSeverity) {
    if (!draft.justification.trim()) missing.justification = "Say why the severity differs from the one in force."
    effects.push(
      `Severity: ${options.severity} → ${draft.severity}. It is then never overwritten by the rating again; the calculated one (${options.calculated_severity ?? "not rated yet"}) stays beside it.`,
    )
  }

  const currentOwner = options.owner?.id ?? ""
  if (draft.ownerId && draft.ownerId !== currentOwner) {
    const member = options.members.find((m) => m.id === draft.ownerId)
    effects.push(`Owner: ${options.owner?.name ?? "unassigned"} → ${member?.name ?? "the chosen person"}, who is notified.`)
  }

  if (draft.comment.trim()) effects.push("Your comment is added to the history.")

  const changes = effects.length > 0 && !(effects.length === 1 && effects[0].endsWith("changes nothing."))
  if (!draft.decision && !changes) missing.decision = "Choose a decision, or change the severity or owner, or write a comment."
  if (effects.length > 0) effects.push("It is recorded in the history and the audit log, and the target's risk score is recalculated.")
  return { effects, missing, changes }
}
