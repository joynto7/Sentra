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
import type { CampaignItem } from "@/lib/campaigns"
import { type SuiteDetail, archiveSuite } from "@/lib/test-library"

/** UC-4.5, alternative 3a: archive a suite, with the reason, after showing what happens. */
export function ArchiveSuiteDialog({
  suite,
  campaigns,
  open,
  onOpenChange,
  onArchived,
}: {
  suite: SuiteDetail
  campaigns: CampaignItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onArchived: (suite: SuiteDetail) => void
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
      const archived = await archiveSuite(suite.code, reason.trim())
      toast.success(`${suite.name} archived`, { description: "It's no longer offered for campaigns." })
      onArchived(archived)
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
            <DialogTitle>Archive {suite.name}?</DialogTitle>
            <DialogDescription>Archiving saves version {suite.version + 1}, which marks the suite as archived.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
            <li>The suite leaves the list and can&apos;t be chosen for new campaigns.</li>
            <li>Past campaign runs keep showing it, with the version they used.</li>
            <li>An archived suite can&apos;t be changed. To use it again, duplicate it.</li>
          </ul>
          {campaigns.length > 0 && (
            <p className="rounded-[10px] border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              Used by {campaigns.length === 1 ? "1 campaign" : `${campaigns.length} campaigns`}:{" "}
              {campaigns.map((c) => `${c.code} ${c.name}`).join(", ")}. Replace the suite in them before their next run.
            </p>
          )}
          <FormField id="archive-reason" label="Reason" error={error ?? undefined}>
            <Textarea
              id="archive-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Replaced by the release suite"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "archive-reason-error" : undefined}
            />
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" className="h-9" disabled={pending}>
              {pending ? "Archiving…" : "Archive suite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
