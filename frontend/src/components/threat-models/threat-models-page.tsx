"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CircleAlert, CircleCheck, FilePen, RefreshCw, Sparkles, Target } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { AiGeneratedLabel, CHIP, VersionStatus } from "@/components/threat-models/badges"
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
  plural,
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

function Summary({ list }: { list: ThreatModelList }) {
  const drafts = list.drafts_to_review
  return (
    <ul className="mb-4 flex flex-wrap gap-2" aria-label="Summary">
      <li
        className={cn(
          CHIP,
          "h-7 px-2.5",
          drafts ? "border-warning/60 bg-warning/10 text-warning" : "border-border text-muted-foreground",
        )}
      >
        <FilePen className="size-3.5" aria-hidden="true" />
        {drafts ? `${plural(drafts, "draft awaits", "drafts await")} review` : "No draft awaits review"}
      </li>
      <li className={cn(CHIP, "h-7 border-success/40 px-2.5 text-success")}>
        <CircleCheck className="size-3.5" aria-hidden="true" />
        {list.approved} approved
      </li>
      <li className={cn(CHIP, "h-7 border-border px-2.5 text-text-secondary")}>
        <Target className="size-3.5" aria-hidden="true" />
        {plural(list.without_threat_model, "target", "targets")} without a threat model
      </li>
    </ul>
  )
}

function StatusCell({ row }: { row: ThreatModelRow }) {
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
    <span className="flex flex-col items-start gap-1">
      <VersionStatus version={row.latest} />
      {row.latest.status === "draft" && row.latest.ai_generated && (
        <>
          <AiGeneratedLabel />
          <span className="text-xs text-muted-foreground">Not reviewed</span>
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

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="Threat Models"
        description="What could go wrong in each target, mapped to OWASP and MITRE ATLAS."
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
              ? "A threat model is made for each registered target once its ownership is verified and its profile is reviewed."
              : "A threat model is made for each registered target once its ownership is verified and its profile is reviewed. An AI Application Developer registers the targets."
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
          <Summary list={list} />
          <p className="sr-only" aria-live="polite">
            {generating ? "A threat model is being generated." : ""}
          </p>
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
                {order(list.rows).map((row) => {
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
        </>
      )}
    </div>
  )
}
