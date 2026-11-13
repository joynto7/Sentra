"use client"

import { useState } from "react"

import { FindingPreview } from "@/components/findings/finding-preview"
import { TriagePanel } from "@/components/findings/triage-panel"
import type { FindingDetail } from "@/lib/findings"

/**
 * A finding read in a panel beside the dashboard, so that nobody loses their place in the table or
 * their filters to look at one: the same panel the Findings list opens (what happened, the next
 * steps, Triage and Assign for those who may, "Open finding" for the whole page), with Previous and
 * Next through the findings the table shows. When it closes, the keyboard goes back to the row that
 * opened it. It adds no action of its own; every action is the one the finding's own panel has.
 */
export function FindingDetailSheet({
  code,
  codes,
  onSelect,
  onChanged,
  returnFocus,
}: {
  /** The finding that is open, or null */
  code: string | null
  /** The findings the table shows, in its order, for Previous and Next */
  codes: string[]
  onSelect: (code: string | null) => void
  /** A triage or an assignment changed a finding: the dashboard reads its numbers again */
  onChanged: () => void
  returnFocus: () => HTMLElement | null
}) {
  const [triaging, setTriaging] = useState<FindingDetail | null>(null)
  const index = code ? codes.indexOf(code) : -1
  return (
    <>
      <FindingPreview
        code={code}
        position={index >= 0 ? `${index + 1} of ${codes.length}` : ""}
        onClose={() => onSelect(null)}
        onTriage={(finding) => {
          // The preview closes first: the triage panel is the one in front, not a second beside it
          onSelect(null)
          setTriaging(finding)
        }}
        onChanged={onChanged}
        onPrevious={index > 0 ? () => onSelect(codes[index - 1]) : undefined}
        onNext={index >= 0 && index < codes.length - 1 ? () => onSelect(codes[index + 1]) : undefined}
        returnFocus={returnFocus}
      />
      {triaging && (
        <TriagePanel
          finding={triaging}
          open
          onOpenChange={(open) => !open && setTriaging(null)}
          returnFocus={returnFocus}
          onDone={() => {
            setTriaging(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}
