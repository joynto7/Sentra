"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  type ArchiveConsequences,
  type Target,
  archiveTarget,
  formatDateTime,
  getArchiveConsequences,
  restoreTarget,
} from "@/lib/targets"

/** UC-2.6 step 2: everything archiving does, in the order of Screen 24. */
function Consequences({ shown }: { shown: ArchiveConsequences }) {
  const items: string[] = []
  if (shown.schedules.length) {
    const one = shown.schedules.length === 1
    items.push(
      `${shown.schedules.length} scheduled campaign${one ? " is" : "s are"} cancelled: ` +
        shown.schedules
          .map(
            (schedule) =>
              `${schedule.campaign} ${schedule.name}` +
              (schedule.next_run_at ? ` (next run ${formatDateTime(schedule.next_run_at)})` : "") +
              (schedule.created_by ? `. ${schedule.created_by}, who scheduled it, is informed` : ""),
          )
          .join("; ") +
        ".",
    )
  }
  if (shown.credentials.length) {
    items.push(`Stored credentials are deleted: ${shown.credentials.join(", ")}.`)
  }
  items.push(
    `History, findings and reports stay available until their retention period ends` +
      ` (${shown.runs_kept} campaign run${shown.runs_kept === 1 ? "" : "s"}, ` +
      `${shown.findings_kept} finding${shown.findings_kept === 1 ? "" : "s"}).`,
  )
  items.push("You can restore the target later. It returns as Unverified and needs new credentials.")
  return (
    <>
      <p className="text-[13px] font-medium">What happens</p>
      <ol className="mt-1 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </>
  )
}

/**
 * Screen 24: archiving a target, with every consequence stated before it is confirmed (UC-2.6).
 * A campaign run that is still going on blocks it (2a1), and the password confirms it (step 3).
 */
export function ArchiveDialog({
  target,
  open,
  onOpenChange,
  onDone,
}: {
  target: Target
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (target: Target) => void
}) {
  const [shown, setShown] = useState<ArchiveConsequences | null>(null)
  const [password, setPassword] = useState("")
  const [problem, setProblem] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    getArchiveConsequences(target.id, controller.signal)
      .then(setShown)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setProblem(error.message)
      })
    return () => controller.abort()
  }, [open, target.id])

  /** Closing forgets what was typed and what was shown, so it opens fresh next time. */
  const change = (next: boolean) => {
    if (!next) {
      setShown(null)
      setPassword("")
      setProblem("")
    }
    onOpenChange(next)
  }

  const archive = async () => {
    setBusy(true)
    setProblem("")
    try {
      const archived = await archiveTarget(target.id, password)
      toast.success(`${target.name} is archived.`)
      onDone(archived)
      change(false)
    } catch (error) {
      const named = fieldErrors(error).password
      setProblem(named || (error instanceof ApiError ? error.message : String(error)))
    } finally {
      setBusy(false)
    }
  }

  const running = shown?.running ?? ""
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Archive {target.name}?</DialogTitle>
          <DialogDescription>
            An archived target is no longer tested. Everything it found is kept.
          </DialogDescription>
        </DialogHeader>

        {!shown ? (
          <Skeleton className="h-28 w-full" />
        ) : running ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col items-start gap-2">
              {running}
              {target.active_run?.campaign && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/campaigns/${target.active_run.campaign}/runs/${target.active_run.number}`}>
                    Open live monitor
                  </Link>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Consequences shown={shown} />
            <div className="mt-1">
              <Label htmlFor="archive-password">Confirm with your password</Label>
              <Input
                id="archive-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? "archive-problem" : undefined}
                className="mt-1.5"
              />
              {problem && (
                <p id="archive-problem" role="alert" className="mt-1.5 text-[13px] text-destructive">
                  {problem}
                </p>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={archive} disabled={busy || !!running || !password.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Archive target
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** UC-2.6, 1a1: an archived target comes back unverified and without credentials. */
export function RestoreButton({
  target,
  onDone,
  className,
}: {
  target: Target
  onDone: (target: Target) => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const restore = async () => {
    setBusy(true)
    try {
      const restored = await restoreTarget(target.id)
      toast.success(`${target.name} is restored. Add credentials and verify its ownership again.`)
      onDone(restored)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={restore} disabled={busy} className={className}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      Restore target
    </Button>
  )
}
