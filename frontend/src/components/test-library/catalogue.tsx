"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, ChevronLeft, ChevronRight, Lock, Package, Plus, Search, SlidersHorizontal } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { SeverityBadge, SeverityShape } from "@/components/sentra/severity-badge"
import { SortHeader, type SortDirection } from "@/components/sentra/sort-header"
import { ViewSwitch, useStoredView } from "@/components/sentra/view-switch"
import { useSession } from "@/components/session-provider"
import { FilterGroup, FilterSection } from "@/components/test-library/filter-group"
import { TestCard } from "@/components/test-library/test-cards"
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
import { cn } from "@/lib/utils"

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** "Create custom test" and "Create test suite" in the page header, for the roles that may (FR-1.6). */
export function CatalogueActions() {
  const canCreate = useCan("manage_custom_tests")
  const canBuild = useCan("manage_test_suites")
  if (!canCreate && !canBuild) return null
  return (
    <div className="flex flex-wrap justify-end gap-2 sm:shrink-0">
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

type SortKey = "category" | "id" | "name" | "severity"
// A column's first direction when it is chosen: A to Z for IDs and names, the most severe first
const FIRST_DIRECTION: Record<SortKey, SortDirection> = { category: "asc", id: "asc", name: "asc", severity: "desc" }
const PAGE_SIZES = [10, 25, 50, 100]

// Which columns show at which width of the table's own frame (a container query on the list), so
// the names always keep room: all eight from 864 px (a window of 1,280 px, or 1,440 with the
// filter panel beside the table, also with a scroll bar), Target types and Origin from 672,
// Category from 512. While a column is hidden, what UC-4.1 step 4 asks of the list (category,
// target types, version) and that a custom test is the organization's only show under the name.
const SHOW = {
  category: "hidden @lg/list:table-cell",
  middle: "hidden @2xl/list:table-cell",
  wide: "hidden @min-[54rem]/list:table-cell",
}
const TYPE_COUNT = Object.keys(TARGET_TYPE_LABEL).length

function targetTypesOf(types: string[]): string {
  return types.length === TYPE_COUNT ? "All types" : types.map((t) => TARGET_TYPE_LABEL[t] ?? t).join(", ")
}

/** The test catalogue: coverage, search, filters with counts and the results table (UC-4.1). */
export function TestCatalogue({ coverage }: { coverage: CoverageRow[] | null }) {
  const router = useRouter()
  const organization = useSession().organization?.name ?? "Your organization"
  const canCreate = useCan("manage_custom_tests")
  const [search, setSearch] = useState("")
  const [categories, setCategories] = useState<string[]>([])
  const [severities, setSeverities] = useState<string[]>([])
  const [targetTypes, setTargetTypes] = useState<string[]>([])
  const [origins, setOrigins] = useState<string[]>([])
  const [atlas, setAtlas] = useState("")
  const [sort, setSort] = useState<SortKey>("category")
  const [direction, setDirection] = useState<SortDirection>("asc")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [view, setView] = useStoredView("test-library") // one card for each test (the first look), or the table
  const [data, setData] = useState<Catalogue | null>(null)
  const [answered, setAnswered] = useState("") // the request whose answer is on the screen
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // "Try again" asks once more
  // Below about 1,330 px of window (the menu open) the filter panel folds behind one button, so the
  // table keeps its width
  const [filtersOpen, setFiltersOpen] = useState(false)

  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort, direction })
  if (search.trim()) params.set("search", search.trim())
  categories.forEach((v) => params.append("category", v))
  severities.forEach((v) => params.append("severity", v))
  targetTypes.forEach((v) => params.append("target_type", v))
  origins.forEach((v) => params.append("origin", v))
  if (atlas) params.set("atlas", atlas)
  const request = params.toString()
  // The rows on the screen answer an earlier request: the table says it is busy until the new one comes
  const busy = data !== null && answered !== request

  useEffect(() => {
    const controller = new AbortController()
    // Wait briefly while the user is typing, then ask the API once.
    const timer = setTimeout(() => {
      apiFetch<Catalogue>(`/v1/test-definitions?${request}`, { signal: controller.signal })
        .then((result) => {
          setData(result)
          setAnswered(request)
          setError(null)
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("The test library could not be loaded.")
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request, attempt])

  function changeFilter(setter: (fn: (list: string[]) => string[]) => void, value: string) {
    setter((list) => toggle(list, value))
    setPage(1)
  }

  const activeFilters = categories.length + severities.length + targetTypes.length + origins.length + (atlas ? 1 : 0) + (search.trim() ? 1 : 0)

  function clearFilters() {
    setSearch("")
    setCategories([])
    setSeverities([])
    setTargetTypes([])
    setOrigins([])
    setAtlas("")
    setPage(1)
  }

  function sortBy(column: SortKey) {
    if (column === sort) setDirection((now) => (now === "asc" ? "desc" : "asc"))
    else {
      setSort(column)
      setDirection(FIRST_DIRECTION[column])
    }
    setPage(1)
  }

  const first = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0
  const last = data ? Math.min(data.page * data.page_size, data.total) : 0
  const chosen =
    categories.length + severities.length + targetTypes.length + origins.length + (atlas ? 1 : 0)
  const techniques = Object.entries(data?.facets.atlas ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const sortProps = { sort, direction, onSort: sortBy }
  const categoryNames = Object.fromEntries((coverage ?? []).map((row) => [row.category, row.name]))

  // Beside the table the groups stand one under the other; opened above the table, side by side
  const filters = (
    <div className="grid gap-6 @2xl/catalogue:grid-cols-2 @3xl/catalogue:grid-cols-3 @5xl/catalogue:grid-cols-1">
      {/* Without the coverage (it couldn't be loaded) the tiles and this group stay away; the rest works */}
      {coverage && coverage.length > 0 && (
        <FilterGroup
          title="Category"
          options={coverage.filter((c) => c.in_scope).map((c) => ({ value: c.category, label: c.name, code: c.category }))}
          selected={categories}
          counts={data?.facets.category}
          onToggle={(v) => changeFilter(setCategories, v)}
        />
      )}
      <FilterGroup
        title="Severity"
        options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s], icon: <SeverityShape severity={s} /> }))}
        selected={severities}
        counts={data?.facets.severity}
        onToggle={(v) => changeFilter(setSeverities, v)}
      />
      <FilterGroup
        title="Target type"
        hint="A test can apply to several types. A campaign checks each test against the target you choose and says which ones do not apply."
        options={Object.entries(TARGET_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        selected={targetTypes}
        counts={data?.facets.target_type}
        onToggle={(v) => changeFilter(setTargetTypes, v)}
      />
      {/* UC-4.1 step 3: the framework mapping */}
      <FilterSection title="Framework mapping" count={atlas ? 1 : 0}>
      <div className="space-y-2">
        <label htmlFor="catalogue-atlas" className="block text-sm">
          MITRE ATLAS technique
        </label>
        <select
          id="catalogue-atlas"
          value={atlas}
          onChange={(event) => {
            setAtlas(event.target.value)
            setPage(1)
          }}
          className="h-9 w-full rounded-[7px] border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <option value="">Any</option>
          {techniques.map(([technique, count]) => (
            <option key={technique} value={technique}>
              {technique} ({count})
            </option>
          ))}
          {atlas && !techniques.some(([technique]) => technique === atlas) && <option value={atlas}>{atlas} (0)</option>}
        </select>
      </div>
      </FilterSection>
      <FilterGroup
        title="Origin"
        options={[
          { value: "built_in", label: ORIGIN_LABEL.built_in },
          { value: "custom", label: ORIGIN_LABEL.custom, hint: `${organization} only` },
        ]}
        selected={origins}
        counts={data?.facets.origin}
        onToggle={(v) => changeFilter(setOrigins, v)}
      />
    </div>
  )

  return (
    // A container query: the panel stays beside the table while the page has room for both
    // (1,024 px of content: about 1,330 px of window with the menu open), and folds behind one
    // button below that
    <div className="@container/catalogue space-y-5">

      <div className="grid items-start gap-5 @5xl/catalogue:grid-cols-[220px_minmax(0,1fr)]">
        <aside
          id="catalogue-filters"
          aria-label="Filters"
          className={cn("rounded-[10px] border bg-card p-4 @5xl/catalogue:block", !filtersOpen && "hidden")}
        >
          <h2 className="mb-2 text-[15px] font-semibold">Filters</h2>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2" aria-live="polite">
            <p className="text-xs text-muted-foreground">
              {activeFilters === 0 ? "No filter is applied." : `${activeFilters} ${activeFilters === 1 ? "filter is" : "filters are"} applied.`}
            </p>
            {activeFilters > 0 && (
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
          {/* The groups come together with the categories, so none of them moves down when those
              arrive (the layout jump of Phase 0, CLS 0.199) */}
          {coverage === null ? (
            <div className="space-y-3" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            filters
          )}
        </aside>

        <section aria-label="Test definitions" aria-busy={busy} className="@container/list min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="h-9 @5xl/catalogue:hidden"
              aria-expanded={filtersOpen}
              aria-controls="catalogue-filters"
              onClick={() => setFiltersOpen((now) => !now)}
            >
              <SlidersHorizontal aria-hidden="true" />
              {filtersOpen ? "Hide filters" : "Filters"}
              {chosen > 0 && (
                <span className="tabular rounded-full bg-muted px-1.5 text-xs">
                  {chosen}
                  <span className="sr-only"> chosen</span>
                </span>
              )}
            </Button>
            <label className="relative block min-w-56 flex-1 @3xl/list:max-w-md">
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
            {view === "cards" && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort
                <select
                  value={`${sort}:${direction}`}
                  onChange={(event) => {
                    const [key, dir] = event.target.value.split(":")
                    setSort(key as SortKey)
                    setDirection(dir as SortDirection)
                    setPage(1)
                  }}
                  className="h-9 rounded-[7px] border border-input bg-card px-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <option value="category:asc">Category</option>
                  <option value="severity:desc">Severity, most severe first</option>
                  <option value="severity:asc">Severity, least severe first</option>
                  <option value="name:asc">Name, A to Z</option>
                  <option value="name:desc">Name, Z to A</option>
                  <option value="id:asc">ID, A to Z</option>
                </select>
              </label>
            )}
            <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
              {data ? `${data.total} test ${data.total === 1 ? "definition" : "definitions"}` : ""}
            </span>
            <ViewSwitch value={view} onChange={setView} />
          </div>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {error}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-foreground"
                  onClick={() => {
                    setError(null)
                    setAttempt((n) => n + 1)
                  }}
                >
                  Try again
                </Button>
              </AlertDescription>
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
                  ? "Change the filters."
                  : "Change the filters."
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
            <div className={cn("rounded-[10px] border bg-card transition-opacity", busy && "opacity-60")}>
              {/* Fixed widths on the header's cells (Screen 29's columns): the name's column takes
                  what is left, and a hidden column leaves the table with its cells */}
              {view === "cards" ? (
                <ul className="grid gap-4 rounded-t-[10px] bg-muted/40 p-4 @lg/list:grid-cols-2 @3xl/list:grid-cols-3 @6xl/list:grid-cols-4">
                  {data.items.map((test) => (
                    <li key={test.code} className="min-w-0">
                      <TestCard test={test} categoryName={categoryNames[test.category]} organization={organization} />
                    </li>
                  ))}
                </ul>
              ) : (
              <Table className="table-fixed">
                <TableHeader className="bg-muted">
                  <TableRow>
                    <SortHeader column="id" label="ID" className="w-[112px]" {...sortProps} />
                    <SortHeader column="name" label="Name" {...sortProps} />
                    {/* The rows' first order, so its header says so from the start */}
                    <SortHeader column="category" label="Category" className={cn("w-[88px]", SHOW.category)} {...sortProps} />
                    {/* Room for the longest badge, Informational */}
                    <SortHeader column="severity" label="Severity" className="w-[124px]" {...sortProps} />
                    <TableHead scope="col" className={cn("w-[104px] text-xs whitespace-normal", SHOW.middle)}>
                      Target types
                    </TableHead>
                    <TableHead scope="col" className={cn("w-[144px] text-xs whitespace-normal", SHOW.wide)}>
                      Detection methods
                    </TableHead>
                    <TableHead scope="col" className={cn("w-[64px] text-xs", SHOW.wide)}>
                      Version
                    </TableHead>
                    <TableHead scope="col" className={cn("w-[96px] text-xs", SHOW.middle)}>
                      Origin
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((test) => (
                    <TableRow
                      key={test.code}
                      className="cursor-pointer"
                      onClick={() => router.push(`/test-library/${test.code}`)}
                    >
                      {/* A long ID breaks after a hyphen, not inside its number */}
                      <TableCell className="font-mono text-xs break-words whitespace-normal">{test.code}</TableCell>
                      <TableCell className="text-[13px] font-medium whitespace-normal">
                        <Link
                          href={`/test-library/${test.code}`}
                          className="inline-block min-h-6 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {test.name}
                        </Link>
                        {/* The hidden columns' part of UC-4.1 step 4, each piece while its column is hidden;
                            the version is hidden last, so it ends the line */}
                        <span className="block text-xs font-normal text-muted-foreground @min-[54rem]/list:hidden">
                          <span className="@lg/list:hidden">
                            <span className="font-mono">{test.category}</span> ·{" "}
                          </span>
                          <span className="@2xl/list:hidden">{targetTypesOf(test.target_types)} · </span>
                          <span className="tabular">v{test.version}</span>
                        </span>
                        {test.origin === "custom" && (
                          <span className="flex items-start gap-1 text-xs font-normal text-muted-foreground @2xl/list:hidden">
                            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            Custom, {organization} only
                          </span>
                        )}
                      </TableCell>
                      <TableCell className={cn("font-mono text-xs", SHOW.category)}>{test.category}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={test.severity} />
                      </TableCell>
                      <TableCell className={cn("text-[13px] whitespace-normal", SHOW.middle)}>
                        {targetTypesOf(test.target_types)}
                      </TableCell>
                      <TableCell className={cn("whitespace-normal", SHOW.wide)}>
                        <div className="flex flex-wrap gap-1">
                          {test.detection_methods.map((d) => (
                            <Badge key={d.method} variant="outline" className="font-normal">
                              {DETECTION_LABEL[d.method]}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className={cn("tabular text-[13px]", SHOW.wide)}>v{test.version}</TableCell>
                      <TableCell className={cn("whitespace-normal", SHOW.middle)}>
                        <Badge variant="secondary" className="gap-1 font-normal">
                          {test.origin === "custom" ? (
                            <Building2 className="size-3" aria-hidden="true" />
                          ) : (
                            <Package className="size-3" aria-hidden="true" />
                          )}
                          {ORIGIN_LABEL[test.origin] ?? test.origin}
                        </Badge>
                        {test.origin === "custom" && (
                          <span className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            {organization} only
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5 text-sm">
                <label htmlFor="catalogue-page-size" className="flex items-center gap-2 text-muted-foreground">
                  Rows per page
                  <select
                    id="catalogue-page-size"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value))
                      setPage(1)
                    }}
                    className="h-9 rounded-[7px] border border-input bg-card px-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="tabular ml-auto text-muted-foreground">
                  {first}–{last} of {data.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9"
                    aria-label="Previous page"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9"
                    aria-label="Next page"
                    disabled={last >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight aria-hidden="true" />
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
