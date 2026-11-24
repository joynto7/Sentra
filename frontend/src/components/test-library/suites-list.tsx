"use client"

import Link from "next/link"
import { Lock } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { ViewSwitch, useStoredView } from "@/components/sentra/view-switch"
import { SuiteCard } from "@/components/test-library/test-cards"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ORIGIN_LABEL, type SuiteItem, aboutAttempts } from "@/lib/test-library"

/** The "Test suites" tab of Screen 29 (UC-4.1 step 2, alternative 5a). */
export function SuitesList({ suites, organization }: { suites: SuiteItem[] | null; organization: string }) {
  const [view, setView] = useStoredView("test-library")
  if (!suites) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading test suites">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  if (suites.length === 0) {
    return <EmptyState title="No test suites yet" description="Suites group tests." />
  }
  return (
    <section aria-label="Test suites" className="@container rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <p className="tabular text-sm text-muted-foreground">
          {suites.length} {suites.length === 1 ? "test suite" : "test suites"}
        </p>
        <ViewSwitch value={view} onChange={setView} />
      </div>
      {view === "cards" ? (
        <ul className="grid gap-4 bg-muted/40 p-4 @lg:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
          {suites.map((suite) => (
            <li key={suite.code} className="min-w-0">
              <SuiteCard suite={suite} organization={organization} />
            </li>
          ))}
        </ul>
      ) : (
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="hidden text-xs @3xl:table-cell">Covers</TableHead>
              <TableHead className="text-right text-xs">Tests</TableHead>
              <TableHead className="hidden text-right text-xs @2xl:table-cell">Attempts per run</TableHead>
              <TableHead className="text-right text-xs">Version</TableHead>
              <TableHead className="text-xs">Origin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suites.map((suite) => (
              <TableRow key={suite.code}>
                <TableCell className="max-w-md min-w-56 py-2.5 whitespace-normal">
                  <Link href={`/test-library/suites/${suite.code}`} className="text-[13px] font-medium hover:underline">
                    {suite.name}
                  </Link>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{suite.purpose}</p>
                  <p className="text-xs text-muted-foreground @3xl:hidden">
                    Covers <span className="font-mono">{suite.categories.join(", ")}</span>
                    <span className="@2xl:hidden"> · {aboutAttempts(suite.estimated_attempts)} attempts per run</span>
                  </p>
                </TableCell>
                <TableCell className="hidden font-mono text-xs whitespace-normal @3xl:table-cell">
                  {suite.categories.join(", ")}
                </TableCell>
                <TableCell className="tabular text-right text-[13px]">{suite.test_count}</TableCell>
                <TableCell className="tabular hidden text-right text-[13px] @2xl:table-cell">
                  {aboutAttempts(suite.estimated_attempts)}
                </TableCell>
                <TableCell className="tabular text-right text-[13px]">v{suite.version}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {ORIGIN_LABEL[suite.origin] ?? suite.origin}
                  </Badge>
                  {suite.origin === "custom" && (
                    <span className="mt-1 flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
                      <Lock className="size-3" aria-hidden="true" />
                      {organization} only
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
