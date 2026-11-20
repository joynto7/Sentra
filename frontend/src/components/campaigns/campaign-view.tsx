"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { LaunchRunButton } from "@/components/campaigns/launch-run"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { EnvironmentBadge } from "@/components/targets/target-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  type CampaignDetail,
  type RunOverviewItem,
  RUN_STATUS_LABEL,
  formatCount,
  SCHEDULE_RESULT_LABEL,
  SCHEDULE_STATUS_LABEL,
  type Schedule,
  getCampaign,
  listRuns,
  pauseSchedule,
  removeSchedule,
  resumeSchedule,
  saveSchedule,
  windowText,
} from "@/lib/campaigns"
import {
  type ScheduleDraft,
  ScheduleFields,
  draftOf,
  scheduleInput,
  scheduleProblem,
} from "@/components/campaigns/schedule-fields"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCan } from "@/lib/permissions"
import { TYPE_LABEL, type Environment, type TargetType, formatDateTime } from "@/lib/targets"
import { formatDate } from "@/lib/test-library"

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-[10px] border bg-card p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

/**
 * The campaign's schedule on its own page (FR-5.3): what it is, when it next runs, what came of
 * its last moment, and the controls of UC-5.1 step 5 — change it, pause it, start it again or
 * remove it. Only a Security Analyst sees the controls (FR-1.6).
 */
function ScheduleCard({
  campaign,
  schedule,
  onChange,
}: {
  campaign: CampaignDetail
  schedule: Schedule | null
  onChange: (schedule: Schedule | null) => void
}) {
  const canManage = useCan("manage_campaigns")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(schedule))
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const act = async (what: () => Promise<Schedule | null>, done: string) => {
    setBusy(true)
    setProblem(undefined)
    try {
      onChange(await what())
      toast.success(done)
      setEditing(false)
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const open = (next: boolean) => {
    setDraft(draftOf(schedule))
    setProblem(undefined)
    setEditing(next)
  }

  return (
    <Card title="Schedule">
      {schedule ? (
        <dl className="divide-y">
          <Row term="Runs">{schedule.summary}</Row>
          <Row term="Status">{SCHEDULE_STATUS_LABEL[schedule.status]}</Row>
          <Row term="Next run">
            {schedule.next_run_at ? formatDateTime(schedule.next_run_at) : "Not planned"}
          </Row>
          {schedule.last_run_at && (
            <Row term="Last moment">
              {formatDateTime(schedule.last_run_at)}
              <div className="text-xs text-muted-foreground">
                {schedule.last_result ? SCHEDULE_RESULT_LABEL[schedule.last_result] : ""}
                {schedule.last_message ? `: ${schedule.last_message}` : ""}
              </div>
            </Row>
          )}
          {schedule.created_by && <Row term="Runs with the permissions of">{schedule.created_by}</Row>}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          This campaign runs only when someone launches it. A schedule starts it by itself, with the
          permissions of whoever saved it.
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => open(true)} disabled={busy}>
            {schedule ? "Change schedule" : "Add a schedule"}
          </Button>
          {schedule?.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act(() => pauseSchedule(campaign.code), "The schedule is paused.")}
            >
              Pause
            </Button>
          )}
          {schedule && schedule.status !== "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act(() => resumeSchedule(campaign.code), "The schedule runs again.")}
            >
              Start again
            </Button>
          )}
          {schedule && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await removeSchedule(campaign.code)
                  return null
                }, "The schedule is removed.")
              }
            >
              Remove
            </Button>
          )}
        </div>
      )}
      {problem && !editing && (
        <p role="alert" className="text-[13px] text-destructive">
          {problem}
        </p>
      )}

      <Dialog open={editing} onOpenChange={open}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>When {campaign.code} runs</DialogTitle>
            <DialogDescription>
              A schedule starts the campaign by itself, with the permissions of whoever saves it.
            </DialogDescription>
          </DialogHeader>
          <ScheduleFields
            draft={draft}
            onChange={setDraft}
            timeZone={campaign.time_zone}
            withImmediately={false}
            error={problem}
            disabled={busy}
            idPrefix="campaign-schedule"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const wrong = scheduleProblem(draft)
                if (wrong) {
                  setProblem(wrong)
                  return
                }
                void act(() => saveSchedule(campaign.code, scheduleInput(draft)), "The schedule is saved.")
              }}
            >
              Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/** A saved campaign: its target, suites, limits, schedule and estimate (UC-5.1, FR-5.3). */
