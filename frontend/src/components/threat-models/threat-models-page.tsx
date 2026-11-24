"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CircleAlert, CircleCheck, FilePen, RefreshCw, Sparkles, Target, Layers } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { GLASS_BUTTON, GlassCard } from "@/components/sentra/glass-card"
import { ViewSwitch, useStoredView } from "@/components/sentra/view-switch"
import { AiGeneratedLabel, VersionStatus } from "@/components/threat-models/badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { TYPE_LABEL } from "@/lib/targets"
import {
  type ThreatModelList,
  type ThreatModelRow,
  generateThreatModel,
  jobActive,
  listThreatModels,
  shortDate,
} from "@/lib/threat-models"
import { cn } from "@/lib/utils"

const POLL_MS = 3000
const FAILED = "Sentra could not load the threat models."

/** Drafts that need a person first (Screen 25: impossible to miss), then the others by name. */
function order(rows: ThreatModelRow[]) {
  const rank = (row: ThreatModelRow) => (row.latest?.status === "draft" ? 0 : row.latest ? 1 : 2)
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.target.name.localeCompare(b.target.name))
}

type Show = "all" | "drafts" | "approved" | "none"

/** Four tiles that also filter: all targets, the drafts that wait for a person, the approved, the ones with no model. */
function Summary({ list, show, onShow }: { list: ThreatModelList; show: Show; onShow: (show: Show) => void }) {
  const tiles: { id: Show; label: string; value: number; icon: typeof FilePen; tone: string }[] = [
    { id: "all", label: "Targets", value: list.rows.length, icon: Layers, tone: "" },
    { id: "drafts", label: "Await review", value: list.drafts_to_review, icon: FilePen, tone: list.drafts_to_review ? "bg-warning/10 text-warning" : "" },
    { id: "approved", label: "Approved", value: list.approved, icon: CircleCheck, tone: "bg-success/10 text-success" },
    { id: "none", label: "No threat model", value: list.without_threat_model, icon: Target, tone: "" },
  ]
  return (
    <ul className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
      {tiles.map((tile) => {
        const Icon = tile.icon
        const on = show === tile.id
        return (
          <li key={tile.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onShow(on && tile.id !== "all" ? "all" : tile.id)}
              className={cn(
                "flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
              )}
            >
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-muted", tile.tone)}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="tabular block text-2xl leading-7 font-semibold">{tile.value}</span>
                <span className="block text-xs text-muted-foreground">{tile.label}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** One target as a card: its state and version, what it holds, and the one thing to do next. */
function ModelCard({
  row,
  canManage,
  onGenerate,
  pending,
}: {
  row: ThreatModelRow
  canManage: boolean | undefined
  onGenerate: (row: ThreatModelRow) => void
  pending: boolean
}) {
  const latest = row.latest
  const draft = latest?.status === "draft"
  const review = Boolean(draft && canManage)
  return (
    <GlassCard label={`${row.target.name}: ${latest ? (draft ? "draft" : "approved") : "no threat model"}`}>
      <div className="flex items-center justify-between gap-2">
        <StatusCell row={row} compact />
        {latest && <span className="tabular font-mono text-[13px] text-foreground/65">v{latest.version}</span>}
      </div>

      <h3 className="mt-3 text-lg leading-6 font-medium">
        {latest ? (
          <Link href={`/threat-models/${row.target.id}`} className="rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {row.target.name}
          </Link>
        ) : (
          row.target.name
        )}
      </h3>
      <p className="text-sm text-foreground/65">{TYPE_LABEL[row.target.type]}</p>

      {latest && (
        <div className="mt-4 flex items-stretch divide-x divide-foreground/10 rounded-xl bg-white/70 py-2.5 text-center dark:bg-white/5">
          <div className="flex-1 px-2">
            <p className="tabular text-xl leading-7 font-semibold">{latest.threat_count}</p>
            <p className="text-xs text-foreground/65">Threats</p>
          </div>
          <div className="flex-1 px-2">
            <p className={cn("tabular flex items-center justify-center gap-1 text-xl leading-7 font-semibold", (row.without_test ?? 0) > 0 && "text-warning")}>
              {(row.without_test ?? 0) > 0 && <AlertTriangle className="size-4" aria-hidden="true" />}
              {row.without_test ?? 0}
            </p>
            <p className="text-xs text-foreground/65">Without a test</p>
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4">
        {latest ? (
          review ? (
            <Button asChild className="h-10 flex-1 rounded-full hover:bg-primary-hover">
              <Link href={`/threat-models/${row.target.id}`} aria-label={`Review the threat model of ${row.target.name}`}>
                Review
              </Link>
            </Button>
          ) : (
            <Link href={`/threat-models/${row.target.id}`} className={GLASS_BUTTON} aria-label={`Open the threat model of ${row.target.name}`}>
              Open
            </Link>
          )
        ) : row.blocker ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-full border-2 border-dashed border-[#dbe3fb] px-3 text-center text-xs text-foreground/60 dark:border-white/15">
            {row.blocker_code === "not_verified" ? "Verify ownership first" : "Review the target profile first"}
          </span>
        ) : jobActive(row.job) ? null : !canManage ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-full border-2 border-dashed border-[#dbe3fb] px-3 text-center text-xs text-foreground/60 dark:border-white/15">
            A Security Analyst generates it
          </span>
        ) : (
          <Button variant="outline" className="h-10 flex-1 gap-2 rounded-full bg-white/70 dark:bg-white/5" onClick={() => onGenerate(row)} disabled={pending}>
            <Sparkles aria-hidden="true" />
            Generate<span className="sr-only"> the threat model of {row.target.name}</span>
          </Button>
        )}
      </div>
    </GlassCard>
  )
}

function StatusCell({ row, compact }: { row: ThreatModelRow; compact?: boolean }) {
  if (jobActive(row.job)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
        <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Generating…
      </span>
    )
  }
  if (row.job?.status === "failed") {
    return (
      <span className="inline-flex items-start gap-1.5 text-sm text-destructive">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Generation failed
          <span className="block text-xs text-muted-foreground">{row.job.message}</span>
        </span>
      </span>
    )
  }
  if (!row.latest) return <span className="text-sm text-muted-foreground">No threat model</span>
  return (
    <span className={cn("flex items-start gap-1", compact ? "flex-wrap items-center gap-1.5" : "flex-col")}>
      <VersionStatus version={row.latest} />
      {row.latest.status === "draft" && row.latest.ai_generated && (
        <>
          <AiGeneratedLabel />
          {!compact && <span className="text-xs text-muted-foreground">Not reviewed</span>}
        </>
      )}
    </span>
  )
}

function ActionCell({
  row,
  canManage,
  onGenerate,
  pending,
}: {
  row: ThreatModelRow
  canManage: boolean | undefined
  onGenerate: (row: ThreatModelRow) => void
  pending: boolean
}) {
  const name = row.target.name
  if (row.latest) {
    const review = row.latest.status === "draft" && canManage
    return (
      <Button asChild size="sm" variant={review ? "default" : "outline"} className="h-8 hover:bg-primary-hover">
        <Link href={`/threat-models/${row.target.id}`} aria-label={`${review ? "Review" : "Open"} the threat model of ${name}`}>
          {review ? "Review" : "Open"}
        </Link>
      </Button>
    )
  }
  if (row.blocker) {
    const text = row.blocker_code === "not_verified" ? "Verify ownership first" : "Review the target profile first"
    return <span className="text-sm text-muted-foreground">{text}</span>
  }
  if (jobActive(row.job)) return null
  if (!canManage) return <span className="text-sm text-muted-foreground">A Security Analyst generates it</span>
  return (
    <Button size="sm" variant="outline" className="h-8" onClick={() => onGenerate(row)} disabled={pending}>
      <Sparkles aria-hidden="true" />
      <span>
        Generate<span className="sr-only"> the threat model of {name}</span>
      </span>
    </Button>
  )
}

/** Screen 25: every target with its threat model, for Security Analysts and Managers (UC-3.1 to
 * UC-3.4). Drafts that need a person come first and are marked AI-generated (NFR-9.4). */
export function ThreatModelsPage() {
  const canManage = useCan("manage_threat_models")
  const canRegister = useCan("manage_targets")
  const [list, setList] = useState<ThreatModelList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [layout, setLayout] = useStoredView("threat-models") // one card for each target (the first look), or the table
  const [show, setShow] = useState<Show>("all")

  async function load() {
    try {
      setList(await listThreatModels())
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : FAILED)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    listThreatModels(controller.signal)
      .then((found) => {
        setList(found)
        setError(null)
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof ApiError ? caught.message : FAILED)
      })
    return () => controller.abort()
  }, [])

  // A generation runs on a worker; the list follows it until the new version is there.
  const generating = list?.rows.some((row) => jobActive(row.job)) ?? false
  useEffect(() => {
    if (!generating) return
    const timer = window.setInterval(() => {
      listThreatModels()
        .then(setList)
        .catch(() => undefined)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [generating])

  async function onGenerate(row: ThreatModelRow) {
    setPending(row.target.id)
    try {
      const job = await generateThreatModel(row.target.id)
      if (job.status === "failed") toast.error(job.message ?? "The threat model couldn't be generated.")
      else toast.success(`Generating the threat model of ${row.target.name}. This page updates when it's ready.`)
      await load()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The threat model couldn't be generated.")
    } finally {
      setPending(null)
    }
  }

  const shownRows = order(list?.rows ?? []).filter((row) =>
    show === "all" ? true : show === "drafts" ? row.latest?.status === "draft" : show === "approved" ? row.latest?.status === "approved" : !row.latest,
  )

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="Threat Models"
        description="What could go wrong in each target."
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {error}
            <Button size="sm" variant="outline" className="h-8" onClick={() => void load()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!list && !error && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the threat models">
          <Skeleton className="h-7 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {list && list.rows.length === 0 && (
        <EmptyState
          title="No targets yet"
          description={
            canRegister
              ? "Verify a target and review its profile first."
              : "An AI Application Developer registers targets."
          }
          action={
            canRegister ? (
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href="/targets/new">Register target</Link>
              </Button>
            ) : undefined
          }
        />
      )}
      {list && list.rows.length > 0 && (
        <>
          <Summary list={list} show={show} onShow={setShow} />
          <p className="sr-only" aria-live="polite">
            {generating ? "A threat model is being generated." : ""}
          </p>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="tabular text-sm text-muted-foreground" aria-live="polite">
              {shownRows.length} of {list.rows.length} {list.rows.length === 1 ? "target" : "targets"}
            </p>
            <ViewSwitch value={layout} onChange={setLayout} />
          </div>
          {layout === "cards" ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shownRows.map((row) => (
                <li key={row.target.id} className="min-w-0">
                  <ModelCard row={row} canManage={canManage} onGenerate={onGenerate} pending={pending === row.target.id} />
                </li>
              ))}
              {shownRows.length === 0 && <li className="col-span-full rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No target in this group.</li>}
            </ul>
          ) : (
          <div className="overflow-x-auto rounded-[10px] border bg-card">
            <Table className="min-w-[880px] [&_th]:whitespace-normal">
              <caption className="sr-only">Threat models by target, drafts that await review first</caption>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead scope="col" className="pl-4">
                    Target
                  </TableHead>
                  <TableHead scope="col" className="w-20">
                    Current version
                  </TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" className="text-right">
                    Threats
                  </TableHead>
                  <TableHead scope="col" className="w-20 text-right">
                    Without a test
                  </TableHead>
                  <TableHead scope="col">Approved by</TableHead>
                  <TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col" className="w-20 text-right">
                    Used by runs
                  </TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map((row) => {
                  const latest = row.latest
                  const draft = latest?.status === "draft"
                  return (
                    <TableRow key={row.target.id} className={cn(draft && "bg-warning/5")}>
                      <TableCell className="pl-4 whitespace-normal">
                        <div className="font-medium">
                          {latest ? (
                            <Link href={`/threat-models/${row.target.id}`} className="text-link hover:underline">
                              {row.target.name}
                            </Link>
                          ) : (
                            row.target.name
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{TYPE_LABEL[row.target.type]}</div>
                      </TableCell>
                      <TableCell className="tabular">{latest ? `v${latest.version}` : "—"}</TableCell>
                      <TableCell>
                        <StatusCell row={row} />
                      </TableCell>
                      <TableCell className="tabular text-right">{latest ? latest.threat_count : "—"}</TableCell>
                      <TableCell className="tabular text-right">
                        {row.without_test === null ? (
                          "—"
                        ) : row.without_test > 0 ? (
                          <span className="inline-flex items-center gap-1 font-medium text-warning">
                            <AlertTriangle className="size-3.5" aria-hidden="true" />
                            {row.without_test}
                          </span>
                        ) : (
                          0
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-normal">
                        {row.approved?.approved_at ? (
                          <>
                            {row.approved.approved_by ?? "Unknown"}, {shortDate(row.approved.approved_at)}
                            {row.approved.version !== latest?.version && (
                              <span className="block text-xs text-muted-foreground">v{row.approved.version}</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{latest ? shortDate(latest.created_at) : "—"}</TableCell>
                      <TableCell className="tabular text-right">{latest ? latest.runs : "—"}</TableCell>
                      <TableCell className="pr-4 text-right whitespace-normal">
                        <ActionCell row={row} canManage={canManage} onGenerate={onGenerate} pending={pending === row.target.id} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          )}
        </>
      )}
    </div>
  )
}
