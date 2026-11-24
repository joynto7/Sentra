"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { RemediationTabs } from "@/components/remediation/remediation-tabs"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, fieldErrors } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type ApplicationChange,
  type ChangeList,
  listOpenChanges,
  markImplemented,
} from "@/lib/remediation"
import { formatDate } from "@/lib/targets"

const MAX_NOTE = 2000

/**
 * UC-8.5 steps 3-4: the developer says what they changed and, if there is one, where it can be
 * seen. The description is required, because the retest result is read together with it, and the
 * form says what happens next: marking the last open fix of a proposal starts the retest (2b1).
 */
function ImplementedForm({
  change,
  onDone,
}: {
  change: ApplicationChange
  onDone: () => void
}) {
  const [note, setNote] = useState("")
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setBusy(true)
      setErrors({})
      try {
        const saved = await markImplemented(change.finding.code, change.id, {
          note,
          link: link.trim() || null,
        })
        toast.success(
          saved.progress.includes("the retest can start")
            ? "Marked as implemented. Sentra is retesting the finding."
            : "Marked as implemented.",
        )
        onDone()
      } catch (problem) {
        const found = fieldErrors(problem)
        setErrors(found)
        if (Object.keys(found).length === 0) {
          toast.error(
            problem instanceof ApiError
              ? problem.message
              : "The change could not be marked as implemented.",
          )
        }
      } finally {
        setBusy(false)
      }
    },
    [change.finding.code, change.id, link, note, onDone],
  )

  return (
    <form onSubmit={save} className="mt-4 space-y-3 border-t pt-4">
      <FormField
        id={`note-${change.id}`}
        label="What did you change?"
        error={errors.note}
        announce
      >
        <Textarea
          id={`note-${change.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={MAX_NOTE}
          rows={3}
          required
          aria-describedby={`note-help-${change.id}${errors.note ? ` note-${change.id}-error` : ""}`}
          placeholder="The chat widget now renders replies as text; HTML escaping added to the render pipeline."
        />
      </FormField>
      <p id={`note-help-${change.id}`} className="text-xs text-muted-foreground">
        It stays with the change and is read together with the retest result.
      </p>
      <FormField id={`link-${change.id}`} label="Link to the code change (optional)" error={errors.link}>
        <Input
          id={`link-${change.id}`}
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://git.example.com/support/web-widget/merge_requests/482"
          aria-describedby={errors.link ? `link-${change.id}-error` : undefined}
        />
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={busy}>
          {busy && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
          {busy ? "Marking…" : "Mark as implemented"}
        </Button>
        {/* 2a1: the change cannot be made as proposed, so the developer asks for another one. */}
        <Button asChild variant="outline" className="h-9">
          <Link href={`/remediation/${change.finding.code}`}>Request revised remediation</Link>
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">
        A change counts as effective only when the retest confirms it.
      </p>
    </form>
  )
}

/** One open change: what to change, where it came from, and how far its proposal has come. */
function ChangeCard({
  change,
  expanded,
  canRequest,
  onToggle,
  onDone,
}: {
  change: ApplicationChange
  expanded: boolean
  /** undefined while the reader's permissions are still being read. */
  canRequest: boolean | undefined
  onToggle: () => void
  onDone: () => void
}) {
  const panelId = `change-${change.id}`
  return (
    <li className="min-w-0 rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{change.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <Link
              href={`/remediation/${change.finding.code}`}
              className="py-0.5 text-link hover:underline"
            >
              Version {change.version} for {change.finding.code}
            </Link>
            <SeverityBadge severity={change.finding.severity} />
            <span className="text-muted-foreground">{change.finding.title}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Link
              href={`/targets/${change.finding.target_id}`}
              className="py-0.5 text-link underline underline-offset-2"
            >
              {change.finding.target_name}
            </Link>
            {" · "}
            {change.finding.component}
            {change.approved_by && change.approved_at
              ? ` · approved by ${change.approved_by} on ${formatDate(change.approved_at)}`
              : ""}
          </p>
        </div>
        {canRequest && (
          <Button
            variant={expanded ? "outline" : "default"}
            className={expanded ? "h-9" : "h-9 hover:bg-primary-hover"}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            {expanded ? "Cancel" : "Mark as implemented"}
          </Button>
        )}
      </div>

      <h4 className="mt-3 text-[13px] font-medium text-muted-foreground">What to change</h4>
      <p className="mt-1 text-sm">{change.description}</p>
      <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">{change.progress}</p>

      <div id={panelId} hidden={!expanded}>
        {expanded && <ImplementedForm change={change} onDone={onDone} />}
      </div>
    </li>
  )
}

/**
 * Screen 50: the changes that have to be made inside the applications themselves (UC-8.5). A
 * gateway can carry a guardrail, a tool rule or a retrieval rule, but a code change — or any fix
 * for a target whose gateway cannot see the traffic it would act on — is the developer's work, and
 * it stays on this list until they mark it as implemented (quality requirement 1). Nothing here
 * closes a finding: the retest that follows judges it (quality requirement 5).
 */
export function ChangesPage() {
  const canRequest = useCan("request_remediations")
  const [data, setData] = useState<ChangeList | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listOpenChanges(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
        // The first card is open, so the form of step 3 is there without a click.
        setOpen((now) => now ?? found.rows[0]?.id ?? null)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return (
    <>
      <PageHeader
        title="Application changes"
        description="Changes to make in your application."
      />
      <RemediationTabs active="changes" counts={data ? { open_changes: data.open_changes } : {}} />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The application changes could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the application changes">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {data && data.rows.length === 0 && (
        <EmptyState
          title="No application change is waiting"
          description="Approved fixes for your developers appear here."
          action={
            <Button asChild variant="outline" className="h-9">
              <Link href="/remediation">Go to the proposals</Link>
            </Button>
          }
        />
      )}

      {data && data.rows.length > 0 && (
        <section aria-labelledby="changes">
          <h2 id="changes" className="mb-2 text-[15px] font-semibold">
            {data.open_changes} open {data.open_changes === 1 ? "change" : "changes"}
          </h2>
          <ul className="space-y-3">
            {data.rows.map((change) => (
              <ChangeCard
                key={change.id}
                change={change}
                expanded={open === change.id}
                canRequest={canRequest}
                onToggle={() => setOpen((now) => (now === change.id ? null : change.id))}
                onDone={() => {
                  setOpen(null)
                  reload()
                }}
              />
            ))}
          </ul>
          {!canRequest && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              The application&apos;s own developer marks a change as implemented.
            </p>
          )}
        </section>
      )}
    </>
  )
}