export function CampaignView({ code }: { code: string }) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [runs, setRuns] = useState<RunOverviewItem[] | null>(null)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [notFound, setNotFound] = useState(false)

  usePageCrumbs([{ label: campaign?.name ?? code }])

  useEffect(() => {
    const controller = new AbortController()
    getCampaign(code)
      .then((found) => {
        setCampaign(found)
        setSchedule(found.schedule)
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
    // The campaign's own runs (UC-5.6 step 1); they carry no campaign, because it is this one.
    listRuns(code, controller.signal)
      .then((found) => setRuns(found.map((run) => ({ ...run, campaign: null, target: null }))))
      .catch(() => setRuns([]))
    return () => controller.abort()
  }, [code])

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
  if (!campaign) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading campaign">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { target, estimate } = campaign

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">{campaign.code}</span>
          <Badge variant="outline" className="font-normal">
            Ready
          </Badge>
          <span className="text-muted-foreground">
            Created by {campaign.created_by ?? "a former member"} on {formatDate(campaign.created_at)}
          </span>
        </div>
        </div>
        <LaunchRunButton code={campaign.code} targetVerified={target?.status === "verified"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card title="Target">
            {target ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link href={`/targets/${target.id}/edit`} className="font-medium text-link hover:underline">
                  {target.name}
                </Link>
                <EnvironmentBadge environment={target.environment as Environment} />
                <span className="text-muted-foreground">
                  {TYPE_LABEL[target.type as TargetType]} · safe rate {target.max_request_rate} per minute
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">The target no longer exists.</p>
            )}
          </Card>

          <Card title={`Test suites (${campaign.suites.length})`}>
            <ul className="divide-y rounded-[10px] border">
              {campaign.suites.map((suite) => (
                <li key={suite.code} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm">
                  {suite.found ? (
                    <Link href={`/test-library/suites/${suite.code}`} className="font-medium text-link hover:underline">
                      {suite.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{suite.name}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {suite.found ? `${suite.test_count} tests · v${suite.version}` : "Archived or removed"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Each run uses the suites&apos; versions of that moment and records them.
            </p>
          </Card>

          <Card title="Limits">
            <dl className="divide-y">
              <Row term="Attempt budget">{formatCount(campaign.attempt_budget)} attempts</Row>
              <Row term="Maximum request rate">
                {campaign.request_rate} per minute
                {target ? ` (safe rate ${target.max_request_rate})` : ""}
              </Row>
              <Row term="Time window">{windowText(campaign.window_start, campaign.window_end, campaign.time_zone)}</Row>
              <Row term="Repetitions for reproducibility">{campaign.repetitions}</Row>
              <Row term="Adaptive testing agent">{campaign.adaptive_agent ? "May refine tests" : "Off"}</Row>
            </dl>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Estimate">
            <dl className="divide-y">
              <Row term="Tests that will run">
                {estimate.tests}
                {estimate.skipped ? ` (${estimate.skipped} skipped)` : ""}
              </Row>
              <Row term="Estimated attempts">
                {formatCount(estimate.estimated_attempts)} of {formatCount(campaign.attempt_budget)}
              </Row>
            </dl>
            {estimate.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
          </Card>
          <ScheduleCard campaign={campaign} schedule={schedule} onChange={setSchedule} />
          <Card title="Runs">
            {runs === null ? (
              <Skeleton className="h-16 w-full" />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not run yet. A run sends this campaign&apos;s tests to the target and can be followed live.
              </p>
            ) : (
              <ul className="space-y-2">
                {runs.slice(0, 5).map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link href={`/campaigns/${campaign.code}/runs/${run.number}`} className="font-mono text-[13px] text-link hover:underline">
                      {run.code}
                    </Link>
                    <span className="text-muted-foreground">{RUN_STATUS_LABEL[run.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
