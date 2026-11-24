"use client"

import { useEffect, useState } from "react"
import { Ban, Cloud, Info, Server } from "lucide-react"
import { toast } from "sonner"

import { AdminNav } from "@/components/admin/admin-nav"
import { LocalModelsDialog } from "@/components/admin/local-models-dialog"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type DataSharing, type LLMTaskRow, getDataSharing } from "@/lib/data-and-ai"
import { useCan } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap"
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

/** External or local, with an icon and a word (never colour alone, NFR-4.3). */
function Location({ row }: { row: LLMTaskRow }) {
  if (row.deployment === "local") {
    return (
      <span className={cn(CHIP, "border-success/40 text-success")}>
        <Server className="size-3.5" aria-hidden="true" />
        Local
      </span>
    )
  }
  if (row.deployment === "external") {
    return (
      <span className={cn(CHIP, "border-border-strong text-foreground")}>
        <Cloud className="size-3.5" aria-hidden="true" />
        External
      </span>
    )
  }
  return <span className="text-muted-foreground">–</span>
}

function Model({ row }: { row: LLMTaskRow }) {
  if (!row.model) return <span className="text-muted-foreground">No model configured</span>
  return (
    <span>
      <span className="font-mono text-xs">{row.model}</span>
      {row.provider && <span className="block text-xs text-muted-foreground">{row.provider}</span>}
    </span>
  )
}

/** Screen 59: which language models process the organization's data, what they receive, and
 * "Local models only" (UC-10.5, NFR-9.6). */
export function DataAndAiPage() {
  usePageCrumbs([{ label: "Data and AI" }])
  const organization = useSession().organization
  const canManage = useCan("manage_data_settings")
  const [data, setData] = useState<DataSharing | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [target, setTarget] = useState<boolean | null>(null)

  useEffect(() => {
    if (!canManage) return
    let current = true
    getDataSharing()
      .then((found) => {
        if (!current) return
        setData(found)
        setFailed(false)
      })
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [canManage, reloads])

  if (canManage === false) {
    return (
      <EmptyState
        title="Only Organization Administrators manage data and AI"
        description="Ask an Organization Administrator."
      />
    )
  }

  const name = organization?.name ?? "the organization"
  const changed = data?.changed_at ? `${DAY.format(new Date(data.changed_at))}${data.changed_by ? `, by ${data.changed_by}` : ""}` : null

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AdminNav />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data and AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">Which language models process {name}&apos;s data, and what they receive.</p>
        </div>

        {failed && (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The settings could not be loaded.
              <Button variant="outline" size="sm" onClick={() => setReloads((n) => n + 1)}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <section aria-labelledby="models-heading" className="@container rounded-[10px] border bg-card">
          <h2 id="models-heading" className="border-b px-4 py-3 text-[15px] font-semibold">
            Models by task
          </h2>
          {!data && !failed && (
            <div className="space-y-2 p-4" role="status" aria-label="Loading the models">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {data && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="text-xs">Task</TableHead>
                    <TableHead className="hidden text-xs @xl:table-cell">Provider and model</TableHead>
                    <TableHead className="text-xs">Location</TableHead>
                    <TableHead className="hidden text-xs @3xl:table-cell">What it receives</TableHead>
                    <TableHead className="hidden text-right text-xs @2xl:table-cell">Requests this month</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tasks.map((row) => (
                    <TableRow key={row.task}>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <div className="text-[13px] font-medium">{row.function}</div>
                        {!row.available && (
                          <div className="mt-1 flex items-start gap-1.5 text-xs text-warning">
                            <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              <span className="font-semibold">Unavailable</span>
                              {data.local_models_only && row.model ? " with Local models only" : ": no model is configured"}.{" "}
                              {row.without_model}
                            </span>
                          </div>
                        )}
                        {/* The columns that don't fit, under the task */}
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground @3xl:hidden">
                          <div className="@xl:hidden">
                            Model: {row.model ? `${row.model}${row.provider ? ` (${row.provider})` : ""}` : "none configured"}
                          </div>
                          <div>Receives: {row.receives}</div>
                          <div className="@2xl:hidden">Requests this month: {row.requests_this_month.toLocaleString("en-GB")}</div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden py-3 align-top text-[13px] @xl:table-cell">
                        <Model row={row} />
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <Location row={row} />
                      </TableCell>
                      <TableCell className="hidden py-3 align-top text-[13px] whitespace-normal @3xl:table-cell">{row.receives}</TableCell>
                      <TableCell className="tabular hidden py-3 text-right align-top text-[13px] @2xl:table-cell">
                        {row.requests_this_month.toLocaleString("en-GB")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {data && (
            <p className="flex items-center gap-2 border-t px-4 py-3 text-sm text-text-secondary">
              <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {data.masking}
            </p>
          )}
        </section>

        {data && (
          <section aria-labelledby="local-only-heading" className="flex items-start justify-between gap-6 rounded-[10px] border bg-card p-5">
            <div className="space-y-1">
              <h2 id="local-only-heading" className="text-[15px] font-semibold">
                <label htmlFor="local-only">Local models only</label>
              </h2>
              <p id="local-only-help" className="text-sm text-text-secondary">No data goes to external providers. Tasks without a local model stop.</p>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {data.local_models_only ? "On" : "Off"}
                {changed ? ` since ${changed}` : ""}.
              </p>
            </div>
            <Switch
              id="local-only"
              checked={data.local_models_only}
              onCheckedChange={(on) => setTarget(on)}
              aria-describedby="local-only-help"
              className="mt-1"
            />
          </section>
        )}
      </div>

      <LocalModelsDialog
        target={target}
        tasks={data?.tasks ?? []}
        onClose={() => setTarget(null)}
        onSaved={(saved) => {
          setData(saved)
          toast.success(saved.local_models_only ? "Local models only is on" : "External providers are allowed again", {
            description: "It applies to the next request, also of running campaign runs.",
          })
        }}
      />
    </div>
  )
}
