"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Lock, Plus, Search } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { useSession } from "@/components/session-provider"
import { CoverageStrip } from "@/components/test-library/coverage-strip"
import { FilterGroup } from "@/components/test-library/filter-group"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiFetch } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type Catalogue,
  type CoverageRow,
  DETECTION_LABEL,
  ORIGIN_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  TARGET_TYPE_LABEL,
} from "@/lib/test-library"

const PAGE_SIZE = 25

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** "Create custom test" and "Create test suite" in the page header, for the roles that may (FR-1.6). */
export function CatalogueActions() {
  const canCreate = useCan("manage_custom_tests")
  const canBuild = useCan("manage_test_suites")
  if (!canCreate && !canBuild) return null
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-2">
      {canBuild && (
        <Button asChild variant="outline" className="h-9">
          <Link href="/test-library/suites/new">Create test suite</Link>
        </Button>
      )}
      {canCreate && (
        <Button asChild className="h-9 hover:bg-primary-hover">
          <Link href="/test-library/new">
            <Plus aria-hidden="true" />
            Create custom test
          </Link>
        </Button>
      )}
    </div>
  )
}

/** The test catalogue: coverage, search, filters with counts and the results table (UC-4.1). */
export function TestCatalogue({ coverage }: { coverage: CoverageRow[] }) {
  const router = useRouter()
  const organization = useSession().organization?.name ?? "Your organization"
  const canCreate = useCan("manage_custom_tests")
  const [search, setSearch] = useState("")
  const [categories, setCategories] = useState<string[]>([])
  const [severities, setSeverities] = useState<string[]>([])
  const [targetTypes, setTargetTypes] = useState<string[]>([])
  const [origins, setOrigins] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Catalogue | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    // Wait briefly while the user is typing, then ask the API once.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
      if (search.trim()) params.set("search", search.trim())
      categories.forEach((v) => params.append("category", v))
      severities.forEach((v) => params.append("severity", v))
      targetTypes.forEach((v) => params.append("target_type", v))
      origins.forEach((v) => params.append("origin", v))
      apiFetch<Catalogue>(`/v1/test-definitions?${params}`, { signal: controller.signal })
        .then((result) => {
          setData(result)
          setError(null)
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("The test library could not be loaded. Try again.")
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search, categories, severities, targetTypes, origins, page])

  function changeFilter(setter: (fn: (list: string[]) => string[]) => void, value: string) {
    setter((list) => toggle(list, value))
    setPage(1)
  }

  function clearFilters() {
    setSearch("")
    setCategories([])
    setSeverities([])
    setTargetTypes([])
    setOrigins([])
    setPage(1)
  }

  const first = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0
  const last = data ? Math.min(data.page * data.page_size, data.total) : 0

  return (
    <div className="space-y-5">
      {coverage.length > 0 && (
        <CoverageStrip rows={coverage} selected={categories} onToggle={(c) => changeFilter(setCategories, c)} />
      )}

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-6 rounded-[10px] border bg-card p-4" aria-label="Filters">
          <FilterGroup
            title="Category"
            options={coverage.filter((c) => c.in_scope).map((c) => ({ value: c.category, label: `${c.category} ${c.name}` }))}
            selected={categories}
            counts={data?.facets.category}
            onToggle={(v) => changeFilter(setCategories, v)}
          />
          <FilterGroup
            title="Severity"
            options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))}
            selected={severities}
            counts={data?.facets.severity}
            onToggle={(v) => changeFilter(setSeverities, v)}
          />
          <FilterGroup
            title="Target type"
            hint="A test can apply to several types."
            options={Object.entries(TARGET_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            selected={targetTypes}
            counts={data?.facets.target_type}
            onToggle={(v) => changeFilter(setTargetTypes, v)}
          />
          <FilterGroup
            title="Origin"
            options={[
              { value: "built_in", label: ORIGIN_LABEL.built_in },
              { value: "custom", label: ORIGIN_LABEL.custom },
            ]}
            selected={origins}
            counts={data?.facets.origin}
            onToggle={(v) => changeFilter(setOrigins, v)}
          />
        </aside>

        <section className="min-w-0 space-y-3">
          <label className="relative block max-w-md">
            <span className="sr-only">Search tests</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by name, ID or MITRE ATLAS technique"
              className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </label>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!data && !error && (
            <div className="space-y-2" role="status" aria-label="Loading tests">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {data && data.total === 0 && (
            <EmptyState
              title="No tests match these filters"
              description={
                canCreate
                  ? "Remove some filters or change the search. If the test you need doesn't exist, create it."
                  : "Remove some filters or change the search."
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" className="h-9" onClick={clearFilters}>
                    Clear filters
                  </Button>
                  {canCreate && (
                    <Button asChild variant="outline" className="h-9">
                      <Link href="/test-library/new">Create custom test</Link>
                    </Button>
                  )}
                </div>
              }
            />
          )}

          {data && data.total > 0 && (
            <div className="rounded-[10px] border bg-card">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs">Severity</TableHead>
                    <TableHead className="text-xs">Target types</TableHead>
                    <TableHead className="text-xs">Detection methods</TableHead>
                    <TableHead className="text-right text-xs">Version</TableHead>
                    <TableHead className="text-xs">Origin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((test) => (
                    <TableRow
                      key={test.code}
                      className="cursor-pointer"
                      onClick={() => router.push(`/test-library/${test.code}`)}
                    >
                      <TableCell className="font-mono text-xs whitespace-nowrap">{test.code}</TableCell>
                      <TableCell className="min-w-56 text-[13px] font-medium whitespace-normal">
                        <Link href={`/test-library/${test.code}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {test.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{test.category}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={test.severity} />
                      </TableCell>
                      <TableCell className="text-[13px] whitespace-normal">
                        {test.target_types.length === 3
                          ? "All types"
                          : test.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", ")}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {test.detection_methods.map((d) => (
                            <Badge key={d.method} variant="outline" className="font-normal">
                              {DETECTION_LABEL[d.method]}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-right text-[13px]">v{test.version}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {ORIGIN_LABEL[test.origin] ?? test.origin}
                        </Badge>
                        {test.origin === "custom" && (
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
              <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm">
                <span className="tabular text-muted-foreground">
                  {first}–{last} of {data.total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={last >= data.total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
