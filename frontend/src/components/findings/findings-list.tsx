"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, CircleHelp, PanelRightOpen, Search, X } from "lucide-react"

import { StatusBadge } from "@/components/findings/finding-badges"
import { FindingPreview } from "@/components/findings/finding-preview"
import { SeverityStrip } from "@/components/findings/severity-strip"
import { TriagePanel } from "@/components/findings/triage-panel"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge, type Severity } from "@/components/sentra/severity-badge"
import { SortHeader, type SortDirection } from "@/components/sentra/sort-header"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { refused, useKeptAnswer, useKeptScroll } from "@/hooks/use-kept-list"
import { useUrlState } from "@/hooks/use-url-state"
import {
  type FindingDetail,
  type FindingFilters,
  type FindingItem,
  type FindingPage,
  type FindingView,
  PERIOD_FILTERS,
  type PeriodFilters,
  VIEW_LABEL,
  findingFilterOptions,
  listFindings,
} from "@/lib/findings"
import { formatDate } from "@/lib/targets"

const PAGE_SIZE = 25
const VIEWS: FindingView[] = ["open", "assigned", "requires_confirmation", "closed"]
// Views a link can open that have no tab of their own (from the Risk Dashboard's totals)
const LINKED_VIEWS: FindingView[] = ["all", "awaiting_triage", "awaiting_remediation"]
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

/** The columns the table sorts by, on the server, and the way each one is first sorted when it
 * is chosen: the most severe, the most reproducible and the most recent first, names A to Z. */
type SortKey = "severity" | "title" | "category" | "status" | "reproducibility" | "owner" | "last_seen"
const FIRST_DIRECTION: Record<SortKey, SortDirection> = {
  severity: "desc",
  title: "asc",
  category: "asc",
  status: "asc",
  reproducibility: "desc",
  owner: "asc",
  last_seen: "desc",
}
const SORT_KEYS = Object.keys(FIRST_DIRECTION) as SortKey[]
// The same orders as words, for the card list, which has no column headers to press
const SORT_CHOICES: { value: string; label: string }[] = [
  { value: "severity:desc", label: "Most severe first" },
  { value: "severity:asc", label: "Least severe first" },
  { value: "last_seen:desc", label: "Last seen, newest first" },
  { value: "last_seen:asc", label: "Last seen, oldest first" },
  { value: "reproducibility:desc", label: "Most reproducible first" },
  { value: "title:asc", label: "Finding, A to Z" },
  { value: "category:asc", label: "Category" },
  { value: "status:asc", label: "Status" },
  { value: "owner:asc", label: "Owner, A to Z" },
]

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("")

/** "First seen 12 Aug – 27 Aug", "Closed since 12 Aug": a period filter in words. */
function periodText(kind: "First seen" | "Closed", from?: string, until?: string): string | null {
  if (!from && !until) return null
  if (from && until) return `${kind} ${shortDate(from)} – ${shortDate(until)}`
  return from ? `${kind} since ${shortDate(from)}` : `${kind} before ${shortDate(until as string)}`
}

/** "9/10" as Screen 38 writes it: successful attempts of those that tried the weakness (FR-6.4 (M6)),
 * with a thin bar; the words for screen readers. A measurement that couldn't finish says so. */
function Reproducibility({ finding }: { finding: FindingItem }) {
  if (finding.reproducibility === null) {
    return <span className="text-[13px] text-muted-foreground">Not rated yet</span>
  }
  const measured = finding.repetitions
  const share = measured
    ? measured.successes / Math.max(1, measured.attempts)
    : Math.max(0, Math.min(1, Number(finding.reproducibility)))
  return (
    <div className="w-16">
      <span className="tabular text-[13px]" aria-hidden="true">
        {measured ? `${measured.successes}/${measured.attempts}` : `${Math.round(share * 100)} %`}
      </span>
      <span className="sr-only">{measured ? measured.label : `${Math.round(share * 100)} %`}</span>
      {measured?.status === "incomplete" && <span className="block text-xs text-muted-foreground">incomplete</span>}
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-foreground/60" style={{ width: `${Math.max(share * 100, 2)}%` }} />
      </div>
    </div>
  )
}

/** The owner as on Screen 38: an avatar, with the first name beside it and the whole name for
 * screen readers. */
function Owner({ finding }: { finding: FindingItem }) {
  if (!finding.owner) return <span className="text-[13px] text-muted-foreground">Unassigned</span>
  const name = finding.owner.name
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={name}>
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-secondary"
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span className="truncate text-[13px]" aria-hidden="true">
        {name.split(/\s+/)[0]}
      </span>
      <span className="sr-only">{name}</span>
    </span>
  )
}

