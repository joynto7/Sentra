"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, CircleHelp } from "lucide-react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/findings/finding-badges"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useSession } from "@/components/session-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  FINDING_STATUS_LABEL,
  type FindingDetail,
  type TriageOptions,
  getFinding,
  getTriageOptions,
  saveTriage,
} from "@/lib/findings"
import { useCan } from "@/lib/permissions"
import { OPEN_STATUSES } from "@/lib/risk"

const isOpen = (finding: FindingDetail) => (OPEN_STATUSES as readonly string[]).includes(finding.status)

/**
 * What should happen to a finding next, said for the person reading it: an analyst is told what
 * to do, anybody else who does it (UC-6.6, FR-6.5 (M6)). A closed finding needs nothing.
 */
function nextStep(finding: FindingDetail, canTriage: boolean, canRequest: boolean, me: string): string {
  switch (finding.status) {
    case "requires_confirmation":
      return canTriage
        ? "Confirm it or mark it a false positive. Until then it doesn't count towards the target's risk score."
        : "A Security Analyst confirms or rejects it before it counts towards the target's risk score."
    case "new":
      return canTriage
        ? "Triage it: confirm it, mark it a false positive, or merge it into a finding with the same cause."
        : "A Security Analyst triages it next: confirms it, marks it a false positive or merges it."
    case "confirmed":
    case "reopened": {
      const again = finding.status === "reopened" ? "It came back after a fix. " : ""
      const owner = finding.owner
        ? finding.owner.id === me
          ? "You own it."
          : `${finding.owner.name} owns it.`
        : canTriage
          ? "Give it an owner, who then fixes it."
          : "Nobody owns it yet: a Security Analyst assigns it."
      return `${again}${owner}${canRequest ? " A remediation can be requested on its page." : ""}`
    }
    case "merged":
      return `Nothing: it was merged into ${finding.merged_into ?? "another finding"}, where its evidence is read.`
    default:
      return `Nothing: it is ${FINDING_STATUS_LABEL[finding.status].toLowerCase()}.`
  }
}

