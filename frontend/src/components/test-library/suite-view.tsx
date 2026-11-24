"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Lock } from "lucide-react"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { useSession } from "@/components/session-provider"
import { ArchiveSuiteDialog } from "@/components/test-library/archive-suite-dialog"
import { SuiteSummaryCard } from "@/components/test-library/suite-summary-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { type CampaignItem, listCampaigns } from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import {
  CATEGORIES,
  ORIGIN_LABEL,
  type SuiteDetail,
  type SuiteTest,
  TARGET_TYPE_LABEL,
  formatDate,
  getSuite,
} from "@/lib/test-library"
import { cn } from "@/lib/utils"

const SUITES = { label: "Test Suites", href: "/test-library?tab=suites" }

/** The tests of a suite, grouped by OWASP category in the order of the catalogue. */
export function groupByCategory<T extends { category: string }>(tests: T[]): { category: string; label: string; tests: T[] }[] {
  return CATEGORIES.map((c) => ({ category: c.value, label: c.label, tests: tests.filter((t) => t.category === c.value) })).filter(
    (group) => group.tests.length > 0,
  )
}

/** A test suite, current or an earlier version (UC-4.1, 5a): its tests, what they cover, its versions. */
export function SuiteView({ code, version }: { code: string; version?: number }) {
  const organization = useSession().organization?.name ?? "your organization"
  const canBuild = useCan("manage_test_suites")
  const [suite, setSuite] = useState<SuiteDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignItem[] | null>(null)

  usePageCrumbs(
    version
      ? [SUITES, { label: suite?.name ?? code, href: `/test-library/suites/${code}` }, { label: `v${version}` }]
      : [SUITES, { label: suite?.name ?? code }],
  )

  const load = useCallback(() => {
    getSuite(code, version)
      .then(setSuite)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [code, version])
  useEffect(load, [load])

  // The campaigns that use this suite (UC-4.5 step 2).
  useEffect(() => {
    listCampaigns(new URLSearchParams({ suite: code }))
      .then(setCampaigns)
      .catch(() => setCampaigns([]))
  }, [code])

  if (notFound) {
    return (
      <EmptyState
        title="Test suite not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/test-library?tab=suites">Back to the test suites</Link>
          </Button>
        }
      />
    )
  }
  if (!suite) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading test suite">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const custom = suite.origin === "custom"
  const archived = suite.status === "archived"
  const duplicate = `/test-library/suites/new?from=${encodeURIComponent(suite.code)}`
  const found = suite.tests.filter((t): t is SuiteTest => t.found)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{suite.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{suite.code}</span>
            <Badge variant="secondary" className="font-normal">
              {ORIGIN_LABEL[suite.origin] ?? suite.origin}
            </Badge>
            {custom && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                {organization} only
              </span>
            )}
            <Badge variant="outline" className="font-normal">
              v{suite.version} · {suite.is_current ? "current" : "earlier version"}
            </Badge>
            {archived && (
              <Badge variant="outline" className="border-warning/60 font-normal text-warning">
                Archived
              </Badge>
            )}
          </div>
        </div>
        {canBuild && suite.is_current && !archived && (
          <div className="flex flex-wrap gap-2">
            {custom ? (
              <>
                <Button asChild className="h-9 hover:bg-primary-hover">
                  <Link href={`/test-library/suites/${encodeURIComponent(suite.code)}/edit`}>Edit</Link>
                </Button>
                <Button asChild variant="outline" className="h-9">
                  <Link href={duplicate}>Duplicate</Link>
                </Button>
                <Button variant="outline" className="h-9 text-destructive" onClick={() => setArchiving(true)}>
                  Archive
                </Button>
              </>
            ) : (
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href={duplicate}>Duplicate as custom suite</Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {!suite.is_current ? (
        <Alert>
          <AlertDescription>
            You&apos;re viewing version {suite.version}, which is no longer current.{" "}
            <Link href={`/test-library/suites/${suite.code}`} className="font-medium text-link hover:underline">
              View the current version
            </Link>
          </AlertDescription>
        </Alert>
      ) : archived ? (
        <Alert>
          <AlertDescription>
            This suite is archived: it can&apos;t be chosen for new campaigns. Past results still show it.
          </AlertDescription>
        </Alert>
      ) : (
        !custom && (
          <Alert>
            <AlertDescription>Built-in suites are read-only. Duplicate one to change it.</AlertDescription>
          </Alert>
        )
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 rounded-[10px] border bg-card p-6">
          <section className="space-y-1.5">
            <h2 className="text-[15px] font-semibold">Purpose</h2>
            <p className="text-sm text-text-secondary">{suite.purpose}</p>
          </section>
          <section aria-labelledby="suite-tests-heading" className="space-y-3">
            <h2 id="suite-tests-heading" className="text-[15px] font-semibold">
              Tests ({suite.test_codes.length})
            </h2>
            {groupByCategory(found).map((group) => (
              <div key={group.category} className="space-y-1.5">
                <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
                <ul className="divide-y rounded-[10px] border">
                  {group.tests.map((test) => (
                    <li key={test.code} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm", test.retired && "bg-muted/50")}>
                      <Link href={`/test-library/${test.code}`} className="w-32 shrink-0 font-mono text-xs text-link hover:underline">
                        {test.code}
                      </Link>
                      <span className="min-w-0 flex-1">{test.name}</span>
                      {test.retired ? (
                        <span className="text-xs text-warning">Retired: skipped in future runs</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {test.target_types.length === 3 ? "All types" : test.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", ")}
                        </span>
                      )}
                      <SeverityBadge severity={test.severity} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <div className="space-y-5">
          <SuiteSummaryCard summary={suite} />
          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Used by</h2>
            {campaigns === null ? (
              <p className="text-sm text-muted-foreground">Loading the campaigns…</p>
            ) : campaigns.length ? (
              <ul className="space-y-1.5 text-sm">
                {campaigns.map((campaign) => (
                  <li key={campaign.code} className="flex items-baseline gap-2">
                    <Link href={`/campaigns/${campaign.code}`} className="text-link hover:underline">
                      {campaign.name}
                    </Link>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{campaign.code}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No campaign uses it yet.</p>
            )}
          </section>
          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Version history</h2>
            <ul className="space-y-2.5">
              {suite.versions.map((v) => (
                <li key={v.version} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={v.is_current ? `/test-library/suites/${suite.code}` : `/test-library/suites/${suite.code}?version=${v.version}`}
                      className={cn("font-medium hover:underline", v.version === suite.version ? "text-foreground" : "text-link")}
                      aria-current={v.version === suite.version ? "page" : undefined}
                    >
                      v{v.version}
                      {v.is_current ? " · current" : ""}
                    </Link>
                    {v.status === "archived" && <span className="text-xs text-warning">archived</span>}
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(v.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{v.change_note}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {archiving && (
        <ArchiveSuiteDialog
          suite={suite}
          campaigns={campaigns ?? []}
          open={archiving}
          onOpenChange={setArchiving}
          onArchived={(archivedSuite) => setSuite(archivedSuite)}
        />
      )}
    </div>
  )
}
