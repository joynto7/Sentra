"use client"

import { onlyJudgeSupports } from "@/components/findings/judge-only"
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { SeverityBadge, SEVERITY_LABEL, type Severity } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  DECISION_LABEL,
  type Decision,
  type FindingDetail,
  type TriageOptions,
  getTriageOptions,
  saveTriage,
} from "@/lib/findings"
import { cn } from "@/lib/utils"

import { type TriageDraft, triagePreview } from "./triage-preview"

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"]
const KEPT = "False positives are kept, so that the quality of Sentra's detection can be measured."

type Draft = TriageDraft

/**
 * Screen 41: triaging a finding. One save carries the decision, the severity, the owner
 * and the comment; each field appears only for the decision that needs it, and the footer says
 * what saving will do — the history, the audit log, the owner's notification and the risk score.
 */
export function TriagePanel({
  finding,
  open,
  onOpenChange,
  onDone,
  returnFocus,
}: {
  finding: FindingDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (finding: FindingDetail) => void
  /** Where the keyboard goes back to when the panel closes, when it wasn't opened by a trigger */
  returnFocus?: () => HTMLElement | null
}) {
  const [options, setOptions] = useState<TriageOptions | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    getTriageOptions(finding.code, controller.signal)
      .then((found) => {
        setOptions(found)
        setDraft({
          // Nothing is decided for the person: a finding that only the LLM judge supports is not
          // confirmed by a default, and a comment or an owner change is not a decision.
          decision: "",
          reason: "",
          mergeInto: found.duplicates[0]?.code ?? "",
          severity: found.severity,
          justification: "",
          ownerId: found.owner?.id ?? found.suggested_owner?.id ?? "",
          comment: "",
        })
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setProblem(error.message)
      })
    return () => controller.abort()
  }, [open, finding.code])

  const close = (next: boolean) => {
    if (!next) {
      setOptions(null)
      setDraft(null)
      setErrors({})
      setProblem("")
    }
    onOpenChange(next)
  }

  const set = (changes: Partial<Draft>) => setDraft((old) => (old ? { ...old, ...changes } : old))

  const preview = draft && options ? triagePreview(finding.code, options, draft) : null

  const save = async () => {
    if (!draft || !options || !preview) return
    // What is missing is said at its field, nothing is sent, and nothing is recorded.
    const local: Record<string, string> = {}
    if (preview.missing.reason) local.reason = preview.missing.reason
    if (preview.missing.mergeInto) local.merge_into = preview.missing.mergeInto
    if (preview.missing.justification) local.justification = preview.missing.justification
    if (preview.missing.decision) local.decision = preview.missing.decision
    if (Object.keys(local).length) {
      setErrors(local)
      setProblem("")
      return
    }
    setBusy(true)
    setErrors({})
    setProblem("")
    try {
      const saved = await saveTriage(finding.code, {
        decision: draft.decision || null,
        reason: draft.reason,
        merge_into: draft.mergeInto,
        severity: draft.severity === options.severity ? null : (draft.severity as Severity),
        justification: draft.justification,
        owner_id: draft.ownerId || null,
        comment: draft.comment,
      })
      toast.success(`${finding.code} triaged`, {
        description: "The decision is in the finding's history and in the audit log.",
      })
      onDone(saved)
      close(false)
    } catch (error) {
      const named = fieldErrors(error)
      if (Object.keys(named).length) setErrors(named)
      else if (error instanceof ApiError && error.code === "finding_closed") {
        // Someone else triaged it while this panel was open: nothing was saved; show the real state.
        setProblem(`${error.message} Nothing you entered was saved.`)
        getTriageOptions(finding.code).then(setOptions).catch(() => undefined)
      } else setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const changedSeverity = draft && options && draft.severity !== options.severity
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-[480px]"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.()
          if (target) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
        <SheetHeader className="border-b">
          <SheetTitle>Triage {finding.code}</SheetTitle>
          <SheetDescription>{finding.title}</SheetDescription>
        </SheetHeader>

        {!options || !draft ? (
          <div className="space-y-3 p-4">
            {problem ? (
              <Alert variant="destructive">
                <AlertDescription>{problem}</AlertDescription>
              </Alert>
            ) : (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-32 w-full" />
              </>
            )}
          </div>
        ) : !options.open ? (
          <div className="p-4">
            <Alert>
              <AlertDescription>
                {finding.code} is closed ({finding.status.replace(/_/g, " ")}), so it can&apos;t be triaged. Its
                history keeps every decision that was made.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-4">
            {options.requires_confirmation && (
              <p
                role="status"
                className="rounded-[7px] border border-confirm/40 bg-confirm/5 p-3 text-[13px] text-confirm"
              >
                {onlyJudgeSupports(finding.detection)
                  ? "Only the LLM judge supports this finding. "
                  : "This finding is waiting for confirmation. "}
                It counts towards the target&apos;s risk score after you confirm it.
              </p>
            )}

            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium">Decision (optional)</legend>
              <RadioGroup
                value={draft.decision}
                onValueChange={(value) => set({ decision: value as Decision })}
                className="gap-2"
              >
                {(Object.keys(DECISION_LABEL) as Decision[]).map((decision) => (
                  <div
                    key={decision}
                    className={cn(
                      "flex items-start gap-3 rounded-[7px] border p-3",
                      draft.decision === decision && "border-primary bg-primary/5",
                    )}
                  >
                    <RadioGroupItem value={decision} id={`decision-${decision}`} className="mt-0.5" />
                    <Label htmlFor={`decision-${decision}`} className="font-medium">
                      {DECISION_LABEL[decision]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              {errors.decision && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.decision}
                </p>
              )}

              {draft.decision === "false_positive" && (
                <div>
                  <Label htmlFor="triage-reason">Reason</Label>
                  <Textarea
                    id="triage-reason"
                    value={draft.reason}
                    onChange={(event) => set({ reason: event.target.value })}
                    aria-invalid={errors.reason ? true : undefined}
                    aria-describedby={errors.reason ? "triage-reason-error" : "triage-reason-help"}
                    className="mt-1.5"
                    rows={3}
                  />
                  {errors.reason ? (
                    <p id="triage-reason-error" role="alert" className="mt-1.5 text-[13px] text-destructive">
                      {errors.reason}
                    </p>
                  ) : (
                    <p id="triage-reason-help" className="mt-1.5 text-xs text-muted-foreground">
                      {KEPT}
                    </p>
                  )}
                </div>
              )}

              {draft.decision === "merge" && (
                <div>
                  <Label htmlFor="triage-merge">The finding this one duplicates</Label>
                  {options.duplicates.length === 0 ? (
                    <p className="mt-1.5 text-[13px] text-muted-foreground">No other open finding to merge into.</p>
                  ) : (
                    <Select value={draft.mergeInto} onValueChange={(value) => set({ mergeInto: value })}>
                      <SelectTrigger id="triage-merge" className="mt-1.5 h-9 w-full">
                        <SelectValue placeholder="Choose a finding" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.duplicates.map((duplicate) => (
                          <SelectItem key={duplicate.code} value={duplicate.code}>
                            {duplicate.code} · {SEVERITY_LABEL[duplicate.severity]} · {duplicate.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {errors.merge_into && (
                    <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                      {errors.merge_into}
                    </p>
                  )}
                </div>
              )}
            </fieldset>

            <div>
              <Label htmlFor="triage-severity">Severity</Label>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                Calculated:
                {options.calculated_severity ? (
                  <SeverityBadge severity={options.calculated_severity} />
                ) : (
                  "not rated yet"
                )}
                {options.severity_provisional && "· provisional, fewer repetitions than configured"}
              </p>
              <Select value={draft.severity} onValueChange={(value) => set({ severity: value as Severity })}>
                <SelectTrigger id="triage-severity" className="mt-1.5 h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {SEVERITY_LABEL[severity]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {changedSeverity && (
                <div className="mt-2">
                  <Label htmlFor="triage-justification">Justification</Label>
                  <Textarea
                    id="triage-justification"
                    value={draft.justification}
                    onChange={(event) => set({ justification: event.target.value })}
                    aria-invalid={errors.justification ? true : undefined}
                    aria-describedby={errors.justification ? "triage-justification-error" : undefined}
                    className="mt-1.5"
                    rows={2}
                  />
                  {errors.justification && (
                    <p
                      id="triage-justification-error"
                      role="alert"
                      className="mt-1.5 text-[13px] text-destructive"
                    >
                      {errors.justification}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-muted-foreground">A severity you set is never overwritten.</p>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="triage-owner">Owner</Label>
              <Select value={draft.ownerId} onValueChange={(value) => set({ ownerId: value })}>
                <SelectTrigger id="triage-owner" className="mt-1.5 h-9 w-full">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {options.members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                      {member.id === options.suggested_owner?.id
                        ? ` — ${options.suggested_owner.reason} (suggested)`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.owner_id && (
                <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                  {errors.owner_id}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="triage-comment">Comment</Label>
              <Textarea
                id="triage-comment"
                value={draft.comment}
                onChange={(event) => set({ comment: event.target.value })}
                className="mt-1.5"
                rows={3}
              />
            </div>

            {preview && (
              <section
                aria-label="What saving will do"
                aria-live="polite"
                className="rounded-[7px] border bg-muted/40 p-3 text-[13px]"
              >
                <h3 className="text-[13px] font-medium">What saving will do</h3>
                {preview.effects.length === 0 ? (
                  <p className="mt-1 text-muted-foreground">Nothing yet. Nothing is recorded until you press Save triage.</p>
                ) : (
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-text-secondary">
                    {preview.effects.map((effect) => (
                      <li key={effect}>{effect}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {problem && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{problem}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <SheetFooter className="sticky bottom-0 border-t bg-background">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            {options?.open && (
              <Button onClick={save} disabled={busy || !draft}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Save triage
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
