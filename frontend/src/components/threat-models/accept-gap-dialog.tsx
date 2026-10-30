"use client"

import { useState } from "react"

import { REASON_MAX, ReasonField } from "@/components/admin/reason-field"
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
import type { ThreatGap } from "@/lib/threat-models"

/** UC-3.3, 3a1: a threat that no test covers stays listed until a test covers it or someone
 * records why it is accepted. The reason belongs to the threat's number, so it stays valid in
 * later versions (quality requirement 3). */
export function AcceptGapDialog({
  gap,
  busy,
  onClose,
  onAccept,
}: {
  gap: ThreatGap | null
  busy: boolean
  onClose: () => void
  onAccept: (threat: number, reason: string) => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | undefined>()

  function close(open: boolean) {
    if (open) return
    setReason("")
    setError(undefined)
    onClose()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!gap) return
    const text = reason.trim()
    if (text.length < 5) return setError("Give a reason for accepting the gap.")
    if (text.length > REASON_MAX) return setError(`Use at most ${REASON_MAX} characters.`)
    onAccept(gap.number, text)
  }

  return (
    <Dialog open={gap !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Accept this gap?</DialogTitle>
            <DialogDescription>{gap?.title}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-text-secondary">
              {gap?.out_of_scope
                ? "No test of the library can cover this threat, because its category lies outside application testing."
                : "No test covers this threat yet."}{" "}
              The threat stays in the list with your reason until a test covers it.
            </p>
            <ReasonField
              id="accept-gap-reason"
              value={reason}
              onChange={(value) => {
                setReason(value)
                setError(undefined)
              }}
              error={error}
              placeholder="Why it is accepted for now, e.g. the e-mail channel is switched off until January"
            />
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="hover:bg-primary-hover" disabled={busy}>
              {busy ? "Saving…" : "Accept gap"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
