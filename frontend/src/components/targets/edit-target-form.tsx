"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { KeyRound, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { SegmentedControl } from "@/components/sentra/segmented-control"
import { CredentialFields, emptyRows } from "@/components/targets/credential-fields"
import { FormatFields, type FormatValue } from "@/components/targets/format-fields"
import { OwnershipBadge } from "@/components/targets/target-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, fieldErrors } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type AuthMode,
  type CredentialInput,
  type Environment,
  EXAMPLE_TEMPLATE,
  MAX_RATE,
  type Target,
  credentialProblems,
  credentialsPayload,
  describeCredential,
  formatDate,
  getTarget,
  nameProblem,
  pathProblem,
  rateProblem,
  replaceCredentials,
  templateProblem,
  updateTarget,
  urlProblem,
} from "@/lib/targets"

type Form = { name: string; environment: Environment; rate: string; endpoint: string; format: FormatValue }

function formOf(target: Target): Form {
  return {
    name: target.name,
    environment: target.environment,
    rate: String(target.max_request_rate),
    endpoint: target.endpoint_url,
    format: {
      request_format: target.request_format,
      request_template: target.request_template ?? EXAMPLE_TEMPLATE,
      reply_path: target.request_format === "custom_json" ? target.reply_path : "$.output.text",
      tool_calls_path: target.tool_calls_path ?? "",
    },
  }
}

