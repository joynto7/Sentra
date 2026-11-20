"use client"

import { useState } from "react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
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
import { Textarea } from "@/components/ui/textarea"
import { ApiError, fieldErrors } from "@/lib/api"
import { type TestDetail, retireTest } from "@/lib/test-library"

/** UC-4.3, alternative 3a: retire a custom test, with the reason, after showing what happens. */
export function RetireDialog({
  test,
  open,
  onOpenChange,
  onRetired,
}: {
  test: TestDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetired: (test: TestDetail) => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setError("Describe the reason for the change.")
      return
    }
    setPending(true)
    try {
      const retired = await retireTest(test.code, reason.trim())
      toast.success(`${test.code} retired`, { description: "It's no longer in the catalogue or in future campaign runs." })
      onRetired(retired)
      onOpenChange(false)
    } catch (err) {
      setError(fieldErrors(err).reason ?? (err instanceof ApiError ? err.message : "Something went wrong. Try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Retire {test.name}?</DialogTitle>
            <DialogDescription>
              Retiring saves version {test.version + 1}, which marks the test as retired.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
            <li>The test leaves the catalogue, and future campaign runs skip it.</li>
            <li>Past campaign runs keep showing it, with the version they used.</li>
            <li>A retired test can&apos;t be changed. To use it again, duplicate it as a new custom test.</li>
          </ul>
          <FormField id="retire-reason" label="Reason" error={error ?? undefined}>
            <Textarea
              id="retire-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Replaced by a broader test"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "retire-reason-error" : undefined}
            />
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" className="h-9" disabled={pending}>
              {pending ? "Retiring…" : "Retire test"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
