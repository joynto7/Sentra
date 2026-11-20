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
import type { AttackPath } from "@/lib/risk"

/**
 * UC-7.5, 6a1: an analyst who considers a path implausible hides it with a reason. The path, the
 * reason and the person are kept, the path disappears from this view and from the reports, and a
 * new finding on the way brings it back.
 */
export function DismissPathDialog({
  path,
  busy,
  onClose,
  onDismiss,
}: {
  path: AttackPath | null
  busy: boolean
  onClose: () => void
  onDismiss: (key: string, reason: string) => void
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
    if (!path) return
    const text = reason.trim()
    if (text.length < 5) return setError("Give a reason for dismissing this path.")
    if (text.length > REASON_MAX) return setError(`Use at most ${REASON_MAX} characters.`)
    onDismiss(path.key, text)
  }

  return (
    <Dialog open={path !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Dismiss {path?.code}?</DialogTitle>
            <DialogDescription>{path?.description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-text-secondary">
              The path disappears from this view and from the reports. Its findings stay as they are, and
              if a new finding appears on the way, the path is shown again.
            </p>
            <ReasonField
              id="dismiss-path-reason"
              value={reason}
              onChange={(value) => {
                setReason(value)
                setError(undefined)
              }}
              error={error}
              placeholder="Why it can't happen, e.g. the refund tool asks for a second approval in production"
            />
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="hover:bg-primary-hover" disabled={busy}>
              {busy ? "Saving…" : "Dismiss path"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
