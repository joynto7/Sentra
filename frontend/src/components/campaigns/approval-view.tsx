"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Check, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { FormField } from "@/components/auth/form-field"
import { EnvironmentBadge } from "@/components/targets/target-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  APPROVAL_LABEL,
  APPROVAL_STEP_LABEL,
  type ApprovalStatus,
  type ApprovalStep,
  type ApprovalView as Approval,
  decideApproval,
  formatCount,
  getApproval,
  submitForApproval,
  windowText,
} from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { TYPE_LABEL, type Environment, type TargetType, formatDateTime } from "@/lib/targets"

/** The chip every page uses for a campaign's approval (FR-5.2). "Ready" needs no chip of its own. */
export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  if (status === "not_required") return null
  const variant = status === "rejected" ? "destructive" : "outline"
  return (
    <Badge variant={variant} className="font-normal">
      {APPROVAL_LABEL[status]}
    </Badge>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="max-w-[60ch] text-right">{children}</dd>
    </div>
  )
}

function stepText(step: ApprovalStep): string {
  return `${step.actor ?? "A former member"} ${APPROVAL_STEP_LABEL[step.action]}`
}

/**
 * Screen 35, UC-5.2 Approve Campaign Scope: everything the decision needs on one screen — the
 * scope as it was submitted, who asked for it and when, every step so far, and the decision
 * itself. A Security Manager who did not create the campaign approves or rejects it (quality
 * requirement 3); everybody else sees the same scope and why they cannot decide.
 *
 * The analyst's way back from 3a is here too: a rejected campaign, or one that is older than the
 * organization's requirement, can be submitted again with a comment on what changed.
 */
