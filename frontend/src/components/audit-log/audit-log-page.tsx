"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight, Download, KeyRound, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { AuditEntryPanel } from "@/components/audit-log/audit-entry-panel"
import { ExportDialog } from "@/components/audit-log/export-dialog"
import { EmptyState } from "@/components/layout/empty-state"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { useSession } from "@/components/session-provider"
import { FilterSelect } from "@/components/sentra/filter-select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api"
import {
  type AuditActor,
  type AuditEntry,
  type AuditFilterOptions,
  type AuditPage,
  type AuditQuery,
  type AuditScope,
  type Integrity,
  DEFAULT_PERIOD,
  PAGE_SIZE,
  PERIODS,
  actorLabel,
  checkIntegrity,
  checkedAt,
  filterOptions,
  itemHref,
  itemTypeLabel,
  listEntries,
  queryString,
  shortTime,
} from "@/lib/audit-log"
import { useCan } from "@/lib/permissions"
import { initials } from "@/lib/session"
import { cn } from "@/lib/utils"

function ActorAvatar({ actor }: { actor: AuditActor }) {
  if (actor.type === "sentra") return <SentraLogo size={28} />
  if (actor.type === "api_key") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-card" aria-hidden="true">
        <KeyRound className="size-3.5 text-muted-foreground" />
      </span>
    )
  }
  return (
    <Avatar className="size-7">
      <AvatarFallback className="text-[11px] font-medium">{initials(actor.name)}</AvatarFallback>
    </Avatar>
  )
}

function SourceAddress({ entry }: { entry: AuditEntry }) {
  if (entry.source_address) return <span className="font-mono text-xs">{entry.source_address}</span>
  return <span className="text-muted-foreground">{entry.actor.type === "sentra" ? "Sentra (internal)" : "Not recorded"}</span>
}

function AffectedItem({ scope, entry }: { scope: AuditScope; entry: AuditEntry }) {
  if (!entry.item) {
    return (
      <span className="text-muted-foreground">
        –<span className="sr-only">no affected item</span>
      </span>
    )
  }
  const href = itemHref(scope, entry.item)
  return (
    <div className="min-w-0">
      {href ? (
        <Link
          href={href}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex min-h-6 items-center font-medium break-words text-link hover:underline"
        >
          {entry.item.label}
        </Link>
      ) : (
        <span className="break-words">{entry.item.label}</span>
      )}
      <div className="text-xs text-muted-foreground">{itemTypeLabel(entry.item.type)}</div>
    </div>
  )
}

/** The integrity strip: the last full check of the hash chain and how long entries are kept
 * (NFR-8.3). Icon and text say it, never colour alone. */
function IntegrityStrip({
  integrity,
  retention,
  checking,
  onCheck,
}: {
  integrity: Integrity | null | undefined
  retention: string
  checking: boolean
  onCheck: () => void
}) {
  return (
    <section
      aria-label="Integrity of the audit log"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border bg-card px-4 py-3 text-sm"
    >
      {integrity === undefined && <Skeleton className="h-5 w-72" />}
      {integrity === null && <span className="text-muted-foreground">No entries yet: the first recorded action starts the hash chain.</span>}
      {integrity && integrity.verified && (
        <span className="flex items-center gap-1.5 font-semibold text-success">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Hash chain verified
        </span>
      )}
      {integrity && !integrity.verified && (
        <span className="flex items-center gap-1.5 font-semibold text-destructive">
          <ShieldAlert className="size-4" aria-hidden="true" />
          Hash chain broken from entry {integrity.broken_seq?.toLocaleString("en-GB")}: an entry may have been changed or
          removed outside Sentra. The Platform Administrators were alerted.
        </span>
      )}
      {integrity && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="tabular text-text-secondary">
            Last check {checkedAt(integrity.checked_at)}, {integrity.entries.toLocaleString("en-GB")} entries
          </span>
        </>
      )}
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <span className="text-text-secondary">{retention.replace(/\.$/, "")}</span>
      {integrity && (
        <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5" onClick={onCheck} disabled={checking}>
          <RefreshCw className={cn(checking && "animate-spin")} aria-hidden="true" />
          {checking ? "Checking…" : "Check now"}
        </Button>
      )}
    </section>
  )
}

/** Page buttons: the first, the last and the pages around the current one. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      {shown.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && p - shown[i - 1] > 1 && (
            <span className="px-1 text-muted-foreground" aria-hidden="true">
              …
            </span>
          )}
          <Button
            variant={p === page ? "secondary" : "outline"}
            size="icon"
            className={cn("tabular min-w-8 px-2", p === page && "border-primary text-link")}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </Button>
        </span>
      ))}
      <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}

/**
 * Screen 58: the audit log (UC-10.3). Organization Administrators see their organization's
 * entries; Platform Administrators see the platform's own entries, never an organization's
 * content (1a). Entries can't be changed or deleted, so the page only reads, filters, opens and
 * exports them (FR-10.2, NFR-8.3).
 */
