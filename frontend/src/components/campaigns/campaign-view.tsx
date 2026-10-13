"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { EnvironmentBadge } from "@/components/targets/target-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { type CampaignDetail, formatCount, getCampaign, windowText } from "@/lib/campaigns"
import { TYPE_LABEL, type Environment, type TargetType } from "@/lib/targets"
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

/** A saved campaign: its target, suites, limits and estimate (UC-5.1). Runs come with FR-5.4. */
export function CampaignView({ code }: { code: string }) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [notFound, setNotFound] = useState(false)

  usePageCrumbs([{ label: campaign?.name ?? code }])

  useEffect(() => {
    getCampaign(code)
      .then(setCampaign)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
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
      <div>
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
          <Card title="Runs">
            <p className="text-sm text-muted-foreground">Not run yet.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