/** "Assign": the owner alone, saved like a triage that changes only the owner (UC-6.6 step 4). */
function AssignOwner({
  finding,
  onDone,
  onCancel,
}: {
  finding: FindingDetail
  onDone: (saved: FindingDetail) => void
  onCancel: () => void
}) {
  const [options, setOptions] = useState<TriageOptions | null>(null)
  const [owner, setOwner] = useState("")
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getTriageOptions(finding.code, controller.signal)
      .then((found) => {
        setOptions(found)
        setOwner(found.owner?.id ?? found.suggested_owner?.id ?? "")
      })
      .catch((error) => !controller.signal.aborted && setFailed(error instanceof ApiError ? error.message : "The members could not be loaded."))
    return () => controller.abort()
  }, [finding.code])

  async function save() {
    setSaving(true)
    setFailed(null)
    try {
      const saved = await saveTriage(finding.code, { owner_id: owner })
      const name = options?.members.find((member) => member.id === owner)?.name ?? "the new owner"
      toast.success(`${finding.code} is assigned to ${name}`, { description: "They are notified." })
      onDone(saved)
    } catch (error) {
      setFailed(error instanceof ApiError ? error.message : "The owner could not be saved.")
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-[7px] border p-3">
      <label htmlFor="assign-owner" className="block text-sm font-medium">
        Owner of {finding.code}
      </label>
      {options ? (
        <select
          id="assign-owner"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          className="h-9 w-full rounded-[7px] border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <option value="" disabled>
            Choose a member
          </option>
          {options.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {member.id === options.suggested_owner?.id ? ` — ${options.suggested_owner.reason} (suggested)` : ""}
            </option>
          ))}
        </select>
      ) : (
        !failed && <Skeleton className="h-9 w-full" />
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {failed}
        </p>
      )}
      <div className="flex gap-2">
        <Button className="h-9 hover:bg-primary-hover" disabled={!owner || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save owner"}
        </Button>
        <Button variant="ghost" className="h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * The side panel of Screen 38: what a finding is about before opening it (UC-6.4 step 5), and what
 * happens to it next. "Previous" and "Next" walk through the list without closing the panel, so a
 * list can be worked through one finding at a time; Triage opens Screen 41 in its place.
 */
export function FindingPreview({
  code,
  position,
  onClose,
  onTriage,
  onChanged,
  onPrevious,
  onNext,
  returnFocus,
}: {
  code: string | null
  /** "3 of 25": where the finding stands in the list as it is sorted and filtered */
  position: string
  onClose: () => void
  onTriage: (finding: FindingDetail) => void
  onChanged: (finding: FindingDetail) => void
  onPrevious?: () => void
  onNext?: () => void
  /** Where the keyboard goes back to when the panel closes: the button that opened it */
  returnFocus?: () => HTMLElement | null
}) {
  const canTriage = useCan("triage_findings")
  const canRequest = useCan("request_remediations")
  const me = useSession().id
  const [finding, setFinding] = useState<FindingDetail | null>(null)
  const [failed, setFailed] = useState<{ code: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [assigning, setAssigning] = useState<string | null>(null)
  // After "Assign" closes, the keyboard stays where the person was working (WCAG 2.4.3)
  const assignButton = useRef<HTMLButtonElement>(null)
  const nextHeading = useRef<HTMLHeadingElement>(null)
  // "Triage" hands the keyboard to the triage panel, which opens as this one closes
  const toTriage = useRef(false)
  const focusSoon = (target: { current: HTMLElement | null }) => requestAnimationFrame(() => target.current?.focus())

  useEffect(() => {
    if (!code) return
    const controller = new AbortController()
    getFinding(code, controller.signal)
      .then(setFinding)
      .catch((error) => {
        if (controller.signal.aborted) return
        setFailed({ code, message: error instanceof ApiError ? error.message : "This finding could not be loaded." })
      })
    return () => controller.abort()
  }, [code, attempt])

  // While another finding is being read, the panel shows its skeleton, not the one before.
  const shown = finding && finding.code === code ? finding : null
  const problem = !shown && failed?.code === code ? failed.message : null
  const judgeOnly = shown?.status === "requires_confirmation"
  const judge = shown?.detection?.methods.find((method) => method.method === "llm_judge")

  return (
    <Sheet open={code !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full gap-0 sm:max-w-[480px]"
        onCloseAutoFocus={(event) => {
          if (toTriage.current) {
            toTriage.current = false
            event.preventDefault()
            return
          }
          const target = returnFocus?.()
          if (target) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
        {shown ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6 text-left">{shown.title}</SheetTitle>
              <SheetDescription className="text-left">
                <span className="font-mono">{shown.code}</span> · {shown.target.name}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={shown.severity} />
                {shown.severity_provisional && <span className="text-xs text-muted-foreground">Provisional</span>}
                <StatusBadge status={shown.status} />
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{shown.category}</span> {shown.category_name}
                  {shown.atlas.length > 0 && <span className="font-mono"> · {shown.atlas.join(", ")}</span>}
                </span>
              </div>

              <section aria-labelledby="preview-happened" className="space-y-1">
                <h3 id="preview-happened" className="text-sm font-semibold">
                  What happened
                </h3>
                <p className="line-clamp-3 text-sm text-text-secondary">{shown.description}</p>
                <p className="text-xs text-muted-foreground">
                  Detection:{" "}
                  {judgeOnly
                    ? `LLM judge only${judge?.confidence ? ` (confidence ${Number(judge.confidence).toFixed(2)})` : ""}`
                    : shown.detection
                      ? shown.detection.methods
                          .filter((method) => method.outcome === "met")
                          .map((method) => method.method_label)
                          .join(", ") || "none met"
                      : "not evaluated yet"}
                  {" · "}
                  {shown.evidence_count} {shown.evidence_count === 1 ? "piece" : "pieces"} of evidence
                </p>
              </section>

              {judgeOnly && (
                <p className="flex items-start gap-2 rounded-[7px] border border-dashed border-warning/60 bg-warning/5 p-3 text-sm text-warning">
                  <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Only the LLM judge supports this finding, so it waits for an analyst&apos;s confirmation.
                </p>
              )}

              <section aria-labelledby="preview-next" className="space-y-1">
                <h3 id="preview-next" ref={nextHeading} tabIndex={-1} className="text-sm font-semibold outline-none">
                  Next steps
                </h3>
                <p className="text-sm text-text-secondary">{nextStep(shown, Boolean(canTriage), Boolean(canRequest), me)}</p>
                {isOpen(shown) && shown.test.recommended_mitigation && (
                  <p className="line-clamp-3 text-sm text-text-secondary">
                    <span className="font-medium text-foreground">How to fix it: </span>
                    {shown.test.recommended_mitigation}
                  </p>
                )}
              </section>

              {assigning === shown.code && (
                <AssignOwner
                  finding={shown}
                  onCancel={() => {
                    setAssigning(null)
                    focusSoon(assignButton)
                  }}
                  onDone={(saved) => {
                    setAssigning(null)
                    setFinding(saved)
                    onChanged(saved)
                    focusSoon(nextHeading)
                  }}
                />
              )}

              <div className="flex flex-wrap gap-2">
                <Button asChild className="h-9 hover:bg-primary-hover">
                  <Link href={`/findings/${shown.code}`}>Open finding</Link>
                </Button>
                {canTriage && isOpen(shown) && (
                  <>
                    <Button
                      variant="outline"
                      className="h-9"
                      onClick={() => {
                        toTriage.current = true
                        onTriage(shown)
                      }}
                    >
                      Triage
                    </Button>
                    {assigning !== shown.code && (
                      <Button ref={assignButton} variant="outline" className="h-9" onClick={() => setAssigning(shown.code)}>
                        Assign
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* The dialog has a name from the start, also while it loads or when loading fails */}
            <SheetHeader className="sr-only">
              <SheetTitle>Finding {code}</SheetTitle>
              <SheetDescription>{problem ? "It could not be loaded." : "Loading."}</SheetDescription>
            </SheetHeader>
            {problem ? (
              <div className="flex-1 space-y-3 p-4">
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
                <Button variant="outline" className="h-9" onClick={() => setAttempt((count) => count + 1)}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex-1 space-y-3 p-4" role="status" aria-label="Loading the finding">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-32 w-full" />
              </div>
            )}
          </>
        )}
        {/* At either end of the list the buttons stay focusable and say so, so the keyboard
            isn't thrown out of the panel when the last finding is reached */}
        <nav aria-label="Findings in this list" className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <Button
            variant="outline"
            className="h-9 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={!onPrevious}
            onClick={() => onPrevious?.()}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <span className="tabular text-sm text-muted-foreground">{position}</span>
          <Button
            variant="outline"
            className="h-9 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={!onNext}
            onClick={() => onNext?.()}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
