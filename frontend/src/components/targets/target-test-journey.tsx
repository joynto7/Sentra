"use client"

import { useEffect, useState } from "react"

import { type Step, StepJourney } from "@/components/sentra/step-journey"
import { type CampaignRow, type RunOverviewItem, listCampaigns, listOrganizationRuns } from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { type TargetRisk, getTargetRisk } from "@/lib/risk"
import { type Target, getTarget } from "@/lib/targets"

/**
 * How a target gets tested, from the target's own data: its ownership is verified, a campaign is
 * made, its scope is approved, a run finishes, and the findings are read. A step is done only when
 * what the server holds says so, and each step offers the one thing the reader can do about it.
 */
export function TargetTestJourney({ targetId }: { targetId: string }) {
  const canCampaign = useCan("manage_campaigns")
  const canVerify = useCan("verify_targets")
  const [target, setTarget] = useState<Target | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null)
  const [runs, setRuns] = useState<RunOverviewItem[] | null>(null)
  const [risk, setRisk] = useState<TargetRisk | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getTarget(targetId)
      .then(setTarget)
      .catch(() => undefined)
    listCampaigns(new URLSearchParams({ target_id: targetId }), controller.signal)
      .then(setCampaigns)
      .catch(() => setCampaigns([]))
    listOrganizationRuns(new URLSearchParams({ target_id: targetId, limit: "20" }), controller.signal)
      .then(setRuns)
      .catch(() => setRuns([]))
    getTargetRisk(targetId, controller.signal)
      .then(setRisk)
      .catch(() => undefined)
    return () => controller.abort()
  }, [targetId])

  if (!target || !campaigns || !runs) return null

  const verified = target.status === "verified"
  const made = campaigns.length > 0
  const approved = campaigns.some((one) => one.approval_status === "approved" || one.approval_status === "not_required")
  const waiting = campaigns.some((one) => one.approval_status === "awaiting_approval")
  const rejected = !approved && campaigns.some((one) => one.approval_status === "rejected")
  const running = runs.some((run) => run.status === "running" || run.status === "queued" || run.status === "paused")
  const finished = runs.some((run) => run.status === "completed")
  const open = risk?.open_total ?? 0
  const firstCampaign = campaigns[0]

  const steps: Step[] = [
    verified
      ? { id: "ownership", title: "Ownership", state: "done", status: "Ownership is verified, and checked again before every run." }
      : {
          id: "ownership",
          title: "Ownership",
          state: canVerify ? "current" : "waiting",
          status: "Not verified, so no campaign can run against it.",
          who: "AI Application Developer",
          action: canVerify ? { label: "Verify ownership", href: `/targets/${targetId}/verify` } : null,
        },
    made
      ? {
          id: "campaign",
          title: "Campaign",
          state: "done",
          status: `${campaigns.length} ${campaigns.length === 1 ? "campaign is" : "campaigns are"} made for this target.`,
        }
      : {
          id: "campaign",
          title: "Campaign",
          state: verified ? (canCampaign ? "current" : "waiting") : "upcoming",
          status: verified ? "No campaign yet. A campaign chooses the tests and the budget." : "Starts once ownership is verified.",
          who: "Security Analyst",
          action: verified && canCampaign ? { label: "Create a campaign", href: `/campaigns/new?target=${targetId}` } : null,
        },
    !made
      ? { id: "scope", title: "Scope", state: "upcoming", status: "A campaign's scope is approved before it can run." }
      : approved
        ? { id: "scope", title: "Scope", state: "done", status: "A campaign's scope is approved." }
        : rejected
          ? {
              id: "scope",
              title: "Scope",
              state: "problem",
              status: "The scope was rejected. Change the campaign and send it again.",
              who: "Security Analyst",
              action: firstCampaign ? { label: "Open the campaign", href: `/campaigns/${firstCampaign.code}` } : null,
            }
          : {
              id: "scope",
              title: "Scope",
              state: waiting ? "waiting" : "current",
              status: waiting ? "Waiting for a Security Manager to approve the scope." : "Ready to be approved.",
              who: "Security Manager",
              action: firstCampaign ? { label: "Open the campaign", href: `/campaigns/${firstCampaign.code}` } : null,
            },
    finished
      ? {
          id: "run",
          title: "Run",
          state: "done",
          status: `${runs.filter((run) => run.status === "completed").length} ${runs.filter((run) => run.status === "completed").length === 1 ? "run has" : "runs have"} finished.`,
        }
      : running
        ? {
            id: "run",
            title: "Run",
            state: "current",
            working: true,
            status: "A run is going on now.",
            action: runs[0]?.campaign
              ? { label: "Follow the run", href: `/campaigns/${runs[0].campaign.code}/runs/${runs[0].number}` }
              : null,
          }
        : {
            id: "run",
            title: "Run",
            state: approved ? "current" : "upcoming",
            status: approved ? "Approved and not run yet. Launch it from the campaign." : "Runs after the scope is approved.",
            who: "Security Analyst",
            action: approved && firstCampaign ? { label: "Open the campaign", href: `/campaigns/${firstCampaign.code}` } : null,
          },
    finished
      ? open > 0
        ? {
            id: "findings",
            title: "Findings",
            state: "current",
            status: `${open} open ${open === 1 ? "finding" : "findings"} to read and triage.`,
            who: "Security Analyst",
            action: { label: "Read the findings", href: `/targets/${targetId}/findings` },
          }
        : { id: "findings", title: "Findings", state: "done", status: "Nothing is open: the run found nothing that still needs a person." }
      : { id: "findings", title: "Findings", state: "upcoming", status: "Appear after a run has finished." },
  ]
  const first = steps.find((step) => step.state !== "done" && step.state !== "upcoming") ?? steps[steps.length - 1]

  return (
    <StepJourney
      title="How this target gets tested"
      titleId="test-journey-heading"
      fallbackId={first.id}
      steps={steps}
      summary={first.state === "done" ? "Every step is done." : `Next: ${first.title.toLowerCase()}.`}
    />
  )
}