function clean(errors: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Record<string, string>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/\W+/g, "-")}`
  return (
    <section aria-labelledby={id} className="rounded-[10px] border bg-card p-6">
      <h2 id={id} className="mb-4 text-[15px] font-semibold">
        {title}
      </h2>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** Screen 22: UC-2.5 Update Target Configuration. */
export function EditTargetForm({ id }: { id: string }) {
  const router = useRouter()
  const canManage = useCan("manage_targets")
  const [target, setTarget] = useState<Target | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [editingFormat, setEditingFormat] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [mode, setMode] = useState<AuthMode>("api_key")
  const [rows, setRows] = useState<CredentialInput[]>(emptyRows("api_key"))
  const [credErrors, setCredErrors] = useState<Record<string, string>>({})
  const [credBusy, setCredBusy] = useState(false)

  usePageCrumbs(target ? [{ label: target.name }, { label: "Edit" }] : [{ label: "Edit" }])

  const load = useCallback(() => {
    getTarget(id)
      .then((t) => {
        setTarget(t)
        setForm(formOf(t))
        setLoadError(null)
      })
      .catch((error) => setLoadError(error instanceof ApiError && error.status === 404 ? "not_found" : "failed"))
  }, [id])
  useEffect(load, [load])

  const initial = target ? formOf(target) : null
  const dirty = Boolean(form && initial && (JSON.stringify(form) !== JSON.stringify(initial) || editingFormat))
  const unsaved = dirty || rows.some((r) => r.value)

  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])

  if (loadError === "not_found") {
    return (
      <EmptyState
        title="Target not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/targets">Back to targets</Link>
          </Button>
        }
      />
    )
  }
  if (loadError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex items-center justify-between gap-4">
          The target could not be loaded.
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!target || !form || canManage === undefined) {
    return (
      <div className="mx-auto max-w-[880px] space-y-4" role="status" aria-label="Loading target">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const archived = target.status === "archived"
  const readOnly = !canManage || archived
  // UC-2.5, 3b1: the endpoint and the credentials decide where and how Sentra sends, so a run
  // that is in progress keeps them as they are until it ends or is stopped.
  const running = target.active_run
  const sendingLocked = readOnly || !!running
  const endpointChanged = form.endpoint.trim() !== target.endpoint_url
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!target || !form || busy || !dirty) return
    const custom = form.format.request_format === "custom_json"
    const found = clean({
      name: nameProblem(form.name),
      endpoint_url: urlProblem(form.endpoint),
      max_request_rate: rateProblem(form.rate),
      request_template: editingFormat && custom ? templateProblem(form.format.request_template) : undefined,
      reply_path: editingFormat && custom ? pathProblem(form.format.reply_path, true) : undefined,
      tool_calls_path: editingFormat && custom ? pathProblem(form.format.tool_calls_path, false) : undefined,
    })
    setErrors(found)
    if (Object.keys(found).length) return

    const before = formOf(target)
    const patch: Record<string, unknown> = {}
    if (form.name.trim() !== before.name) patch.name = form.name
    if (form.environment !== before.environment) patch.environment = form.environment
    if (Number(form.rate) !== target.max_request_rate) patch.max_request_rate = Number(form.rate)
    if (endpointChanged) patch.endpoint_url = form.endpoint
    if (editingFormat) {
      patch.request_format = form.format.request_format
      patch.request_template = custom ? form.format.request_template : null
      patch.reply_path = custom ? form.format.reply_path : null
      patch.tool_calls_path = custom && form.format.tool_calls_path.trim() ? form.format.tool_calls_path : null
    }
    setBusy(true)
    setFormError(null)
    try {
      const updated = await updateTarget(target.id, patch)
      const lostVerification = target.status === "verified" && updated.status === "unverified"
      setTarget(updated)
      setForm(formOf(updated))
      setEditingFormat(false)
      toast.success("Changes saved", {
        description: lostVerification
          ? "The target is unverified until you verify ownership again."
          : undefined,
      })
    } catch (error) {
      const fields = fieldErrors(error)
      if (Object.keys(fields).length) {
        setErrors(fields)
        if (fields.request_template || fields.reply_path || fields.tool_calls_path) setEditingFormat(true)
      } else {
        setFormError(error instanceof ApiError ? error.message : "Something went wrong. Try again.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function saveCredentials() {
    if (!target) return
    const found = credentialProblems(mode, rows)
    setCredErrors(found)
    if (Object.keys(found).length) return
    setCredBusy(true)
    try {
      const updated = await replaceCredentials(target.id, credentialsPayload(mode, rows))
      setTarget(updated)
      setReplacing(false)
      setRows(emptyRows(mode))
      toast.success("Credentials replaced", { description: "The old ones were deleted." })
    } catch (error) {
      const fields = fieldErrors(error)
      setCredErrors(Object.keys(fields).length ? fields : { credentials: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
    } finally {
      setCredBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[880px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit target</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {target.name} · <span className="font-mono text-xs">{target.endpoint_host}</span>
          </p>
        </div>
        <OwnershipBadge status={target.status} />
      </div>

      {running && !archived && (
        <Alert className="mb-4" role="status">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Campaign run {running.code} is running on this target. The endpoint and the credentials can&apos;t
              change until it ends or is stopped.
            </span>
            {running.campaign && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/campaigns/${running.campaign}/runs/${running.number}`}>Open live monitor</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {archived && (
        <Alert className="mb-4" role="status">
          <AlertDescription>This target is archived. Restore it before changing it.</AlertDescription>
        </Alert>
      )}
      {!canManage && !archived && (
        <Alert className="mb-4" role="status">
          <AlertDescription>You can view this target. Only AI Application Developers can change it.</AlertDescription>
        </Alert>
      )}
      {formError && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form id="edit-target" onSubmit={save} noValidate className="space-y-4">
        <fieldset disabled={readOnly || busy} className="space-y-4">
          <Section title="General">
            <FormField id="name" label="Name" error={errors.name}>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                autoComplete="off"
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? "name-error" : undefined}
                className="h-9"
              />
            </FormField>
            <div className="space-y-1.5">
              <span id="environment-label" className="text-sm font-medium">
                Environment
              </span>
              <SegmentedControl<Environment>
                value={form.environment}
                onChange={(environment) => set({ environment })}
                labelledBy="environment-label"
                disabled={readOnly || busy}
                options={[
                  { value: "staging", label: "Staging" },
                  { value: "production", label: "Production" },
                ]}
              />
            </div>
            <FormField id="max_request_rate" label="Maximum safe request rate" error={errors.max_request_rate}>
              <div className="flex items-center gap-2">
                <Input
                  id="max_request_rate"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_RATE}
                  value={form.rate}
                  onChange={(e) => set({ rate: e.target.value })}
                  aria-invalid={!!errors.max_request_rate || undefined}
                  aria-describedby={errors.max_request_rate ? "max_request_rate-error" : undefined}
                  className="tabular h-9 w-28"
                />
                <span className="text-sm text-muted-foreground">requests per minute</span>
              </div>
            </FormField>
          </Section>

          <Section title="Endpoint">
            <FormField id="endpoint_url" label="Endpoint URL" error={errors.endpoint_url}>
              <Input
                id="endpoint_url"
                type="url"
                inputMode="url"
                value={form.endpoint}
                onChange={(e) => set({ endpoint: e.target.value })}
                disabled={sendingLocked || busy}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!errors.endpoint_url || undefined}
                aria-describedby={errors.endpoint_url ? "endpoint_url-error" : endpointChanged ? "endpoint-warning" : undefined}
                className="h-9 font-mono text-[13px]"
              />
            </FormField>
            {endpointChanged && target.status === "verified" && (
              <p id="endpoint-warning" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Changing the endpoint makes this target Unverified until you verify ownership again.
              </p>
            )}
          </Section>

          <Section title="Connection format">
            {editingFormat ? (
              <>
                <FormatFields value={form.format} onChange={(format) => set({ format })} errors={errors} type={target.type} />
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0"
                  onClick={() => {
                    setEditingFormat(false)
                    set({ format: formOf(target).format })
                  }}
                >
                  Keep the current format
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  {target.request_format === "openai_chat" ? (
                    "OpenAI-compatible chat API"
                  ) : (
                    <>
                      Custom JSON · reply at <code className="font-mono text-[13px]">{target.reply_path}</code>
                    </>
                  )}
                </p>
                {!readOnly && (
                  <Button type="button" variant="outline" className="h-9" onClick={() => setEditingFormat(true)}>
                    Edit format
                  </Button>
                )}
              </div>
            )}
          </Section>
        </fieldset>
      </form>

      <div className="mt-4">
        <Section title="Credentials">
          {target.credentials.length ? (
            <ul className="divide-y rounded-md border">
              {target.credentials.map((credential) => (
                <li key={credential.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{describeCredential(credential)}</span>
                  <span className="font-mono text-muted-foreground" aria-hidden="true">
                    {credential.masked_value}
                  </span>
                  <span className="sr-only">value hidden</span>
                  <span className="text-muted-foreground">saved {formatDate(credential.saved_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No credentials: Sentra calls the endpoint without any.</p>
          )}
          <p className="text-xs text-muted-foreground">Stored credentials are never shown. Replacing them deletes the old ones.</p>
          {!sendingLocked &&
            (replacing ? (
              <div className="space-y-4 rounded-md border p-4">
                <CredentialFields mode={mode} rows={rows} onModeChange={setMode} onRowsChange={setRows} errors={credErrors} />
                <div className="flex gap-2">
                  <Button type="button" className="h-9 hover:bg-primary-hover" disabled={credBusy} onClick={saveCredentials}>
                    {credBusy ? "Saving…" : "Save new credentials"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    disabled={credBusy}
                    onClick={() => {
                      setReplacing(false)
                      setRows(emptyRows(mode))
                      setCredErrors({})
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-9 w-fit" onClick={() => setReplacing(true)}>
                Replace credentials
              </Button>
            ))}
        </Section>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <Button type="button" variant="outline" className="h-9" onClick={() => (unsaved ? setConfirmLeave(true) : router.push("/targets"))}>
            Cancel
          </Button>
          <Button type="submit" form="edit-target" className="h-9 hover:bg-primary-hover" disabled={!dirty || busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Discard your changes?</DialogTitle>
            <DialogDescription>The target keeps its saved settings.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button variant="destructive" className="h-9" onClick={() => router.push("/targets")}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
