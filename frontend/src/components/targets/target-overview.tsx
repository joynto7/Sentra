"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Pencil, Rocket, ShieldCheck, Waypoints } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { RiskScore, SeverityCountsStrip } from "@/components/sentra/risk-score"
import { ConnectionSummary, TestConnectionButton, useConnectionTest } from "@/components/targets/connection-test"
import { EnvironmentBadge, OwnershipBadge } from "@/components/targets/target-badges"
import { TargetTabs } from "@/components/targets/target-tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api"
import { RUN_STATUS_LABEL, type RunItem, listCampaigns, listRuns } from "@/lib/campaigns"
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
const CAMPAIGNS_READ = 5 // enough for the card; the campaigns page shows them all

function Card({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[10px] border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A card of a page that a later module brings (the sidebar says the same of its items). */
function LaterCard({ title, comesWith }: { title: string; comesWith: string }) {
  return (
    <Card title={title}>
      <p className="text-sm text-muted-foreground">Comes with {comesWith}.</p>
    </Card>
  )
}

/** The target's runs, newest first: its campaigns' runs, which Screen 36 then shows in full. */
async function recentRuns(targetId: string, signal: AbortSignal): Promise<{ run: RunItem; campaign: string }[]> {
  const campaigns = await listCampaigns(new URLSearchParams({ target_id: targetId }))
  const lists = await Promise.all(
    campaigns.slice(0, CAMPAIGNS_READ).map(async (campaign) => {
      const runs = await listRuns(campaign.code, signal).catch(() => [])
      return runs.map((run) => ({ run, campaign: campaign.name }))
    }),
  )
  return lists
    .flat()
    .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at))
    .slice(0, RUNS_SHOWN)
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
  const [runs, setRuns] = useState<{ run: RunItem; campaign: string }[] | null>(null)
  const [mapping, setMapping] = useState(false)

  usePageCrumbs([{ label: target?.name ?? "Target" }])

  useEffect(() => {
    const controller = new AbortController()
    getTarget(id)
      .then(setTarget)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
    getTargetRisk(id, controller.signal).then(setRisk).catch(() => undefined)
    getVerification(id, controller.signal).then(setVerification).catch(() => undefined)
    recentRuns(id, controller.signal).then(setRuns).catch(() => setRuns([]))
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
        description="It doesn't exist, or it belongs to another organization."
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
  const recheck = verification?.recent_checks.find((check) => check.trigger === "campaign_run" && check.status === "passed")

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
            <Badge variant="outline" className="font-normal">
              {TYPE_LABEL[target.type]}
            </Badge>
            <EnvironmentBadge environment={target.environment} />
            <OwnershipBadge status={target.status} />
            {target.is_lab && (
              <Badge variant="outline" className="font-normal">
                Sentra lab
              </Badge>
            )}
          </div>
          <p className="mt-2 font-mono text-[13px] break-all text-muted-foreground">{target.endpoint_url}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered by {target.owner?.name ?? "a former member"} on {formatDate(target.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {verified
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
          {canMap && verified && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-9" aria-label={`More actions for ${target.name}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <TargetTabs targetId={target.id} active="overview" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Risk score">
          {!risk ? (
            <Skeleton className="h-16 w-full" />
          ) : risk.score === null ? (
            <>
              <p className="text-sm text-muted-foreground">{notScoredText(risk.not_scored_reason)}</p>
              <p className="text-xs text-muted-foreground">
                A target is scored after its first campaign run (UC-7.2), and every score is shown with the date of
                that run.
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
                  {risk.awaiting_confirmation} {risk.awaiting_confirmation === 1 ? "finding awaits" : "findings await"}{" "}
                  confirmation and {risk.awaiting_confirmation === 1 ? "is" : "are"} not counted yet.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Open findings">
          {!risk ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <p className="tabular text-3xl font-semibold">{risk.open_total}</p>
              <SeverityCountsStrip counts={risk.open_by_severity} />
              <Link href={`/findings?target_id=${target.id}`} className="text-sm text-link hover:underline">
                View findings
              </Link>
            </>
          )}
        </Card>

        <Card title="Ownership">
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

        <LaterCard title="Sentra Shield" comesWith="Sentra Shield (M8)" />
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
                    {runs.map(({ run, campaign }) => (
                      <TableRow key={run.code}>
                        <TableCell className="font-mono text-[13px]">{run.code}</TableCell>
                        <TableCell className="text-[13px]">{campaign}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {RUN_STATUS_LABEL[run.status] ?? run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular text-[13px]">
                          {run.attempts_sent} of {run.attempt_budget}
                        </TableCell>
                        <TableCell className="text-[13px]">
                          {run.ended_at ? formatDate(run.ended_at) : "–"}
                        </TableCell>
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
          <LaterCard title="Threat model" comesWith="the threat models (M3)" />
          <LaterCard title="Framework coverage" comesWith="the framework coverage view (FR-7.4)" />
        </div>
      </div>
    </div>
  )
}
