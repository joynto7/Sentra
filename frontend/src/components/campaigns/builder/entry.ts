/**
 * How the builder opens when the address names a target or a campaign to copy and a draft may exist.
 * A saved draft is never dropped without the person's say: a link that disagrees with it asks.
 *
 *   fresh    no draft, or nothing in the address: start as the address says (or empty)
 *   restore  a draft and no link: carry on with the draft
 *   ask      a draft and a link that names something else: say so, and offer both
 */
export type Entry = "fresh" | "restore" | "ask"

export function entryFor({
  hasDraft,
  draftTargetId,
  linkTarget,
  linkSuite,
  linkFrom,
}: {
  hasDraft: boolean
  draftTargetId: string
  linkTarget?: string
  linkSuite?: string
  linkFrom?: string
}): Entry {
  const hasLink = Boolean(linkTarget || linkSuite || linkFrom)
  if (!hasDraft) return "fresh"
  if (!hasLink) return "restore"
  // The same target and nothing else asked for: the draft already is what the link wants
  if (linkTarget && !linkSuite && !linkFrom && draftTargetId === linkTarget) return "restore"
  return "ask"
}
