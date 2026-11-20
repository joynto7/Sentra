"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"

import { StatusBadge, Reproducibility } from "@/components/findings/finding-badges"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge, type Severity } from "@/components/sentra/severity-badge"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type DetectionMethodResult,
  type FindingDetail,
  type FindingFilters,
  type FindingItem,
  type FindingPage,
  type FindingView,
  VIEW_LABEL,
  findingFilterOptions,
  getFinding,
  listFindings,
} from "@/lib/findings"
import { formatDate } from "@/lib/targets"

const PAGE_SIZE = 25
const VIEWS: FindingView[] = ["open", "requires_confirmation", "closed"]
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"]
const STATUSES = [
  "new",
  "requires_confirmation",
  "confirmed",
  "reopened",
  "false_positive",
  "merged",
  "fixed_and_verified",
] as const

/** The side panel of Screen 38: what a finding is about, before opening it (UC-6.4 step 5). */
function FindingPanel({ code, onClose }: { code: string | null; onClose: () => void }) {
  const [finding, setFinding] = useState<FindingDetail | null>(null)

  useEffect(() => {
    if (!code) return
    const controller = new AbortController()
    getFinding(code, controller.signal)
      .then(setFinding)
      .catch(() => undefined)
    return () => controller.abort()
  }, [code])

  // While another finding is being read, the panel shows its skeleton, not the one before.
  const shown = finding && finding.code === code ? finding : null

  return (
    <Sheet open={code !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-[480px]">
        {shown ? (
          <>
            <SheetHeader>
              <SheetTitle className="text-left">{shown.title}</SheetTitle>
              <SheetDescription className="text-left">
                {shown.code} · {shown.target.name}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={shown.severity} />
                <StatusBadge status={shown.status} />
                <span className="text-xs text-muted-foreground">
                  {shown.category} {shown.category_name}
                </span>
              </div>
              <p className="text-sm text-text-secondary">{shown.description}</p>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Affected component</dt>
                  <dd className="text-right">{shown.component.label}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Detection</dt>
                  <dd className="text-right">
                    {shown.detection
                      ? shown.detection.methods
                          .filter((method: DetectionMethodResult) => method.outcome === "met")
                          .map((method: DetectionMethodResult) => method.method_label)
                          .join(", ") || "None"
                      : "Not evaluated"}
                    {shown.detection?.requires_confirmation ? " only" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Evidence</dt>
                  <dd className="tabular text-right">{shown.evidence_count}</dd>
                </div>
              </dl>
              {shown.detection?.requires_confirmation && (
                <p className="rounded-[7px] border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
                  Only the LLM judge supports this finding. An analyst confirms or rejects it (FR-6.5).
                </p>
              )}
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href={`/findings/${shown.code}`}>Open finding</Link>
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3 p-4" role="status" aria-label="Loading the finding">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Screen 38: the organization's findings (UC-6.4), the most severe first. */
export function FindingsList() {
  const organization = useSession().organization
  const query = useSearchParams()
  // The risk dashboard (Screen 42) links here with the filter behind every number it shows, so
  // the list starts with the view and the filters of that link (UC-7.3 step 6).
  const asked = query.get("view") as FindingView | null
  const [view, setView] = useState<FindingView>(asked && VIEWS.includes(asked) ? asked : "open")
  const [search, setSearch] = useState("")
  const [target, setTarget] = useState(query.get("target_id") ?? "")
  const [severity, setSeverity] = useState(query.get("severity") ?? "")
  const [category, setCategory] = useState(query.get("category") ?? "")
  const [status, setStatus] = useState(query.get("status") ?? "")
  const [runId, setRunId] = useState(query.get("run_id") ?? "")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<FindingPage | null>(null)
  const [options, setOptions] = useState<FindingFilters | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    findingFilterOptions(controller.signal)
      .then(setOptions)
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ view, page: String(page), page_size: String(PAGE_SIZE) })
      if (search.trim()) params.set("search", search.trim())
      if (target) params.set("target_id", target)
      if (severity) params.set("severity", severity)
      if (category) params.set("category", category)
      if (status) params.set("status", status)
      if (runId) params.set("run_id", runId)
      listFindings(params, controller.signal)
        .then((found) => {
          setData(found)
          setError(false)
        })
        .catch(() => !controller.signal.aborted && setError(true))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [view, search, target, severity, category, status, runId, page, attempt])

  const filtered = Boolean(search.trim() || target || severity || category || status || runId)
  const clearFilters = useCallback(() => {
    setSearch("")
    setTarget("")
    setSeverity("")
    setCategory("")
    setStatus("")
    setRunId("")
    setPage(1)
  }, [])
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  const panel = (
    <section aria-label="Findings" className="rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Search findings</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Search by title or ID"
            className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
        <FilterSelect
          label="Target"
          value={target}
          onChange={(value) => {
            setTarget(value)
            setPage(1)
          }}
          options={(options?.targets ?? []).map((row) => ({ value: row.id, label: row.name }))}
        />
        <FilterSelect
          label="Severity"
          value={severity}
          onChange={(value) => {
            setSeverity(value)
            setPage(1)
          }}
          options={SEVERITIES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={(value) => {
            setCategory(value)
            setPage(1)
          }}
          options={(options?.categories ?? []).map((row) => ({ value: row.code, label: `${row.code} ${row.name}` }))}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
          options={STATUSES.map((value) => ({
            value,
            label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
          }))}
        />
        <FilterSelect
          label="Campaign run"
          value={runId}
          onChange={(value) => {
            setRunId(value)
            setPage(1)
          }}
          options={(options?.runs ?? []).map((row) => ({ value: row.id, label: row.code }))}
        />
        {filtered && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
          {data ? `${data.total} ${data.total === 1 ? "finding" : "findings"}` : ""}
        </span>
      </div>

      {error && (
        <div className="p-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The findings could not be loaded.
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {!data && !error && (
        <div className="space-y-2 p-4" role="status" aria-label="Loading findings">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {data && data.total === 0 && (
        <div className="p-4">
          {filtered ? (
            <EmptyState
              title="No findings match these filters"
              description="Remove some filters or change the search."
              action={
                <Button variant="outline" className="h-9" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : view === "closed" ? (
            <EmptyState title="No closed findings" description="Findings that were fixed, merged or rejected appear here." />
          ) : view === "requires_confirmation" ? (
            <EmptyState
              title="Nothing waits for confirmation"
              description="A finding that only the LLM judge supports appears here until an analyst confirms it."
            />
          ) : (
            <EmptyState
              title="No open findings"
              description="Findings appear here while campaign runs test your targets."
              action={
                <Button asChild variant="outline" className="h-9">
                  <Link href="/campaigns">Go to campaigns</Link>
                </Button>
              }
            />
          )}
        </div>
      )}

      {data && data.total > 0 && (
        <>
          <Table
            container={{
              tabIndex: 0,
              role: "group",
              "aria-label": "Findings",
              className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            }}
          >
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="text-xs">Severity</TableHead>
                <TableHead className="text-xs">Finding</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Reproducibility</TableHead>
                <TableHead className="text-xs">Last seen</TableHead>
                <TableHead className="w-24 text-xs">
                  <span className="sr-only">Preview</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((finding: FindingItem) => (
                <TableRow key={finding.code}>
                  <TableCell className="py-2.5">
                    <SeverityBadge severity={finding.severity} />
                  </TableCell>
                  <TableCell className="min-w-56 whitespace-normal">
                    <Link href={`/findings/${finding.code}`} className="text-[13px] font-medium text-link hover:underline">
                      {finding.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{finding.code}</span> · {finding.target.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <span className="font-mono text-xs">{finding.category}</span>
                    <div className="text-xs text-muted-foreground">{finding.category_name}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={finding.status} />
                  </TableCell>
                  <TableCell>
                    <Reproducibility value={finding.reproducibility} />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {formatDate(finding.last_seen_at)}
                    <div className="font-mono text-xs text-muted-foreground">{finding.last_run.code}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(finding.code)}>
                      Preview
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <nav aria-label="Pages" className="flex items-center justify-end gap-3 border-t px-4 py-2.5 text-sm">
            <span className="tabular text-muted-foreground">
              {(data.page - 1) * data.page_size + 1}–{Math.min(data.page * data.page_size, data.total)} of{" "}
              {data.total}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </section>
  )

  return (
    <>
      <PageHeader
        title="Findings"
        description={`Weaknesses found in ${organization?.name ?? "your organization"}'s targets, with evidence.`}
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as FindingView)
          setPage(1)
        }}
        className="gap-4"
      >
        <TabsList variant="line" aria-label="Findings" className="h-10 w-full justify-start gap-6 border-b px-0">
          {VIEWS.map((value) => (
            <TabsTrigger key={value} value={value} className="flex-none gap-2 px-0.5">
              {VIEW_LABEL[value]}
              <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {data ? (data.counts[value] ?? 0) : "–"}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {VIEWS.map((value) => (
          <TabsContent
            key={value}
            value={value}
            className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {panel}
          </TabsContent>
        ))}
      </Tabs>


      <FindingPanel code={selected} onClose={() => setSelected(null)} />
    </>
  )
}
