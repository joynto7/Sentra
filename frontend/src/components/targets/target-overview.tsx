"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, MoreHorizontal, Pencil, Rocket, ShieldCheck, Waypoints } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { EndpointChip } from "@/components/targets/endpoint-chip"
import { GLASS_PILL, GLASS_SURFACE } from "@/components/sentra/glass-card"
import { RiskScore, SeverityCountsStrip } from "@/components/sentra/risk-score"
import { TargetMark } from "@/components/sentra/target-picker"
import { ArchiveDialog, RestoreButton } from "@/components/targets/archive-dialog"
import { ConnectionSummary, TestConnectionButton, useConnectionTest } from "@/components/targets/connection-test"
import { EnvironmentBadge, OwnershipBadge } from "@/components/targets/target-badges"
import { TargetCoverageSummary, TargetShieldSummary } from "@/components/targets/target-cards"
import { TargetReadiness } from "@/components/targets/target-readiness"
import { TargetTabs } from "@/components/targets/target-tabs"
import { TargetThreatModel } from "@/components/threat-models/target-threat-model"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RUN_STATUS_LABEL, type RunOverviewItem, listOrganizationRuns } from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { type TargetRisk, getTargetRisk, notScoredText } from "@/lib/risk"
import {
  TYPE_LABEL,
  type Target,
  VERIFICATION_LABEL,
  type Verification,
  formatDate,
  formatDateTime,
  getTarget,
  getVerification,
  startProfileMapping,
} from "@/lib/targets"

const RUNS_SHOWN = 3

