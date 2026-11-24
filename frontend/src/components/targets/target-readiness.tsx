"use client"

import Link from "next/link"

import type { ConnectionState } from "@/components/targets/connection-test"
import { type Step, type StepState, StepJourney } from "@/components/sentra/step-journey"
import { Button } from "@/components/ui/button"
import { useCan } from "@/lib/permissions"
import type { ReadinessKind } from "@/components/wizard/status"
import { type Target, type Verification, formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

/** How a readiness row reads as a step of the journey: "missing" is something to do, "waiting" is for someone else. */
const AS_STATE: Record<ReadinessKind, { state: StepState; word: string }> = {
  checking: { state: "current", word: "Checking" },
  ready: { state: "done", word: "Done" },
  missing: { state: "waiting", word: "Needs something" },
  waiting: { state: "upcoming", word: "Waiting" },
  blocked: { state: "problem", word: "Problem" },
}

type Row = { id: string; label: string; kind: ReadinessKind; text: string; href?: string; action?: string; test?: boolean }

/**
 * Where a target stands before it can be assessed, one row for each thing that is NOT the same as the
 * others: it is saved, it answers, its ownership is proved, its profile is reviewed. Saving records a
 * target; a saved credential is not a working connection; a working connection is not ownership.
 * "Ready for assessment" says what the backend requires (verified ownership, archived targets never),
 * and the other rows are shown as what they are, never folded into one green tick.
 */
export function TargetReadiness({
  target,
  connection,
  verification,
  canVerify,
  canCampaign,
  canManage,
}: {
  target: Target
  connection: ConnectionState
  verification: Verification | null
  canVerify: boolean | undefined
  canCampaign: boolean | undefined
  canManage: boolean | undefined
}) {
  const canTest = useCan("test_target_connections")
  const verified = target.status === "verified"
  const archived = target.status === "archived"
  const test = connection.test
  const last = test ?? target.last_connection_test
  const running = connection.busy || test?.status === "running" || last?.status === "running"

  const rows: Row[] = [
    {
      id: "saved",
      label: "Saved",
      kind: "ready",
      text: `Registered ${formatDateTime(target.created_at)}${target.owner ? ` by ${target.owner.name}` : ""}. Saving only records the target: nothing was tested.`,
    },
  ]

  // Reachable: what the last connection test said, and that a saved credential proves nothing
  if (running) rows.push({ id: "connection", label: "Reachable", kind: "checking", text: "A connection test is running." })
  else if (connection.loading && !last)
    rows.push({ id: "connection", label: "Reachable", kind: "checking", text: "Reading the last connection test." })
  else if (!last) {
    rows.push({
      id: "connection",
      label: "Reachable",
      kind: "missing",
      text: "Not tested yet. A saved credential is not a working connection: use Test connection.",
      test: true,
    })
  } else if (last.status === "passed") {
    rows.push({
      id: "connection",
      label: "Reachable",
      kind: "ready",
      text: `The last test passed${last.finished_at ? ` on ${formatDateTime(last.finished_at)}` : ""}${last.status_code ? ` (HTTP ${last.status_code}` : ""}${last.duration_ms ? `${last.status_code ? ", " : " ("}${last.duration_ms} ms` : ""}${last.status_code || last.duration_ms ? ")" : ""}.`,
    })
  } else {
    rows.push({
      id: "connection",
      label: "Reachable",
      kind: "blocked",
      text: `The last test failed${last.status_code ? ` (HTTP ${last.status_code})` : ""}${test?.error_message ? `: ${test.error_message.replace(/[.\s]+$/, "")}` : ""}. Check the endpoint and the credentials, then test again.`,
      href: canManage ? `/targets/${target.id}/edit` : undefined,
      action: canManage ? "Edit connection" : undefined,
      test: true,
    })
  }

  // Ownership: the one condition a campaign needs
  if (archived)
    rows.push({
      id: "ownership",
      label: "Ownership",
      kind: "blocked",
      text: "The target is archived. Restore it, add credentials and verify ownership again.",
    })
  else if (verified) {
    rows.push({
      id: "ownership",
      label: "Ownership",
      kind: "ready",
      text: `Verified${verification?.verified_by ? ` by ${verification.verified_by}` : ""}${verification?.verified_at ? ` on ${formatDateTime(verification.verified_at)}` : ""}. Checked again before every campaign run.`,
    })
  } else if (canVerify) {
    rows.push({
      id: "ownership",
      label: "Ownership",
      kind: "missing",
      text: "Not verified, so no campaign can run against it.",
      href: `/targets/${target.id}/verify`,
      action: "Verify ownership",
    })
  } else {
    rows.push({
      id: "ownership",
      label: "Ownership",
      kind: "waiting",
      text: "Not verified, so no campaign can run. An AI Application Developer verifies it.",
    })
  }

  // The profile: what Sentra knows about the application, from discovery and from the person
  const profile = target.profile_status
  if (profile === "mapping") rows.push({ id: "profile", label: "Target Profile", kind: "checking", text: "Sentra is mapping it now." })
  else if (profile === "reviewed")
    rows.push({
      id: "profile",
      label: "Target Profile",
      kind: "ready",
      text: "Reviewed and saved.",
      href: `/targets/${target.id}/profile`,
      action: "Open the profile",
    })
  else if (profile === null) {
    rows.push({
      id: "profile",
      label: "Target Profile",
      kind: verified ? "missing" : "waiting",
      text: verified
        ? "Not mapped yet. Use Update profile."
        : "Mapped after ownership is verified, from a few harmless discovery requests.",
    })
  } else {
    rows.push({
      id: "profile",
      label: "Target Profile",
      kind: "missing",
      text:
        profile === "failed"
          ? "The mapping did not work. Enter the profile by hand."
          : profile === "partial"
            ? "Mapped only in part: some entries need completing."
            : "Mapped and waiting for review.",
      href: `/targets/${target.id}/profile`,
      action: "Review the profile",
    })
  }

  const headline = archived
    ? "Not available for assessment: the target is archived"
    : verified
      ? "Ready for assessment: ownership is verified"
      : "Not ready for assessment: ownership is not verified"
  const notes: string[] = []
  if (verified && !running && (!last || last.status === "failed"))
    notes.push(last ? "the last connection test failed" : "the connection has not been tested")
  if (verified && profile !== "reviewed" && profile !== "mapping") notes.push("the Target Profile is not reviewed")

  const steps: Step[] = rows.map((row) => {
    const as = AS_STATE[row.kind]
    const testing = row.id === "connection" && running
    // "Reachable" offers the test itself; the others offer their own page
    const action =
      row.id === "connection" && row.test && canTest && !archived
        ? {
            label: testing ? "Testing…" : connection.busy ? "Starting…" : "Test connection",
            onClick: connection.start,
            disabled: testing || connection.busy,
          }
        : row.href && row.action
          ? { label: row.action, href: row.href }
          : null
    return {
      id: row.id,
      title: row.label,
      state: as.state,
      word: as.word,
      status: row.text,
      working: testing || row.kind === "checking",
      next: null,
      action,
    }
  })
  const firstOpen = rows.find((row) => row.kind !== "ready")

  return (
    <StepJourney
      title="Readiness"
      titleId="readiness-heading"
      fallbackId={firstOpen?.id ?? rows[rows.length - 1].id}
      steps={steps}
      summary={
        <span className={cn(verified && !archived ? "text-success" : "text-warning")}>
          {headline}
          {notes.length > 0 && <span className="text-text-secondary">. Noted: {notes.join("; ")}.</span>}
        </span>
      }
      aside={
        !archived ? (
          verified ? (
            canCampaign ? (
              <Button asChild size="sm" className="h-9 rounded-full px-4 hover:bg-primary-hover">
                <Link href={`/campaigns/new?target=${target.id}`}>Create campaign</Link>
              </Button>
            ) : (
              <p className="max-w-64 text-xs text-muted-foreground">A Security Analyst creates the campaigns.</p>
            )
          ) : null
        ) : null
      }
    />
  )
}