export function CampaignApprovalView({ code }: { code: string }) {
  const canManage = useCan("manage_campaigns")
  const [approval, setApproval] = useState<Approval | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string>()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  usePageCrumbs([
    { label: approval?.campaign.name ?? code, href: `/campaigns/${code}` },
    { label: "Approval" },
  ])

  const load = useCallback(
    (signal?: AbortSignal) => {
      getApproval(code, signal)
        .then(setApproval)
        .catch((error) => {
          if (signal?.aborted) return
          if (error instanceof ApiError && error.status === 404) setNotFound(true)
          else setFailed(true)
        })
    },
    [code],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (notFound) {
    return (
      <EmptyState
        title="Campaign not found"
        description="It doesn't exist, or it belongs to another organization."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/campaigns">Back to campaigns</Link>
          </Button>
        }
      />
    )
  }
  if (failed) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
          The approval could not be loaded.
          <Button variant="outline" size="sm" onClick={() => load()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!approval) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the campaign's approval">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { campaign, timeline, can_decide: canDecide, required } = approval
  const status = campaign.approval_status as ApprovalStatus
  const { target, estimate } = campaign
  const submitted = [...timeline].reverse().find((step) => step.action === "submitted")
  const decision = campaign.approval_decision
  const waiting = status === "awaiting_approval"
  const mayAskAgain = canManage && required && (status === "rejected" || status === "not_required")

  async function decide(approve: boolean) {
    setBusy(true)
    setReasonError(undefined)
    try {
      const saved = await decideApproval(campaign.code, approve, approve ? null : reason.trim() || null)
      setApproval(saved)
      setRejecting(false)
      setReason("")
      toast.success(
        approve ? `${campaign.code} is approved` : `${campaign.code} is rejected`,
        { description: `${campaign.created_by ?? "The analyst"} has been told.` },
      )
    } catch (error) {
      const field = fieldErrors(error).reason
      if (field) setReasonError(field)
      else toast.error(error instanceof ApiError ? error.message : "The decision could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  async function askAgain() {
    setBusy(true)
    try {
      const saved = await submitForApproval(campaign.code, note.trim() || null)
      setApproval(saved)
      setNote("")
      toast.success(`${campaign.code} is waiting for approval`, {
        description: "The Security Managers of your organization have been told.",
      })
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "It could not be submitted.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        {/* The campaign's own name; the target is named in the scope below, so a campaign whose
            name already carries it is not said twice. */}
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/campaigns/${campaign.code}`} className="font-mono text-link hover:underline">
            {campaign.code}
          </Link>
          <ApprovalBadge status={status} />
          <span className="text-muted-foreground">
            {submitted
              ? `Requested by ${submitted.actor ?? "a former member"} · ${formatDateTime(submitted.at)}`
              : `Created by ${campaign.created_by ?? "a former member"} · ${formatDateTime(campaign.created_at)}`}
          </span>
        </div>
      </div>

      {!required && (
        <Alert role="status">
          <AlertDescription className="text-text-secondary">
            Your organization does not require scope approval, so this campaign can run without a
            decision. An Organization Administrator turns the requirement on in{" "}
            <Link href="/admin/security" className="font-medium text-link hover:underline">
              Organization Security
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section aria-labelledby="scope-heading" className="space-y-3 rounded-[10px] border bg-card p-5">
            <h2 id="scope-heading" className="text-[15px] font-semibold">
              Scope
            </h2>
            <dl className="divide-y">
              <Row term="Target">
                {target ? (
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    <Link href={`/targets/${target.id}`} className="font-medium text-link hover:underline">
                      {target.name}
                    </Link>
                    <EnvironmentBadge environment={target.environment as Environment} />
                    <span className="text-muted-foreground">
                      {TYPE_LABEL[target.type as TargetType]}
                      {target.status === "verified" ? " · ownership verified" : " · not verified"}
                    </span>
                  </span>
                ) : (
                  "The target no longer exists."
                )}
              </Row>
              <Row term="Threat model">
                {campaign.based_on_threat_model
                  ? `v${campaign.based_on_threat_model}, approved`
                  : "None approved when the campaign was created"}
              </Row>
              <Row term="Test suites">
                {campaign.suites.length} ({estimate.tests} tests
                {estimate.skipped ? `, ${estimate.skipped} skipped` : ""})
                <div className="text-xs text-muted-foreground">
                  {campaign.suites.map((suite) => suite.name).join(" · ")}
                </div>
              </Row>
              <Row term="Adaptive testing agent">{campaign.adaptive_agent ? "On" : "Off"}</Row>
              <Row term="Attempt budget">{formatCount(campaign.attempt_budget)} attempts</Row>
              <Row term="Maximum request rate">
                {campaign.request_rate} per minute
                {target ? ` (safe rate ${target.max_request_rate})` : ""}
              </Row>
              <Row term="Time window">
                {windowText(campaign.window_start, campaign.window_end, campaign.time_zone)}
              </Row>
              <Row term="Schedule">{campaign.schedule ? campaign.schedule.summary : "When someone launches it"}</Row>
              <Row term="Estimated LLM cost">
                {estimate.llm_cost.low_usd
                  ? `$${estimate.llm_cost.low_usd}–${estimate.llm_cost.high_usd}`
                  : "Not measurable yet"}
              </Row>
              <Row term="Repetitions for reproducibility">{campaign.repetitions}</Row>
            </dl>
            {estimate.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
          </section>

          <section aria-labelledby="activity-heading" className="space-y-3 rounded-[10px] border bg-card p-5">
            <h2 id="activity-heading" className="text-[15px] font-semibold">
              Activity
            </h2>
            <ol className="space-y-3">
              {timeline.map((step, index) => (
                <li key={`${step.action}-${step.at}-${index}`} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      step.action === "rejected"
                        ? "bg-destructive"
                        : step.action === "approved"
                          ? "bg-success"
                          : "bg-border-strong"
                    }`}
                  />
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{stepText(step)}</span>{" "}
                      <span className="text-muted-foreground">· {formatDateTime(step.at)}</span>
                    </p>
                    {step.note && <p className="mt-0.5 text-text-secondary">“{step.note}”</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-5">
          <section aria-labelledby="decision-heading" className="space-y-4 rounded-[10px] border bg-card p-5">
            <h2 id="decision-heading" className="text-[15px] font-semibold">
              {canDecide ? "Your decision" : "Decision"}
            </h2>

            {decision && (
              <p className="text-sm">
                <span className="font-medium">
                  {decision.action === "approved" ? "Approved" : "Rejected"} by{" "}
                  {decision.actor ?? "a former member"}
                </span>
                <span className="text-muted-foreground"> · {formatDateTime(decision.at)}</span>
                {decision.note && <span className="mt-1 block text-text-secondary">“{decision.note}”</span>}
              </p>
            )}

            {canDecide ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button className="h-9 gap-1.5 hover:bg-primary-hover" disabled={busy} onClick={() => void decide(true)}>
                    <Check aria-hidden="true" />
                    {busy ? "Saving…" : "Approve"}
                  </Button>
                  <Button variant="outline" className="h-9 gap-1.5" disabled={busy} onClick={() => setRejecting(true)}>
                    <X aria-hidden="true" />
                    Reject
                  </Button>
                </div>
                <ul className="space-y-1.5 text-sm text-text-secondary">
                  <li>{campaign.created_by ?? "The analyst"} will be told your decision.</li>
                  <li>Any later change to the scope, the budget or the schedule needs a new approval.</li>
                  <li>You can&apos;t approve campaigns you created.</li>
                </ul>
              </>
            ) : (
              // Why this user may not decide — but only while there is something to decide; after
              // a decision the line above already says what happened.
              waiting && (
                <p className="text-sm text-text-secondary" aria-live="polite">
                  {approval.cannot_decide_reason ?? "A Security Manager decides on this campaign."}
                </p>
              )
            )}

            {mayAskAgain && (
              <div className="space-y-3 border-t pt-4">
                <FormField id="submit-note" label="What changed? (optional)">
                  <Textarea
                    id="submit-note"
                    value={note}
                    maxLength={2000}
                    rows={3}
                    aria-describedby="submit-note-help"
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <p id="submit-note-help" className="text-xs text-muted-foreground">
                    The Security Managers see this with the request.
                  </p>
                </FormField>
                <Button className="h-9 hover:bg-primary-hover" disabled={busy} onClick={() => void askAgain()}>
                  {busy ? "Submitting…" : "Submit for approval"}
                </Button>
              </div>
            )}
          </section>

          <aside aria-labelledby="why-heading" className="space-y-2 rounded-[10px] border bg-muted/40 p-5 text-sm text-text-secondary">
            <h2 id="why-heading" className="text-sm font-semibold text-foreground">
              Why this step?
            </h2>
            <p>
              A campaign sends security tests to a real application. Where an organization requires
              it, a Security Manager checks what will be sent, how much of it and how fast, before
              anything runs.
            </p>
            <p>Every decision is recorded with the manager who made it, in the audit log.</p>
          </aside>
        </div>
      </div>

      <Dialog open={rejecting} onOpenChange={(open) => (open ? setRejecting(true) : setRejecting(false))}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Reject campaign {campaign.code}?</DialogTitle>
            <DialogDescription>
              {campaign.created_by ?? "The analyst"} is told your reason and can change the campaign
              and ask again.
            </DialogDescription>
          </DialogHeader>
          <FormField id="reject-reason" label="Reason" error={reasonError} announce>
            <Textarea
              id="reject-reason"
              value={reason}
              maxLength={2000}
              rows={4}
              autoFocus
              aria-invalid={!!reasonError}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={busy}
              onClick={() => {
                if (!reason.trim()) {
                  setReasonError("Say why you are rejecting it, so the analyst knows what to change.")
                  document.getElementById("reject-reason")?.focus()
                  return
                }
                void decide(false)
              }}
            >
              {busy ? "Rejecting…" : "Reject campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
