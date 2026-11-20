"use client"

import { useCallback, useEffect, useState } from "react"
import { Bot, CircleCheck, Cloud, HardDrive, Info, Plus, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { ProviderPanel, TestOutcome } from "@/components/platform/provider-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  type Assignment,
  type LLMConfiguration,
  type Provider,
  type ProviderModel,
  type TestResult,
  addModel,
  assignModel,
  cost,
  duration,
  llmConfiguration,
  removeProvider,
  testProvider,
} from "@/lib/llm-providers"

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

/** External or local, in one chip: whether an organization's data leaves the platform. */
function Location({ deployment }: { deployment: "external" | "local" }) {
  const local = deployment === "local"
  const Icon = local ? HardDrive : Cloud
  return (
    <Badge variant="outline" className="gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {local ? "Local" : "External"}
    </Badge>
  )
}

/** "Last test: OK · 412 ms · $0.0021", or what the provider said when it failed. */
function LastTest({ provider }: { provider: Provider }) {
  if (!provider.tested_at) return <span className="text-muted-foreground">Not tested yet</span>
  const ok = provider.test_duration_ms !== null
  if (!ok) {
    return (
      <span className="flex items-start gap-1.5 font-medium text-destructive">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-normal">Last test failed: {provider.test_reply}</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
      <span className="tabular">
        Last test: OK · {duration(provider.test_duration_ms)} · {cost(provider.test_cost_usd)}
      </span>
    </span>
  )
}

function ProviderCard({
  provider,
  busy,
  onTest,
  onAddModel,
  onRemove,
}: {
  provider: Provider
  busy: boolean
  onTest: () => void
  onAddModel: () => void
  onRemove: () => void
}) {
  return (
    <section aria-label={provider.name} className="rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
            {provider.name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {provider.kind_label}
            {provider.base_url ? ` · ${provider.base_url}` : ""}
          </p>
        </div>
        <Location deployment={provider.deployment} />
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Models</dt>
          <dd className="min-w-0">
            {provider.models.map((model) => model.label).join(", ")}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">API key</dt>
          <dd>{provider.has_api_key ? <span aria-label="stored, never shown">Stored encrypted (••••)</span> : "None needed"}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Tasks</dt>
          <dd>{provider.tasks.length ? provider.tasks.join(", ") : "No tasks assigned"}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm">
        <LastTest provider={provider} />
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onTest} disabled={busy}>
          Test request
        </Button>
        <Button variant="outline" size="sm" onClick={onAddModel} disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          Add model
        </Button>
        <Button variant="outline" size="sm" onClick={onRemove} disabled={busy}>
          Remove
        </Button>
      </div>
    </section>
  )
}

/** The "Model assignment" table of Screen 62: one row per task of Sentra's own AI, each with a
 * select over every configured model (UC-10.4 step 4). */
function ModelAssignment({
  assignments,
  providers,
  onAssign,
  busy,
}: {
  assignments: Assignment[]
  providers: Provider[]
  onAssign: (task: string, modelId: string) => void
  busy: string | null
}) {
  const options: { model: ProviderModel; provider: Provider }[] = providers.flatMap((provider) =>
    provider.models.map((model) => ({ model, provider })),
  )
  return (
    <section aria-label="Model assignment" className="rounded-[10px] border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Model assignment</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Which model does which task of Sentra&apos;s own AI. A change applies to the next request.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[26%]">Task</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="w-[14%]">Location</TableHead>
              <TableHead className="w-[16%]">Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((row) => (
              <TableRow key={row.task}>
                <TableCell className="align-top font-medium">
                  {row.function}
                  {row.note && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs font-normal text-muted-foreground">
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {row.note}
                    </p>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <Select
                    value={row.model_id ?? ""}
                    disabled={!options.length || busy === row.task}
                    onValueChange={(next) => onAssign(row.task, next)}
                  >
                    <SelectTrigger className="h-9 w-full min-w-44" aria-label={`Model for ${row.function}`}>
                      <SelectValue placeholder={options.length ? "No model assigned" : "No provider configured"} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map(({ model, provider }) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label} ({provider.name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="align-top">
                  {row.deployment ? <Location deployment={row.deployment} /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="tabular align-top text-muted-foreground">
                  {row.since ? DAY.format(new Date(row.since)) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

/**
 * Screen 62: the LLM providers and models Sentra's own agents use (FR-10.3, UC-10.4), for
 * Platform Administrators. No organization's content appears here (NFR-3.3), and a provider's
 * key is never shown again once it is stored.
 */
export function LLMProvidersPage() {
  const [data, setData] = useState<LLMConfiguration | null>(null)
  const [error, setError] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ provider: string; test: TestResult } | null>(null)
  const [newModel, setNewModel] = useState<{ provider: Provider; name: string; label: string } | null>(null)
  const [modelError, setModelError] = useState<string | undefined>()
  const [removing, setRemoving] = useState<Provider | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    llmConfiguration(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [reloads])

  const reload = useCallback(() => setReloads((n) => n + 1), [])

  async function test(provider: Provider) {
    setBusy(provider.id)
    setResult(null)
    try {
      setResult({ provider: provider.id, test: await testProvider(provider.id) })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The test request could not be sent.")
    } finally {
      setBusy(null)
    }
  }

  async function assign(task: string, modelId: string) {
    setBusy(task)
    try {
      const row = await assignModel(task, modelId)
      toast.success(`${row.function} now uses ${row.model}.`, { description: row.note || undefined })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The model could not be assigned.")
    } finally {
      setBusy(null)
    }
  }

  async function remove(provider: Provider) {
    setBusy(provider.id)
    try {
      await removeProvider(provider.id)
      toast.success(`${provider.name} is removed.`, { description: "Its API key was deleted with it." })
      setRemoving(null)
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The provider could not be removed.")
    } finally {
      setBusy(null)
    }
  }

  async function saveModel() {
    if (!newModel) return
    setBusy(newModel.provider.id)
    setModelError(undefined)
    try {
      const added = await addModel(newModel.provider.id, { name: newModel.name.trim(), label: newModel.label.trim() })
      toast.success(`${added.label} is ready to assign.`, { description: `Tested on ${newModel.provider.name}.` })
      setNewModel(null)
      reload()
    } catch (failed) {
      const fields = fieldErrors(failed)
      setModelError(fields.name ?? (failed instanceof ApiError ? failed.message : "The model could not be added."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">LLM Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Models used by Sentra&apos;s own agents through the provider-agnostic LLM layer.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add provider
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            The providers could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-4" role="status" aria-label="Loading the providers">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {data.providers.length === 0 ? (
            <section aria-label="Providers" className="rounded-[10px] border bg-card p-6 text-center">
              <h2 className="text-sm font-semibold">No provider is configured</h2>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                Until a provider is added, Sentra&apos;s own AI works as when a provider is unavailable: campaigns send
                their planned tests, and the other detection methods decide.
              </p>
              <Button className="mt-4" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add provider
              </Button>
            </section>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.providers.map((provider) => (
                <div key={provider.id} className="space-y-3">
                  <ProviderCard
                    provider={provider}
                    busy={busy === provider.id}
                    onTest={() => void test(provider)}
                    onAddModel={() => {
                      setNewModel({ provider, name: "", label: "" })
                      setModelError(undefined)
                    }}
                    onRemove={() => setRemoving(provider)}
                  />
                  {result?.provider === provider.id && <TestOutcome result={result.test} />}
                </div>
              ))}
            </div>
          )}

          <ModelAssignment
            assignments={data.assignments}
            providers={data.providers}
            onAssign={(task, modelId) => void assign(task, modelId)}
            busy={busy}
          />

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {data.recorded}
          </p>
        </div>
      )}

      <ProviderPanel
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(provider) => {
          toast.success(`${provider.name} is configured.`, {
            description: "Assign it to a task to put it to work.",
          })
          reload()
        }}
      />

      <Dialog open={!!newModel} onOpenChange={(open) => !open && setNewModel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a model to {newModel?.provider.name}</DialogTitle>
            <DialogDescription>
              Sentra sends one test request to the model. It is kept only if that request works.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-model-name">Name at the provider</Label>
              <Input
                id="new-model-name"
                value={newModel?.name ?? ""}
                maxLength={120}
                spellCheck={false}
                placeholder="qwen2.5:14b"
                onChange={(event) => setNewModel((current) => current && { ...current, name: event.target.value })}
                aria-invalid={!!modelError || undefined}
                aria-describedby={modelError ? "new-model-error" : undefined}
                className="h-9 font-mono text-[13px]"
              />
              {modelError && (
                <p id="new-model-error" role="alert" className="text-xs text-destructive">
                  {modelError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-model-label">Name for people (optional)</Label>
              <Input
                id="new-model-label"
                value={newModel?.label ?? ""}
                maxLength={120}
                placeholder="Qwen 2.5 14B"
                onChange={(event) => setNewModel((current) => current && { ...current, label: event.target.value })}
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewModel(null)} disabled={!!busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveModel()}
              disabled={!!busy || !newModel?.name.trim()}
            >
              {busy ? "Testing…" : "Test and add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              Its API key is deleted with it. A provider a task still uses cannot be removed — assign another model to
              that task first.
            </DialogDescription>
          </DialogHeader>
          {removing?.tasks.length ? (
            <Alert role="alert">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                {removing.name} still serves {removing.tasks.join(", ")}.
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={!!busy}>
              Cancel
            </Button>
            <Button onClick={() => removing && void remove(removing)} disabled={!!busy}>
              {busy ? "Removing…" : "Remove provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
