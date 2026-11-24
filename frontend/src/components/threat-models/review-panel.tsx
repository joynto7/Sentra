"use client"

import { useState } from "react"
import { CircleCheck, FilePen, Loader2, Lock } from "lucide-react"

import { GLASS_SURFACE } from "@/components/sentra/glass-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { longDate } from "@/lib/threat-models"
import { cn } from "@/lib/utils"

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
    <section aria-labelledby="review-heading" className={cn("rounded-2xl border p-5", GLASS_SURFACE)}>
      <style>{`@keyframes rv-pop { 0% { transform: scale(1) } 40% { transform: scale(1.18) } 100% { transform: scale(1) } } @keyframes rv-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } } @media (prefers-reduced-motion: reduce) { .rv * { animation: none !important } }`}</style>
      <div className="rv flex items-start justify-between gap-3">
        <h2 id="review-heading" className="text-[15px] font-semibold">
          Review
        </h2>
        {status === "approved" ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-success/40 bg-white px-2.5 text-xs font-medium text-success dark:bg-white/10">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            Approved
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed border-warning/60 bg-white px-2.5 text-xs font-medium text-warning dark:bg-white/10">
            <FilePen className="size-3.5" aria-hidden="true" />
            Draft v{version}
          </span>
        )}
      </div>

      {/* What the review holds: a tile for each count; one that is not zero is lit, and pops when it changes */}
      <dl className="rv mt-4 grid grid-cols-3 gap-2 text-center">
        {rows.map(([label, value], index) => (
          <div
            key={label}
            className={cn(
              "rounded-xl border px-2 py-2.5 transition-colors",
              index === 0
                ? "border-[#e1e7fb] bg-white dark:border-transparent dark:bg-white/10"
                : value > 0
                  ? "border-primary/40 bg-primary/10"
                  : "border-[#e1e7fb] bg-white/60 dark:border-transparent dark:bg-white/5",
            )}
          >
            <dd
              key={value}
              className="tabular text-2xl leading-7 font-semibold"
              style={{ animation: index === 0 ? undefined : "rv-pop .4s ease-out" }}
            >
              {value}
            </dd>
            <dt className="mt-0.5 text-[11px] leading-tight text-text-secondary">{label}</dt>
          </div>
        ))}
      </dl>

      {changes > 0 && (
        <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm text-text-secondary dark:bg-white/5" aria-live="polite">
          <span className="font-medium text-foreground">Unsaved:</span> saving creates v{nextVersion} with your changes; v{version} stays
          unchanged.
        </p>
      )}
      {status === "approved" && changes === 0 && (
        <p className="rv mt-4 flex items-start gap-2.5 text-sm text-success">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-success text-white">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray={1} style={{ animation: "rv-draw .5s ease-out both" }} />
            </svg>
          </span>
          <span className="pt-0.5">
            Approved{approvedBy ? ` by ${approvedBy}` : ""}
            {approvedAt ? ` on ${longDate(approvedAt)}` : ""}.
          </span>
        </p>
      )}
      {editable && (
        <>
          <p className="mt-4 flex items-start gap-2 text-xs text-text-secondary">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Approving records your name. Every campaign records the threat model version it used.
          </p>
          <div className="mt-4 grid gap-2">
            {canApprove && (
              <Button
                className="h-11 rounded-full text-[15px] hover:bg-primary-hover"
                onClick={() => setConfirming(true)}
                disabled={busy !== null}
              >
                {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                {busy === "approve" ? "Approving…" : `Approve v${approving}`}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-10 rounded-full bg-white/70 dark:bg-white/5"
              onClick={onSave}
              disabled={changes === 0 || busy !== null}
              aria-describedby={changes === 0 ? "save-draft-hint" : undefined}
            >
              {busy === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {busy === "save" ? "Saving…" : "Save draft"}
            </Button>
            {changes === 0 && (
              <p id="save-draft-hint" className="text-center text-xs text-muted-foreground">
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
              {changes > 0 ? `Your changes are saved as version ${approving} first. ` : ""}
              Your name and the time are recorded in the audit log. Campaigns created from now on are based on version {approving}.
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