function Card({
  title,
  action,
  glass,
  children,
}: {
  title: string
  action?: React.ReactNode
  /** The four figures at the top take the colour every card has; the lists below stay plain */
  glass?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border p-5",
        glass ? cn("shadow-[0_20px_40px_-30px_rgba(43,79,216,0.35)]", GLASS_SURFACE) : "rounded-[10px] bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The target's runs, newest first; the monitor of each one is Screen 36. */
function recentRuns(targetId: string, signal: AbortSignal): Promise<RunOverviewItem[]> {
  return listOrganizationRuns(new URLSearchParams({ target_id: targetId, limit: String(RUNS_SHOWN) }), signal)
}

/**
 * Screen 20: the hub of one target (UC-2.2, UC-2.5, UC-2.6, UC-2.7 and UC-7.2). Every member of
 * the organization may read it; another organization gets "not found" (NFR-3.3).
 */
export function TargetOverview({ id }: { id: string }) {
  const router = useRouter()
  const canManage = useCan("manage_targets")
  const canCampaign = useCan("manage_campaigns")
  const canVerify = useCan("verify_targets")
  const canMap = useCan("map_target_profiles")
  const [target, setTarget] = useState<Target | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [risk, setRisk] = useState<TargetRisk | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [runs, setRuns] = useState<RunOverviewItem[] | null>(null)
  const [mapping, setMapping] = useState(false)
  const [archiving, setArchiving] = useState(false)

  usePageCrumbs([{ label: target?.name ?? "Target" }])

  useEffect(() => {
    const controller = new AbortController()
    getTarget(id)
      .then(setTarget)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
    getTargetRisk(id, controller.signal)
      .then(setRisk)
      .catch(() => undefined)
    getVerification(id, controller.signal)
      .then(setVerification)
      .catch(() => undefined)
    recentRuns(id, controller.signal)
      .then(setRuns)
      .catch(() => setRuns([]))
    return () => controller.abort()
  }, [id])

  const connection = useConnectionTest(id)

  const updateProfile = useCallback(async () => {
    setMapping(true)
    try {
      await startProfileMapping(id)
      toast.success("Sentra is mapping the Target Profile", {
        description: "It sends a few harmless discovery requests. You review the result.",
      })
      router.push(`/targets/${id}/profile`)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The mapping could not be started.")
    } finally {
      setMapping(false)
    }
  }, [id, router])

  if (notFound) {
    return (
      <EmptyState
        title="Target not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/targets">Back to targets</Link>
          </Button>
        }
      />
    )
  }
  if (!target) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the target">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const verified = target.status === "verified"
  const archived = target.status === "archived"
  const recheck = verification?.recent_checks.find((check) => check.trigger === "campaign_run" && check.status === "passed")

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <TargetMark name={target.name} className="size-14 text-xl" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={cn("h-6 font-normal", GLASS_PILL)}>
                {TYPE_LABEL[target.type]}
              </Badge>
              <EnvironmentBadge
                environment={target.environment}
                className={target.environment === "production" ? "rounded-full px-3" : GLASS_PILL}
              />
              <OwnershipBadge status={target.status} className={GLASS_PILL} />
              {target.is_lab && (
                <Badge variant="outline" className={cn("h-6 font-normal", GLASS_PILL)}>
                  Sentra lab
                </Badge>
              )}
            </div>
            <EndpointChip url={target.endpoint_url} />
            <p className="mt-1.5 text-sm text-muted-foreground">
              Registered by {target.owner?.name ?? "a former member"} on {formatDate(target.created_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {archived
            ? null
            : verified
              ? canCampaign && (
                  <Button asChild className="h-9 gap-1.5 hover:bg-primary-hover">
                    <Link href={`/campaigns/new?target=${target.id}`}>
                      <Rocket aria-hidden="true" />
                      Create campaign
                    </Link>
                  </Button>
                )
              : canVerify && (
                  <Button asChild className="h-9 gap-1.5 hover:bg-primary-hover">
                    <Link href={`/targets/${target.id}/verify`}>
                      <ShieldCheck aria-hidden="true" />
                      Verify ownership
                    </Link>
                  </Button>
                )}
          <TestConnectionButton target={target} state={connection} className="h-9" />
          <Button asChild variant="outline" className="h-9 gap-1.5">
            <Link href={`/targets/${target.id}/edit`}>
              <Pencil aria-hidden="true" />
              {canManage ? "Edit" : "View settings"}
            </Link>
          </Button>
          {archived
            ? canManage && <RestoreButton target={target} onDone={setTarget} className="h-9" />
            : (canMap || canManage) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-9" aria-label={`More actions for ${target.name}`}>
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canMap && verified && (
                      <DropdownMenuItem
                        disabled={mapping || target.profile_status === "mapping"}
                        onSelect={(event) => {
                          event.preventDefault()
                          void updateProfile()
                        }}
                      >
                        <Waypoints aria-hidden="true" />
                        Update profile
                      </DropdownMenuItem>
                    )}
                    {canManage && (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={(event) => {
                          event.preventDefault()
                          setArchiving(true)
                        }}
                      >
                        <Archive aria-hidden="true" />
                        Archive target
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
        </div>
      </div>

      {archived && (
        <div role="status" className="mb-5 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm">
          <p className="font-medium text-warning">This target is archived</p>
          <p className="mt-1 text-muted-foreground">
            No campaign can run against it and its credentials were deleted
            {target.archived_at ? ` on ${formatDate(target.archived_at)}` : ""}
            {target.archived_by ? ` by ${target.archived_by.name}` : ""}. Its history, findings and reports stay until their retention
            period ends. Restoring it brings it back as unverified, with new credentials and a new ownership check.
          </p>
        </div>
      )}

      <TargetTabs targetId={target.id} active="overview" />

      <ArchiveDialog target={target} open={archiving} onOpenChange={setArchiving} onDone={setTarget} />
      <TargetReadiness
        target={target}
        connection={connection}
        verification={verification}
        canVerify={canVerify}
        canCampaign={canCampaign}
        canManage={canManage}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Risk score" glass>
          {!risk ? (
            <Skeleton className="h-16 w-full" />
          ) : risk.score === null ? (
            <>
              <p className="text-sm text-muted-foreground">{notScoredText(risk.not_scored_reason)}</p>
              <p className="text-xs text-muted-foreground">
                A target is scored after its first campaign run, and every score is shown with the date of that run.
              </p>
            </>
          ) : (
            <>
              <RiskScore score={risk.score} band={risk.band ?? "none"} size="lg" />
              <p className="text-xs text-muted-foreground">
                {risk.last_run_at ? `Last campaign run ${formatDateTime(risk.last_run_at)}` : "No campaign run yet"}
              </p>
              {risk.awaiting_confirmation > 0 && (
                <p className="text-xs text-warning">
                  {risk.awaiting_confirmation} {risk.awaiting_confirmation === 1 ? "finding awaits" : "findings await"} confirmation and{" "}
                  {risk.awaiting_confirmation === 1 ? "is" : "are"} not counted yet.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Open findings" glass>
          {!risk ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <p className="tabular text-3xl font-semibold">{risk.open_total}</p>
              <SeverityCountsStrip counts={risk.open_by_severity} />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link href={`/targets/${target.id}/findings`} className="text-sm text-link hover:underline">
                  View findings
                </Link>
                <Link href={`/attack-paths?target=${target.id}`} className="text-sm text-link hover:underline">
                  View attack paths
                </Link>
              </div>
            </>
          )}
        </Card>

        <Card title="Ownership" glass>
          {verified ? (
            <>
              <p className="text-sm">
                Verified
                {verification?.verified_by ? ` by ${verification.verified_by}` : ""}
                {verification?.verified_at ? ` on ${formatDate(verification.verified_at)}` : ""}
                {verification?.method ? ` · ${VERIFICATION_LABEL[verification.method]}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Re-checked before every campaign run
                {recheck?.finished_at ? ` (last ${formatDateTime(recheck.finished_at)})` : ""}.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">Not verified yet, so no campaign can run against it.</p>
              {canVerify && (
                <Button asChild variant="outline" size="sm" className="h-8 w-fit">
                  <Link href={`/targets/${target.id}/verify`}>Verify ownership</Link>
                </Button>
              )}
            </>
          )}
        </Card>

        <Card title="Sentra Shield" glass>
          <TargetShieldSummary targetId={target.id} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card
            title="Recent campaign runs"
            action={
              <Button asChild variant="ghost" size="sm" className="h-8">
                <Link href="/campaigns">All campaigns</Link>
              </Button>
            }
          >
            {runs === null ? (
              <Skeleton className="h-24 w-full" />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No campaign run yet.{" "}
                {verified
                  ? "Create a campaign to test this target."
                  : "Verify the target's ownership first; only a verified target can be tested."}
              </p>
            ) : (
              <div>
                <Table
                  container={{
                    tabIndex: 0,
                    role: "group",
                    "aria-label": "Recent campaign runs",
                    className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  }}
                >
                  <TableHeader className="bg-muted">
                    <TableRow>
                      <TableHead className="text-xs">Run</TableHead>
                      <TableHead className="text-xs">Campaign</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Attempts</TableHead>
                      <TableHead className="text-xs">Ended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-mono text-[13px]">
                          {run.campaign ? (
                            <Link href={`/campaigns/${run.campaign.code}/runs/${run.number}`} className="text-link hover:underline">
                              {run.code}
                            </Link>
                          ) : (
                            run.code
                          )}
                        </TableCell>
                        <TableCell className="max-w-44 truncate text-[13px]" title={run.campaign?.name ?? undefined}>
                          {run.campaign?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {RUN_STATUS_LABEL[run.status] ?? run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular text-[13px]">
                          {run.attempts_sent} of {run.attempt_budget}
                        </TableCell>
                        <TableCell className="text-[13px]">{run.ended_at ? formatDate(run.ended_at) : "–"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <Card title="Connection">
            <ConnectionSummary target={target} state={connection} />
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Target Profile">
            <p className="text-sm">
              {target.profile_status === null
                ? "Mapped after the ownership check, from a few harmless discovery requests."
                : target.profile_status === "mapping"
                  ? "Sentra is mapping the profile now."
                  : target.profile_status === "reviewed"
                    ? "Reviewed and saved."
                    : target.profile_status === "partial"
                      ? "Mapped only in part; some entries need completing."
                      : target.profile_status === "failed"
                        ? "The mapping did not work. You can enter the profile by hand."
                        : "Mapped and waiting for your review."}
            </p>
            {target.profile_status && (
              <Link href={`/targets/${target.id}/profile`} className="text-sm text-link hover:underline">
                Open the Target Profile
              </Link>
            )}
          </Card>
          <Card title="Threat model">
            <TargetThreatModel targetId={target.id} />
          </Card>
          <Card title="Framework coverage">
            <TargetCoverageSummary targetId={target.id} />
          </Card>
        </div>
      </div>
    </div>
  )
}
