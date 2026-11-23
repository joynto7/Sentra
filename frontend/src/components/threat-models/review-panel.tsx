"use client"

import { useState } from "react"
import { CircleCheck, Info } from "lucide-react"

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
import { longDate } from "@/lib/threat-models"

export type ReviewCounts = { threats: number; edited: number; removed: number; added: number; restored: number }

/** The right panel of Screen 26 (UC-3.2 steps 4-6): what changed, "Save draft" and "Approve". */
export function ReviewPanel({
  counts,
  version,
  nextVersion,
  status,
  approvedBy,
  approvedAt,
  editable,
  busy,
  onSave,
  onApprove,
}: {
  counts: ReviewCounts
  version: number
  nextVersion: number
  status: "draft" | "approved"
  approvedBy: string | null
  approvedAt: string | null
  editable: boolean
  busy: "save" | "approve" | null
  onSave: () => void
  onApprove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const changes = counts.edited + counts.removed + counts.added + counts.restored
  // With unsaved changes, approving saves them as the next version first (UC-3.2 steps 4-5).
  const approving = changes ? nextVersion : version
  const canApprove = editable && (changes > 0 || status === "draft")
  const rows: [string, number][] = [
    ["Threats", counts.threats],
    ["Edited by you", counts.edited],
    ["Removed with a reason", counts.removed],
    ...(counts.added ? ([["Added by you", counts.added]] as [string, number][]) : []),
    ...(counts.restored ? ([["Restored by you", counts.restored]] as [string, number][]) : []),
  ]

  return (
    <section aria-labelledby="review-heading" className="rounded-[10px] border bg-card p-5">
      <h2 id="review-heading" className="text-[15px] font-semibold">
        Review
      </h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="tabular font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {changes > 0 && (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Saving creates v{nextVersion} with your changes; v{version} stays unchanged.
        </p>
      )}
      {status === "approved" && changes === 0 && (
        <p className="mt-4 flex items-start gap-2 text-sm text-success">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Approved{approvedBy ? ` by ${approvedBy}` : ""}
            {approvedAt ? ` on ${longDate(approvedAt)}` : ""}.
          </span>
        </p>
      )}
      {editable && (
        <>
          <div className="mt-4 flex gap-2 rounded-md bg-muted p-3 text-sm text-text-secondary">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Approving records your name. Every campaign records the threat model version it used.</p>
          </div>
          <div className="mt-4 grid gap-2">
            {canApprove && (
              <Button className="hover:bg-primary-hover" onClick={() => setConfirming(true)} disabled={busy !== null}>
                <CircleCheck aria-hidden="true" />
                {busy === "approve" ? "Approving…" : `Approve v${approving}`}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={onSave}
              disabled={changes === 0 || busy !== null}
              aria-describedby={changes === 0 ? "save-draft-hint" : undefined}
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </Button>
            {changes === 0 && (
              <p id="save-draft-hint" className="text-xs text-muted-foreground">
                Change a threat first; then the draft can be saved.
              </p>
            )}
          </div>
        </>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve version {approving}?</DialogTitle>
            <DialogDescription>
              {changes > 0
                ? `Your changes are saved as version ${approving} first. `
                : ""}
              Your name and the time are recorded in the audit log. Campaigns created from now on are based on
              version {approving}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              className="hover:bg-primary-hover"
              onClick={() => {
                setConfirming(false)
                onApprove()
              }}
            >
              Approve v{approving}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