export function AuditLogPage({
  scope,
  initialQuery,
  initialEntry,
}: {
  scope: AuditScope
  initialQuery: AuditQuery
  initialEntry: string | null
}) {
  const pathname = usePathname()
  const organization = useSession().organization
  const canView = useCan("view_audit_log")
  const allowed = scope === "platform" ? true : canView

  const [query, setQuery] = useState(initialQuery)
  const [search, setSearch] = useState(initialQuery.q)
  // The answer is kept with the request it belongs to, so the page knows whether it shows the
  // current filters (and an answer to older filters never replaces a newer one).
  const [answer, setAnswer] = useState<{ key: string; page: AuditPage } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const [options, setOptions] = useState<AuditFilterOptions | null>(null)
  const [checked, setChecked] = useState<Integrity | null>(null)
  const [checking, setChecking] = useState(false)
  const [entry, setEntry] = useState<string | null>(initialEntry)
  const [exporting, setExporting] = useState(false)

  const key = `${scope}|${JSON.stringify(query)}|${reloads}`
  useEffect(() => {
    if (!allowed) return
    let current = true
    listEntries(scope, query)
      .then((page) => current && setAnswer({ key, page }))
      .catch(() => current && setFailed(key))
    return () => {
      current = false
    }
  }, [allowed, scope, query, key])

  const data = answer?.page ?? null
  const error = failed === key
  const loading = !!answer && answer.key !== key && !error
  // A check made on this page is newer than the one the list came with.
  const integrity: Integrity | null | undefined = checked ?? (answer ? answer.page.integrity : undefined)
  const load = () => {
    setFailed(null)
    setReloads((n) => n + 1)
  }
  useEffect(() => {
    if (allowed) filterOptions(scope).then(setOptions).catch(() => undefined)
  }, [allowed, scope])

  // Typing in the search box filters after a short pause, not on every key.
  useEffect(() => {
    const value = search.trim()
    if (value === query.q) return
    const timer = setTimeout(() => setQuery((q) => ({ ...q, q: value, page: 1 })), 300)
    return () => clearTimeout(timer)
  }, [search, query.q])

  // The address keeps the filters and the open entry, so Back, a reload or a shared link shows
  // the same entries.
  useEffect(() => {
    window.history.replaceState(window.history.state, "", `${pathname}${queryString(query, entry)}`)
  }, [pathname, query, entry])

  const change = (patch: Partial<AuditQuery>) => setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }))
  const filtered = query.actor || query.group || query.item || query.q
  const periodLabel = PERIODS.find((p) => p.value === query.period)?.label ?? ""
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  const scopeText = useMemo(() => {
    const parts = [
      query.actor ? (options?.actors.find((a) => a.id === query.actor)?.name ?? "one user") : "",
      query.group ? (options?.groups.find((g) => g.key === query.group)?.label ?? "one action type") : "",
      query.item ? itemTypeLabel(query.item) : "",
      query.q ? `“${query.q}”` : "",
    ].filter(Boolean)
    const total = data ? `${data.total.toLocaleString("en-GB")} ${data.total === 1 ? "entry" : "entries"}` : "The entries"
    return `${total} · ${periodLabel.toLowerCase()} · ${parts.length ? parts.join(" · ") : "all users, actions and items"}`
  }, [data, options, periodLabel, query])

  if (allowed === false) {
    return (
      <EmptyState
        title="Only Organization Administrators review the audit log"
        description="Ask an Organization Administrator."
      />
    )
  }

  async function checkNow() {
    setChecking(true)
    try {
      const result = await checkIntegrity(scope)
      setChecked(result)
      if (result.verified) toast.success("Hash chain verified", { description: `${result.entries.toLocaleString("en-GB")} entries checked.` })
      else toast.error(`The hash chain is broken from entry ${result.broken_seq?.toLocaleString("en-GB")}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The check could not run. Try again.")
    } finally {
      setChecking(false)
    }
  }

  const where = scope === "platform" ? "the Sentra platform" : (organization?.name ?? "your organization")
  const description =
    scope === "platform"
      ? "Every platform-wide action in Sentra, such as granted roles and account suspensions. Organizations' content is never shown. Entries can't be changed or deleted."
      : `Every security-relevant action in ${where}. Entries can't be changed or deleted.`

  return (
    <div className="min-w-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{scope === "platform" ? "Platform Audit Log" : "Audit Log"}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" className="h-9 gap-1.5" onClick={() => setExporting(true)} disabled={!data || data.total === 0}>
          <Download aria-hidden="true" />
          Export
        </Button>
      </div>

      <IntegrityStrip integrity={integrity} retention={data?.retention ?? "Entries are kept for at least 1 year."} checking={checking} onCheck={checkNow} />

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription className="flex items-center justify-between gap-4">
            The audit log could not be loaded.
            <Button variant="outline" size="sm" onClick={load}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <section aria-label="Audit log entries" className="@container rounded-[10px] border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <FilterSelect
            label="Period"
            value={query.period}
            onChange={(v) => change({ period: v })}
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            allLabel={null}
            changed={query.period !== DEFAULT_PERIOD}
          />
          <FilterSelect
            label="User"
            value={query.actor}
            onChange={(v) => change({ actor: v })}
            options={(options?.actors ?? []).map((a) => ({ value: a.id, label: a.name }))}
            allLabel="All users"
          />
          <FilterSelect
            label="Action type"
            value={query.group}
            onChange={(v) => change({ group: v })}
            options={(options?.groups ?? []).map((g) => ({ value: g.key, label: g.label }))}
            allLabel="All actions"
          />
          <FilterSelect
            label="Affected item"
            value={query.item}
            onChange={(v) => change({ item: v })}
            options={(options?.item_types ?? []).map((t) => ({ value: t, label: itemTypeLabel(t) }))}
            allLabel="All items"
          />
          <label className="relative block w-full sm:ml-auto sm:w-64">
            <span className="sr-only">Search entries</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entries"
              className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </label>
        </div>

        {!data && !error && (
          <div className="space-y-2 p-4" role="status" aria-label="Loading the audit log">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {data && data.total === 0 && (
          <div className="p-4">
            {filtered ? (
              <EmptyState
                title="No entries match"
                description="Change the search or the filters."
                action={
                  <Button
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      setSearch("")
                      change({ actor: "", group: "", item: "", q: "" })
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : query.period !== "all" ? (
              <EmptyState
                title={`No entries in the ${periodLabel.toLowerCase()}`}
                action={
                  <Button variant="outline" className="h-9" onClick={() => change({ period: "all" })}>
                    Show all time
                  </Button>
                }
              />
            ) : (
              <EmptyState title="No entries yet" description="Actions appear here." />
            )}
          </div>
        )}

        {data && data.total > 0 && (
          <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="w-28 text-xs">Time</TableHead>
                    <TableHead className="hidden text-xs @2xl:table-cell">User</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="hidden text-xs @4xl:table-cell">Affected item</TableHead>
                    <TableHead className="hidden text-xs @5xl:table-cell">Source IP</TableHead>
                    <TableHead className="w-12 text-xs">
                      <span className="sr-only">Details</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((e) => (
                    <TableRow
                      key={e.id}
                      data-state={entry === e.id ? "selected" : undefined}
                      className="cursor-pointer data-[state=selected]:bg-accent/60"
                      onClick={() => setEntry(e.id)}
                    >
                      <TableCell className="tabular py-2.5 align-top text-[13px] whitespace-nowrap">{shortTime(e.occurred_at)}</TableCell>
                      <TableCell className="hidden py-2.5 align-top @2xl:table-cell">
                        <div className="flex items-center gap-2.5">
                          <ActorAvatar actor={e.actor} />
                          <span className="text-[13px] font-medium">{actorLabel(e.actor)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 align-top whitespace-normal">
                        <div className="text-[13px]">{e.summary}</div>
                        <code className="mt-1 inline-block rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{e.action}</code>
                        {/* The columns that don't fit, under the action */}
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground @5xl:hidden">
                          <div className="@2xl:hidden">By {actorLabel(e.actor)}</div>
                          {e.item && (
                            <div className="@4xl:hidden">
                              {itemTypeLabel(e.item.type)}: {e.item.label}
                            </div>
                          )}
                          <div>
                            From <SourceAddress entry={e} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden py-2.5 align-top text-[13px] whitespace-normal @4xl:table-cell">
                        <AffectedItem scope={scope} entry={e} />
                      </TableCell>
                      <TableCell className="hidden py-2.5 align-top text-[13px] @5xl:table-cell">
                        <SourceAddress entry={e} />
                      </TableCell>
                      <TableCell className="py-2 text-right align-top">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Open the details: ${e.summary}, ${shortTime(e.occurred_at)}`}
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            event.stopPropagation()
                            setEntry(e.id)
                          }}
                        >
                          <ChevronRight aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
              <span className="tabular text-muted-foreground" aria-live="polite">
                Showing {((query.page - 1) * PAGE_SIZE + 1).toLocaleString("en-GB")}–
                {Math.min(query.page * PAGE_SIZE, data.total).toLocaleString("en-GB")} of {data.total.toLocaleString("en-GB")}{" "}
                {data.total === 1 ? "entry" : "entries"}
              </span>
              {pages > 1 && <Pager page={query.page} pages={pages} onPage={(p) => change({ page: p })} />}
            </nav>
          </div>
        )}
      </section>

      <AuditEntryPanel scope={scope} entryId={entry} integrity={integrity} onClose={() => setEntry(null)} />
      <ExportDialog
        open={exporting}
        scope={scope}
        query={query}
        scopeText={scopeText}
        integrity={integrity}
        onOpenChange={setExporting}
        onExported={(file, format) => {
          toast.success(`Exported as ${format.toUpperCase()}`, { description: `${file} · The export is recorded in the audit log.` })
          load()
        }}
      />
    </div>
  )
}