/** The mark of UC-6.4, 2b: only the LLM judge supported the finding, so an analyst confirms it.
 * Dashed, like its status, and in words, so it never rests on colour (NFR-4.3). */
function JudgeOnly() {
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 rounded-[5px] border border-dashed border-warning/60 px-1.5 text-xs text-warning">
      <CircleHelp className="size-3.5 shrink-0" aria-hidden="true" />
      Only the LLM judge supports this finding
    </span>
  )
}

/** The order of the list in words, for screen readers when it changes. */
const SORT_WORDS: Record<SortKey, [string, string]> = {
  severity: ["least severe first", "most severe first"],
  title: ["by finding, A to Z", "by finding, Z to A"],
  category: ["by category, LLM01 first", "by category, LLM10 first"],
  status: ["by status, new first", "by status, closed first"],
  reproducibility: ["least reproducible first", "most reproducible first"],
  owner: ["by owner, A to Z", "by owner, Z to A"],
  last_seen: ["last seen, oldest first", "last seen, newest first"],
}

/** The Preview button of a finding that can be seen: the table's or the card's, whichever shows. */
function previewButtonOf(code: string | null) {
  if (!code) return null
  return (
    [...document.querySelectorAll<HTMLElement>(`[data-preview="${code}"]`)].find(
      (button) => button.offsetParent !== null,
    ) ?? null
  )
}

/** Screen 38: the organization's findings (UC-6.4), the most severe first. */
export function FindingsList({ targetId }: { targetId?: string } = {}) {
  // When the address changes without the list (the menu's Findings link, Back or Forward), the
  // list starts again from the new address, as if the page had just been opened
  const [opened, setOpened] = useState(0)
  return <ListFromAddress key={opened} targetId={targetId} onOutside={() => setOpened((count) => count + 1)} />
}

