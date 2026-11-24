"use client"

import { useState } from "react"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import {
  type RemediationPage,
  type RemediationVersion,
  approveRemediation,
  rejectRemediation,
  submitRemediation,
} from "@/lib/remediation"
import { formatDateTime } from "@/lib/targets"

/**
 * The approval of a proposal (UC-8.3 steps 4-6) beside its fixes: who may approve it, what an
 * approval starts, and the decision itself. Nothing a proposal recommends takes effect before a
 * person approves it (NFR-9.3), and the person who adapted a version may not approve it (4a).
 */
export function ApprovalPanel({
  code,
  page,
  current,
  onEdit,
  onDone,
}: {
  code: string
  page: RemediationPage
  current: RemediationVersion
  /** Opens the editor of UC-8.3 step 2; absent while it is already open. */
  onEdit?: () => void
  onDone: () => void
}) {
  const { review } = page
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState<string | undefined>()
  const newest = current.version === page.versions[0]?.version
  const waiting = current.status === "awaiting_approval"

  async function act(what: string, run: () => Promise<unknown>, done: string) {
    setBusy(what)
    setProblem(undefined)
    try {
      await run()
      toast.success(done)
      onDone()
    } catch (failed) {
      const text =
        failed instanceof ApiError ? failed.message : "That didn't work. Try again in a moment."
      if (what === "reject") setProblem(text)
      else toast.error(text)
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside
      aria-labelledby="approval"
      className="rounded-[10px] border bg-card p-4 lg:sticky lg:top-4"
    >
      <h2 id="approval" className="text-[15px] font-semibold">
        Approval
      </h2>

      {current.status === "approved" && (
        <p className="mt-2 rounded-[7px] border border-success/40 bg-success/5 p-3 text-[13px] text-success">
          Approved by {current.decided_by ?? "a reviewer"}
          {current.decided_at && ` on ${formatDateTime(current.decided_at)}`}.
        </p>
      )}
      {current.status === "rejected" && (
        <div className="mt-2 rounded-[7px] border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
          <p className="text-destructive">
            Rejected by {current.decided_by ?? "a reviewer"}
            {current.decided_at && ` on ${formatDateTime(current.decided_at)}`}.
          </p>
          {current.decision_reason && <p className="mt-1">“{current.decision_reason}”</p>}
          <p className="mt-2 text-muted-foreground">
            The version stays as it is. Adapt the proposal again, or ask Sentra for a revision.
          </p>
        </div>
      )}

      {!newest ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          This is an earlier version, kept as it was. Open version {page.versions[0]?.version} to
          work on the proposal.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-text-secondary">
            Approvers: Security Analysts and Security Managers, except the person who last adapted
            this proposal.
          </p>
          {review.approvers.length > 0 && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              In this organization: {review.approvers.join(", ")}.
            </p>
          )}

          {review.on_approval.length > 0 && current.status !== "approved" && (
            <>
              <h3 className="mt-3 text-[13px] font-medium text-muted-foreground">On approval</h3>
              <ul className="mt-1 space-y-1 text-[13px]">
                {review.on_approval.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}

          {waiting && review.can_approve && (
            <section aria-label="What you are approving" className="mt-3 rounded-[7px] border bg-muted/30 p-3 text-[13px]">
              <h3 className="font-medium">You are approving version {current.version}</h3>
              <ul className="mt-1 space-y-1 text-text-secondary">
                {current.fixes.map((fix) => (
                  <li key={fix.position}>
                    {fix.title} <span className="text-muted-foreground">· {fix.kind_label} · takes effect {fix.enforcement === "gateway" ? "at the gateway, through a Shield policy" : "inside the application, by its developers"}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">Expected, not proven until the retest. Approving applies nothing.</p>
            </section>
          )}

          {waiting && !review.can_approve && review.cannot_approve && (
            <p className="mt-3 rounded-[7px] border bg-muted/40 p-3 text-[13px]">
              {review.cannot_approve}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {review.can_approve && (
              <>
                <Button
                  className="h-9 hover:bg-primary-hover"
                  disabled={busy !== null}
                  onClick={() =>
                    act(
                      "approve",
                      () => approveRemediation(code, current.version),
                      "The remediation is approved.",
                    )
                  }
                >
                  {busy === "approve" ? "Approving…" : `Approve version ${current.version}`}
                </Button>
                <Button variant="outline" className="h-9" onClick={() => setRejecting(true)}>
                  Reject…
                </Button>
              </>
            )}
            {review.can_submit && (
              <Button
                className="h-9 hover:bg-primary-hover"
                disabled={busy !== null}
                onClick={() =>
                  act(
                    "submit",
                    () => submitRemediation(code, current.version),
                    "The proposal is with the approvers.",
                  )
                }
              >
                {busy === "submit" ? "Sending…" : "Request approval"}
              </Button>
            )}
            {review.can_edit && onEdit && (
              <Button variant="outline" className="h-9" onClick={onEdit}>
                Adapt the proposal
              </Button>
            )}
          </div>

          {waiting && (
            <p className="mt-3 text-xs text-muted-foreground">
              Waiting for approval. Nothing this proposal recommends takes effect until a person
              approves it.
            </p>
          )}
        </>
      )}

      <Dialog
        open={rejecting}
        onOpenChange={(open) => {
          if (open) return
          setRejecting(false)
          setReason("")
          setProblem(undefined)
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Reject this proposal?</DialogTitle>
            <DialogDescription>
              The rejected version is kept with your reason. The developer can adapt it or ask
              Sentra for a new proposal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Why are you rejecting it?</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              rows={4}
              maxLength={1000}
              placeholder="For example: the guardrail would block our refund questions."
              onChange={(event) => setReason(event.target.value)}
            />
            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="h-9"
              disabled={busy !== null}
              onClick={async () => {
                if (!reason.trim()) return setProblem("Say why you are rejecting the proposal.")
                await act(
                  "reject",
                  () => rejectRemediation(code, current.version, reason.trim()),
                  "The proposal is rejected.",
                )
                setRejecting(false)
                setReason("")
              }}
            >
              {busy === "reject" ? "Rejecting…" : "Reject proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
