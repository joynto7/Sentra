/**
 * What the last button of the campaign builder really does, said in its own words. Three outcomes exist
 * and the button, the sentence next to it, the pending label and the toast are all drawn from this one
 * place, so they cannot disagree:
 *
 *   approval required            -> "Submit for approval": nothing runs before a Security Manager approves
 *   no approval, runs at once    -> "Save and start run": the first run starts now and sends requests
 *   no approval, runs later      -> "Save campaign": created; nothing is sent before the schedule says so
 */
export type FinalOperation = "submit" | "start" | "save"

export type FinalAction = {
  operation: FinalOperation
  label: string
  pendingLabel: string
  /** One sentence for the review: what pressing the button causes */
  effect: string
}

export function finalAction({
  needsApproval,
  immediate,
  targetName,
  when,
}: {
  needsApproval: boolean
  /** The schedule is "immediately" */
  immediate: boolean
  targetName: string
  /** The schedule in words, for the sentence of a campaign that runs later */
  when: string
}): FinalAction {
  if (needsApproval) {
    return {
      operation: "submit",
      label: "Submit for approval",
      pendingLabel: "Submitting…",
      effect: "A Security Manager reviews the scope first. Nothing is sent to the target and nothing runs before they approve.",
    }
  }
  if (immediate) {
    return {
      operation: "start",
      label: "Save and start run",
      pendingLabel: "Starting…",
      effect: `The first run starts as soon as you save. Sentra sends test requests to ${targetName} within the limits above, and you follow the run on its page.`,
    }
  }
  return {
    operation: "save",
    label: "Save campaign",
    pendingLabel: "Saving…",
    effect: `The campaign is created and runs ${when.charAt(0).toLowerCase()}${when.slice(1)}. Nothing is sent to the target before then.`,
  }
}