function ListFromAddress({ targetId, onOutside }: { targetId?: string; onOutside: () => void }) {
  const organization = useSession().organization
  const query = useSearchParams()
  // The list starts as its address says: a link from the Risk Dashboard (UC-7.3 step 6), a
  // reload, or a link somebody shared
  const asked = query.get("view") as FindingView | null
  const [view, setView] = useState<FindingView>(
    asked && (VIEWS.includes(asked) || LINKED_VIEWS.includes(asked)) ? asked : "open",
  )
  const [period, setPeriod] = useState<PeriodFilters>(() =>
    Object.fromEntries(PERIOD_FILTERS.flatMap((key) => (query.get(key) ? [[key, query.get(key) as string]] : []))),
  )
  const [search, setSearch] = useState("")
  // Inside a target's tabs the list shows only that target, so it has no target filter.
  const [target, setTarget] = useState(targetId ?? query.get("target_id") ?? "")
  const [severity, setSeverity] = useState(query.get("severity") ?? "")
  const [category, setCategory] = useState(query.get("category") ?? "")
  const [status, setStatus] = useState(query.get("status") ?? "")
  const [runId, setRunId] = useState(query.get("run_id") ?? "")
  const [owner, setOwner] = useState(query.get("owner_id") ?? "")
  const askedSort = query.get("sort") as SortKey | null
  const [sort, setSort] = useState<SortKey>(askedSort && SORT_KEYS.includes(askedSort) ? askedSort : "severity")
  const [direction, setDirection] = useState<SortDirection>(() => {
    const value = query.get("direction")
    return value === "asc" || value === "desc" ? value : FIRST_DIRECTION[sort]
  })
  const [page, setPage] = useState(() => Math.max(1, Number(query.get("page")) || 1))
  // What the API is asked for: also the key of the answer kept for Back (UX task 3.0), so coming
  // back shows the list at once and where the reader was in it, and refreshes it behind
  const request = (() => {
    const params = new URLSearchParams({ view, page: String(page), page_size: String(PAGE_SIZE), sort, direction })
    if (search.trim()) params.set("search", search.trim())
    if (target) params.set("target_id", target)
    if (severity) params.set("severity", severity)
    if (category) params.set("category", category)
    if (status) params.set("status", status)
    if (runId) params.set("run_id", runId)
    if (owner) params.set("owner_id", owner)
    for (const [key, value] of Object.entries(period)) if (value) params.set(key, value)
    return params.toString()
  })()
  const [kept, keep, drop] = useKeptAnswer<FindingPage>(`findings?${request}`)
  const [data, setData] = useState<FindingPage | null>(kept)
  useKeptScroll(`findings${targetId ? `:${targetId}` : ""}`, `findings?${request}`, data !== null)
  const [options, setOptions] = useState<FindingFilters | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  // "Next" at the end of a page opens the next page and then its first finding
  const selectOnLoad = useRef<"first" | "last" | null>(null)
  // The finding last previewed: closing the panel, or the triage after it, returns there
  const previewed = useRef<string | null>(null)
  const preview = (code: string | null) => {
    if (code) previewed.current = code
    setSelected(code)
  }
  // The count above the list: where the keyboard goes when the finding is no longer on this page
  const countLine = useRef<HTMLSpanElement>(null)
  const returnFocus = () => previewButtonOf(previewed.current) ?? countLine.current
  // The finding whose triage panel is open (Screen 41)
  const [triaging, setTriaging] = useState<FindingDetail | null>(null)
  // After a triage the list loads again, and a finding that left this view takes its row and the
  // Preview button the keyboard was on with it
  const afterTriage = useRef(false)

  // Everything but the search words goes in the address: what people search for stays out of the
  // browser's history, as in the search box of the top bar. A sort's own first direction is left
  // out, so "sort=title" reads A to Z.
  useUrlState(
    {
      view,
      target_id: targetId ? "" : target,
      severity,
      category,
      status,
      run_id: runId,
      owner_id: owner,
      ...Object.fromEntries(PERIOD_FILTERS.map((key) => [key, period[key] ?? ""])),
      sort,
      direction,
      page: String(page),
    },
    { view: "open", sort: "severity", direction: FIRST_DIRECTION[sort], page: "1" },
    onOutside,
  )

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
      listFindings(new URLSearchParams(request), controller.signal)
        .then((found) => {
          // A page beyond the last one (an old link, or a list that shrank after a triage) opens
          // the last page instead of an empty table
          if (!found.items.length && found.total > 0 && found.page > 1) {
            setPage(Math.ceil(found.total / found.page_size))
            return
          }
          setData(found)
          keep(found)
          setError(false)
          if (selectOnLoad.current && found.items.length) {
            preview(found.items[selectOnLoad.current === "first" ? 0 : found.items.length - 1].code)
          }
          selectOnLoad.current = null
        })
        .catch((problem) => {
          if (controller.signal.aborted) return
          // A list the reader may no longer read leaves the page and the memory (UX task 3.0)
          if (refused(problem)) {
            drop()
            setData(null)
          }
          setError(true)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request, keep, drop, attempt])

  // If the triaged finding's row went, the keyboard went with it: it goes to the count above the
  // list instead of the top of the page (WCAG 2.4.3)
  useEffect(() => {
    if (!data || !afterTriage.current) return
    afterTriage.current = false
    if (document.activeElement === document.body) (previewButtonOf(previewed.current) ?? countLine.current)?.focus()
  }, [data])

  const periods = [
    { keys: ["first_seen_from", "first_seen_until"] as const, text: periodText("First seen", period.first_seen_from, period.first_seen_until) },
    { keys: ["closed_from", "closed_until"] as const, text: periodText("Closed", period.closed_from, period.closed_until) },
  ].filter((one) => one.text)
  const filtered = Boolean(
    search.trim() || (target && !targetId) || severity || category || status || runId || owner || periods.length,
  )
  const clearFilters = useCallback(() => {
    setSearch("")
    setTarget(targetId ?? "")
    setSeverity("")
    setCategory("")
    setStatus("")
    setRunId("")
    setOwner("")
    setPeriod({})
    setPage(1)
  }, [targetId])
  // What a link from the Risk Dashboard narrowed the list to, each removable on its own
  const chips = [
    ...(LINKED_VIEWS.includes(view) ? [{ text: VIEW_LABEL[view], remove: () => setView("open") }] : []),
    ...periods.map((one) => ({
      text: one.text as string,
      remove: () =>
        setPeriod((current) =>
          Object.fromEntries(Object.entries(current).filter(([key]) => !(one.keys as readonly string[]).includes(key))),
        ),
    })),
  ]
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const sortBy = (column: SortKey) => {
    setDirection(column === sort ? (direction === "asc" ? "desc" : "asc") : FIRST_DIRECTION[column])
    setSort(column)
    setPage(1)
  }
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value)
    setPage(1)
  }

  // Where the previewed finding stands in the list, for "3 of 40" and Previous / Next
  const items = data?.items ?? []
  const index = selected ? items.findIndex((item) => item.code === selected) : -1
  const position = index >= 0 && data ? `${(data.page - 1) * data.page_size + index + 1} of ${data.total}` : ""
  const onPrevious =
    index > 0
      ? () => preview(items[index - 1].code)
      : index === 0 && page > 1
        ? () => {
            selectOnLoad.current = "last"
            setPage(page - 1)
          }
        : undefined
  const onNext =
    index >= 0 && index < items.length - 1
      ? () => preview(items[index + 1].code)
      : index === items.length - 1 && page < pages
        ? () => {
            selectOnLoad.current = "first"
            setPage(page + 1)
          }
        : undefined
  const sortProps = { sort, direction, onSort: sortBy }

  const panel = (
    // The table needs about 900 px; a narrower list, such as a phone, gets one card per finding
    <section aria-label="Findings" className="@container rounded-[10px] border bg-card">
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
        {!targetId && (
          <FilterSelect
            label="Target"
            value={target}
            onChange={filter(setTarget)}
            options={(options?.targets ?? []).map((row) => ({ value: row.id, label: row.name }))}
          />
        )}
        <FilterSelect
          label="Severity"
          value={severity}
          onChange={filter(setSeverity)}
          options={SEVERITIES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={filter(setCategory)}
          options={(options?.categories ?? []).map((row) => ({ value: row.code, label: `${row.code} ${row.name}` }))}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={filter(setStatus)}
          options={STATUSES.map((value) => ({
            value,
            label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
          }))}
        />
        <FilterSelect
          label="Campaign run"
          value={runId}
          onChange={filter(setRunId)}
          options={(options?.runs ?? []).map((row) => ({ value: row.id, label: row.code }))}
        />
        <FilterSelect
          label="Owner"
          value={owner}
          onChange={filter(setOwner)}
          options={(options?.owners ?? []).map((row) => ({ value: row.id, label: row.name }))}
        />
        {chips.map((chip) => (
          <span
            key={chip.text}
            className="inline-flex h-9 items-center gap-1 rounded-[7px] border border-input bg-accent pr-1 pl-3 text-sm text-accent-foreground"
          >
            {chip.text}
            <button
              type="button"
              onClick={() => {
                chip.remove()
                setPage(1)
              }}
              className="inline-flex size-7 items-center justify-center rounded-[5px] hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Remove the filter: ${chip.text}`}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        {filtered && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <span
          ref={countLine}
          tabIndex={-1}
          className="tabular ml-auto rounded-[5px] text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-live="polite"
        >
          {data ? `${data.total} ${data.total === 1 ? "finding" : "findings"}` : ""}
          {data && <span className="sr-only">, {SORT_WORDS[sort][direction === "asc" ? 0 : 1]}</span>}
        </span>
      </div>

      <SeverityStrip counts={data?.severity_counts} chosen={severity} onChoose={filter(setSeverity)} />

      {data?.mine_first && data.total > 0 && (
        <p className="border-b px-3 py-2 text-[13px] text-muted-foreground">
          The findings assigned to you come first, then the most severe.
        </p>
      )}

      {error && (
        <div className="p-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The findings could not be loaded.
              <Button variant="outline" size="sm" className="h-9 text-foreground" onClick={() => setAttempt((n) => n + 1)}>
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
          ) : view === "assigned" ? (
            <EmptyState title="Nothing is assigned to you" description="A finding appears here once an analyst makes you its owner." />
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
          <div className="hidden @4xl:block">
            <Table
              className="table-fixed"
              container={{
                tabIndex: 0,
                role: "group",
                "aria-label": "Findings table",
                className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              }}
            >
              <TableHeader className="bg-muted">
                <TableRow>
                  <SortHeader column="severity" label="Severity" className="w-[104px]" {...sortProps} />
                  <SortHeader column="title" label="Finding" {...sortProps} />
                  <SortHeader column="category" label="Category" className="w-[88px]" {...sortProps} />
                  <SortHeader column="status" label="Status" className="w-[176px]" {...sortProps} />
                  <SortHeader column="reproducibility" label="Reproducibility" className="w-[124px]" {...sortProps} />
                  <SortHeader column="owner" label="Owner" className="w-[104px]" {...sortProps} />
                  <SortHeader column="last_seen" label="Last seen" className="w-[112px]" {...sortProps} />
                  <TableHead className="w-12">
                    <span className="sr-only">Preview</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((finding: FindingItem) => (
                  <TableRow key={finding.code} data-state={finding.code === selected ? "selected" : undefined}>
                    <TableCell className="py-2">
                      <SeverityBadge severity={finding.severity} />
                    </TableCell>
                    <TableCell className="py-2">
                      {/* One line, cut with an ellipsis, so rows stay about 56 px: the whole title
                          is its tooltip, what a screen reader reads, and the preview's heading */}
                      <Link
                        href={`/findings/${finding.code}`}
                        className="block truncate text-[13px] leading-6 font-medium text-link hover:underline"
                        title={finding.title}
                      >
                        {finding.title}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono">{finding.code}</span> · {finding.target.name}
                      </span>
                      {finding.status === "requires_confirmation" && <JudgeOnly />}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className="font-mono text-xs" title={finding.category_name}>
                        {finding.category}
                      </span>
                      <span className="sr-only">{finding.category_name}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      <StatusBadge status={finding.status} />
                    </TableCell>
                    <TableCell className="py-2">
                      <Reproducibility finding={finding} />
                    </TableCell>
                    <TableCell className="py-2">
                      <Owner finding={finding} />
                    </TableCell>
                    <TableCell className="py-2 text-[13px]">
                      {formatDate(finding.last_seen_at)}
                      <span className="block font-mono text-xs text-muted-foreground">{finding.last_run.code}</span>
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Preview ${finding.code}`}
                        title="Preview"
                        data-preview={finding.code}
                        onClick={() => preview(finding.code)}
                      >
                        <PanelRightOpen aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* A phone or a narrow window: the same findings, one card each, in the same order */}
          <div className="flex items-center justify-end border-b px-3 py-2 @4xl:hidden">
            <FilterSelect
              label="Sort"
              value={`${sort}:${direction}`}
              allLabel={null}
              options={
                SORT_CHOICES.some((choice) => choice.value === `${sort}:${direction}`)
                  ? SORT_CHOICES
                  : [...SORT_CHOICES, { value: `${sort}:${direction}`, label: `${sort.replace("_", " ")}, ${direction === "asc" ? "ascending" : "descending"}` }]
              }
              onChange={(value) => {
                const [column, way] = value.split(":") as [SortKey, SortDirection]
                setSort(column)
                setDirection(way)
                setPage(1)
              }}
            />
          </div>
          <ul className="divide-y @4xl:hidden" aria-label="Findings, one card each">
            {data.items.map((finding: FindingItem) => (
              <li key={finding.code} className="space-y-1.5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={finding.severity} />
                  <StatusBadge status={finding.status} />
                  <span className="font-mono text-xs text-muted-foreground">{finding.category}</span>
                </div>
                <Link href={`/findings/${finding.code}`} className="block min-h-6 text-sm font-medium text-link hover:underline">
                  {finding.title}
                </Link>
                {finding.status === "requires_confirmation" && <JudgeOnly />}
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{finding.code}</span> · {finding.target.name} · last seen{" "}
                  {formatDate(finding.last_seen_at)} ({finding.last_run.code})
                </p>
                <div className="flex items-center justify-between gap-3">
                  <Owner finding={finding} />
                  <Reproducibility finding={finding} />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    aria-label={`Preview ${finding.code}`}
                    data-preview={finding.code}
                    onClick={() => preview(finding.code)}
                  >
                    Preview
                  </Button>
                </div>
              </li>
            ))}
          </ul>

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
      {!targetId && (
        <PageHeader
          title="Findings"
          description={`Weaknesses found in ${organization?.name ?? "your organization"}'s targets, with evidence.`}
        />
      )}

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as FindingView)
          setPage(1)
        }}
        className="gap-4"
      >
        {/* Four quick views don't fit a tablet, so the strip scrolls instead of the page. */}
        <TabsList
          variant="line"
          aria-label="Which findings"
          className="h-10 w-full justify-start gap-6 overflow-x-auto border-b px-0"
        >
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
        {LINKED_VIEWS.includes(view) && panel}
      </Tabs>

      <FindingPreview
        code={selected}
        position={position}
        onClose={() => setSelected(null)}
        onTriage={(finding) => {
          // The preview closes first: Screen 41 is the panel in front, not a second one beside it.
          setSelected(null)
          setTriaging(finding)
        }}
        onChanged={() => setAttempt((count) => count + 1)}
        onPrevious={onPrevious}
        onNext={onNext}
        returnFocus={returnFocus}
      />
      {triaging && (
        <TriagePanel
          finding={triaging}
          open
          onOpenChange={(open) => !open && setTriaging(null)}
          returnFocus={returnFocus}
          onDone={() => {
            afterTriage.current = true
            setTriaging(null)
            setSelected(null)
            setAttempt((count) => count + 1)
          }}
        />
      )}
    </>
  )
}
