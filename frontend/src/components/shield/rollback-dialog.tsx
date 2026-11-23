"use client"

import { useEffect, useState } from "react"
import { Loader2, TriangleAlert } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { confirmPassword } from "@/lib/mfa"
import {
  type RollbackConsequences,
  type RollbackResult,
  rollBack,
  rollbackConsequences,
} from "@/lib/shield"

/**
 * UC-8.8 steps 2-4: rolling back to an earlier version, or switching the policy off (2a). The
 * dialog states what will happen before it happens, and asks for the password again (NFR-3.5).
 */
export function RollbackDialog({
  targetId,
  toVersion,
  open,
  onClose,
  onDone,
}: {
  targetId: string
  /** The version to go back to; 0 switches the policy off. */
  toVersion: number
  open: boolean
  onClose: () => void
  onDone: (result: RollbackResult) => void
}) {
  const disabling = toVersion === 0
  const [told, setTold] = useState<RollbackConsequences | null>(null)
  const [failed, setFailed] = useState<string | undefined>()
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [problem, setProblem] = useState<{ field?: string; message: string } | undefined>()
  const [busy, setBusy] = useState(false)

  // The dialog is mounted when it opens (its key is the version), so its fields start empty.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    rollbackConsequences(targetId, toVersion, controller.signal)
      .then(setTold)
      .catch((error) => {
        if (controller.signal.aborted) return
        setFailed(
          error instanceof ApiError
            ? error.message
            : "What this would change could not be worked out. Try again.",
        )
      })
    return () => controller.abort()
  }, [open, targetId, toVersion])

  async function confirm() {
    setBusy(true)
    setProblem(undefined)
    try {
      await confirmPassword(password) // step 3, right before the rollback (NFR-3.5)
      onDone(await rollBack(targetId, toVersion, reason))
    } catch (error) {
      const detail = error instanceof ApiError ? error.details?.[0] : undefined
      setProblem({
        field: detail?.field,
        message:
          detail?.message ??
          (error instanceof ApiError ? error.message : "The rollback could not be carried out."),
      })
    } finally {
      setBusy(false)
    }
  }

  const title = disabling
    ? "Disable Shield Policy?"
    : `Roll back to Shield Policy v${toVersion}?`

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {disabling
              ? "The gateway will forward all traffic unchanged until a policy is deployed again."
              : "The document of that version becomes the target's next version, so the fixes that came after it stop being enforced."}
          </DialogDescription>
        </DialogHeader>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {failed}
          </p>
        )}

        {!told && !failed && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Working out what this would change…
          </p>
        )}

        {told && (
          <>
            <section aria-labelledby="consequences" className="rounded-[10px] border bg-muted/20 p-4">
              <h3 id="consequences" className="text-sm font-semibold">
                What happens
              </h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-text-secondary">
                <li>
                  Version {told.from_version} leaves the traffic: {told.rules_removed} of its{" "}
                  {told.rules_now} rules stop being enforced, and {told.rules_after}{" "}
                  {told.rules_after === 1 ? "rule stays" : "rules stay"} in place.
                </li>
                {told.remediations_stopping.length > 0 ? (
                  told.remediations_stopping.map((one) => (
                    <li key={`${one.finding}-${one.version}`}>
                      The fixes of {one.finding} (proposal version {one.version}) stop being
                      enforced, and the proposal goes back to Approved, so it can be deployed
                      again.
                    </li>
                  ))
                ) : (
                  <li>No approved remediation loses a rule by this.</li>
                )}
                <li>
                  {told.findings_reopening.length === 0
                    ? "Findings verified with this version that will reopen: none."
                    : `These findings reopen, because only this version had proved them fixed: ${told.findings_reopening.join(", ")}.`}
                </li>
                <li>
                  {told.gateway_reachable
                    ? `The gateway takes the change at its next report, within ${told.window_seconds} seconds.`
                    : "The gateway isn't reporting, so Sentra keeps the version that is really in the traffic active and the gateway applies the change as soon as it reconnects."}
                </li>
                <li>The developers and Security Analysts of your organization are notified.</li>
                <li>The rollback is in the audit log with your name, your reason and both versions.</li>
              </ul>
            </section>

            <div className="mt-4 space-y-4">
              <FormField
                id="reason"
                label="Reason"
                error={problem?.field === "reason" ? problem.message : undefined}
                announce
              >
                <Textarea
                  id="reason"
                  rows={3}
                  value={reason}
                  placeholder="For example: the output guardrail blocked legitimate refund-status questions."
                  aria-describedby="reason-help"
                  onChange={(event) => setReason(event.target.value)}
                />
              </FormField>
              <p id="reason-help" className="-mt-2 text-xs text-muted-foreground">
                It stays with the version, so the next person reads it before they deploy again.
              </p>
              <FormField
                id="confirm-password"
                label="Confirm with your password"
                error={problem && problem.field !== "reason" ? problem.message : undefined}
                announce
              >
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </FormField>
            </div>
          </>
        )}

        {!busy && told && (reason.trim().length === 0 || password.length === 0) && (
          <p id="rollback-needs" className="mt-4 text-[13px] text-muted-foreground">
            Write why, and enter your password, to confirm.
          </p>
        )}
        <DialogFooter className="mt-6">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !told || reason.trim().length === 0 || password.length === 0}
            aria-describedby={
              told && (reason.trim().length === 0 || password.length === 0) ? "rollback-needs" : undefined
            }
            onClick={confirm}
          >
            <TriangleAlert aria-hidden="true" />
            {busy
              ? disabling
                ? "Disabling…"
                : "Rolling back…"
              : disabling
                ? "Disable now"
                : "Roll back now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
