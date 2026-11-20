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

/** UC-3.2 step 3: a threat that doesn't apply is removed with a reason. It stays in the list,
 * struck through, and in the history (quality requirement 3). */
export function RemoveThreatDialog({
  threat,
  onClose,
  onRemove,
}: {
  threat: { number: number; title: string } | null
  onClose: () => void
  onRemove: (number: number, reason: string) => void
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
    if (!threat) return
    const text = reason.trim()
    if (text.length < 5) return setError("Give a reason for removing it.")
    if (text.length > REASON_MAX) return setError(`Use at most ${REASON_MAX} characters.`)
    onRemove(threat.number, text)
    close(false)
  }

  return (
    <Dialog open={threat !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Remove this threat?</DialogTitle>
            <DialogDescription>{threat?.title}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-text-secondary">
              It stays in the list with your reason, and in every later version, until someone restores it.
            </p>
            <ReasonField
              id="remove-reason"
              value={reason}
              onChange={(value) => {
                setReason(value)
                setError(undefined)
              }}
              error={error}
              placeholder="Why it doesn't apply to this target"
            />
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive">
              Remove threat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
