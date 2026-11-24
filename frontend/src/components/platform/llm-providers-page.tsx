"use client"

import { useCallback, useEffect, useState } from "react"
import { Info, Plus, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { LlmOverview } from "@/components/platform/llm-overview"
import { AddProviderTile, ProviderCard } from "@/components/platform/llm-provider-cards"
import { TaskCards } from "@/components/platform/llm-task-cards"
import { ProviderPanel } from "@/components/platform/provider-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, fieldErrors } from "@/lib/api"
import { confirmPassword } from "@/lib/mfa"
import {
  type LLMConfiguration,
  type Provider,
  type TestResult,
  addModel,
  assignModel,
  llmConfiguration,
  removeProvider,
  testProvider,
} from "@/lib/llm-providers"

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
  const [testing, setTesting] = useState<string | null>(null)
  const [result, setResult] = useState<{ provider: string; test: TestResult } | null>(null)
  const [newModel, setNewModel] = useState<{ provider: Provider; name: string; label: string } | null>(null)
  const [modelError, setModelError] = useState<string | undefined>()
  const [removing, setRemoving] = useState<Provider | null>(null)
  // The password confirmation lasts ten minutes. When it has run out, the action that needed it waits
  // here: the person types the password, and the action is tried again.
  const [asking, setAsking] = useState<{ retry: () => void } | null>(null)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)

  /** True when the server wants the password again: the dialog is then opened, and `retry` waits in it. */
  function needsPassword(failed: unknown, retry: () => void): boolean {
    if (failed instanceof ApiError && failed.code === "password_confirmation_required") {
      setPassword("")
      setPasswordError(undefined)
      setAsking({ retry })
      return true
    }
    return false
  }

  async function confirmAndRetry() {
    if (!asking) return
    setConfirming(true)
    setPasswordError(undefined)
    try {
      await confirmPassword(password)
      const retry = asking.retry
      setAsking(null)
      setPassword("")
      retry()
    } catch (failed) {
      setPasswordError(
        fieldErrors(failed).password ??
          (failed instanceof ApiError ? failed.message : "The password could not be checked. Try again."),
      )
    } finally {
      setConfirming(false)
    }
  }

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
    setTesting(provider.id)
    setResult(null)
    try {
      setResult({ provider: provider.id, test: await testProvider(provider.id) })
      reload()
    } catch (failed) {
      if (needsPassword(failed, () => void test(provider))) return
      toast.error(failed instanceof ApiError ? failed.message : "The test request could not be sent.")
    } finally {
      setBusy(null)
      setTesting(null)
    }
  }

  async function assign(task: string, modelId: string) {
    setBusy(task)
    try {
      const row = await assignModel(task, modelId)
      toast.success(`${row.function} now uses ${row.model}.`, { description: row.note || undefined })
      reload()
    } catch (failed) {
      if (needsPassword(failed, () => void assign(task, modelId))) return
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
      if (needsPassword(failed, () => void remove(provider))) return
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
      if (needsPassword(failed, () => void saveModel())) return
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
        <div className="space-y-6" role="status" aria-label="Loading the providers">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-28 rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-48 rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((n) => (
              <Skeleton key={n} className="h-72 rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <LlmOverview data={data} />

          <TaskCards
            assignments={data.assignments}
            providers={data.providers}
            onAssign={(task, modelId) => void assign(task, modelId)}
            busy={busy}
          />

          <section aria-labelledby="providers-heading" className="space-y-3">
            <div>
              <h2 id="providers-heading" className="text-base font-semibold">
                Providers
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Where the models run. A provider&apos;s key is stored encrypted and is never shown again.
              </p>
            </div>
            {data.providers.length === 0 && (
              <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                No provider is configured. Until one is added, planned tests run and the other detection methods decide.
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              {data.providers.map((provider, index) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  index={index}
                  busy={busy === provider.id}
                  testing={testing === provider.id}
                  result={result?.provider === provider.id ? result.test : null}
                  onTest={() => void test(provider)}
                  onAddModel={() => {
                    setNewModel({ provider, name: "", label: "" })
                    setModelError(undefined)
                  }}
                  onRemove={() => setRemoving(provider)}
                />
              ))}
              <AddProviderTile index={data.providers.length} onAdd={() => setAdding(true)} />
            </div>
          </section>

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

      <Dialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void confirmAndRetry()
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Enter your password to go on</DialogTitle>
              <DialogDescription>
                Changing these settings needs your password again. It stays confirmed for 10 minutes, and then
                the change you asked for is made.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Your password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={!!passwordError || undefined}
                aria-describedby={passwordError ? "confirm-password-error" : undefined}
                className="h-9"
                autoFocus
              />
              {passwordError && (
                <p id="confirm-password-error" role="alert" className="text-xs text-destructive">
                  {passwordError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAsking(null)} disabled={confirming}>
                Cancel
              </Button>
              <Button type="submit" disabled={confirming || !password}>
                {confirming ? "Checking…" : "Confirm and continue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
