"use client"

import { useState } from "react"
import { CircleCheck, Eye, EyeOff, Plus, TriangleAlert, X } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ApiError, fieldErrors } from "@/lib/api"
import { confirmPassword } from "@/lib/mfa"
import {
  KINDS,
  type NewProvider,
  type Provider,
  type ProviderKind,
  type TestResult,
  addProvider,
  cost,
  duration,
  needsApiKey,
  needsBaseUrl,
  testConnection,
} from "@/lib/llm-providers"

const MAX_MODELS = 10

type Row = { name: string; label: string }

const empty = (kind: ProviderKind): NewProvider => ({
  kind,
  name: KINDS.find((k) => k.value === kind)?.label ?? "",
  base_url: kind === "ollama" ? "http://ollama:11434" : "",
  api_key: "",
  models: [],
})

/** A secret the administrator types once: it is sent to Sentra, stored encrypted and never shown
 * again (UC-10.4 quality requirement 2). */
function KeyInput({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="sk-…"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="h-9 pr-10 font-mono text-[13px]"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={visible ? "Hide the key" : "Show the key"}
        aria-controls={id}
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
}

/** The result of a test request, in the words of Screen 62: the reply as plain text, the latency
 * and the cost, or the provider's own error. `message` is the whole sentence when the server
 * already wrote one (the refused save of 3a1); otherwise it is built around the error. */
export function TestOutcome({
  result,
  label = "Test request",
}: {
  result: TestResult & { message?: string }
  label?: string
}) {
  if (!result.ok) {
    return (
      <Alert variant="destructive" role="alert">
        <TriangleAlert aria-hidden="true" />
        <AlertDescription>{result.message ?? `Test failed: ${result.error}. Nothing was saved.`}</AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="rounded-[10px] border bg-muted/40 p-3" role="status">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CircleCheck className="size-4 text-success" aria-hidden="true" />
        {label}: OK
      </div>
      <p className="mt-1.5 text-sm break-words whitespace-pre-wrap text-muted-foreground">{result.reply}</p>
      <p className="tabular mt-1.5 text-xs text-muted-foreground">
        {result.model} · {duration(result.duration_ms)} · {cost(result.cost_usd)}
      </p>
    </div>
  )
}

/**
 * Screen 62, "Add provider" side panel: UC-10.4 steps 1-3 and 5, with 3a1. The password is
 * confirmed before the key is sent (step 2, NFR-3.5), the connection is tested before anything
 * is saved, and a failed test saves nothing.
 */
export function ProviderPanel({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: (provider: Provider) => void
}) {
  const [data, setData] = useState<NewProvider>(empty("anthropic"))
  const [rows, setRows] = useState<Row[]>([{ name: "", label: "" }])
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<(TestResult & { message?: string }) | null>(null)
  const [pending, setPending] = useState<"test" | "save" | null>(null)

  function close() {
    setData(empty("anthropic"))
    setRows([{ name: "", label: "" }])
    setPassword("")
    setErrors({})
    setResult(null)
    onClose()
  }

  function pick(kind: ProviderKind) {
    setData(empty(kind))
    setResult(null)
    setErrors({})
  }

  function setRow(index: number, change: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))
    setResult(null)
  }

  const models = rows.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), label: row.label.trim() }))
  const body: NewProvider = { ...data, name: data.name.trim(), base_url: data.base_url.trim(), models }

  /** What the panel itself can see is missing, before a request is sent (NFR-4.5). */
  function check(): Record<string, string> {
    const found: Record<string, string> = {}
    if (!data.name.trim()) found.name = "Give the provider a name, so the cards can tell them apart."
    if (needsBaseUrl(data.kind) && !data.base_url.trim()) found.base_url = "Enter the address of the server."
    if (needsApiKey(data.kind) && !data.api_key.trim()) found.api_key = "Enter the provider's API key."
    if (!models.length) found.models = "Add at least one model."
    if (new Set(models.map((m) => m.name)).size !== models.length) found.models = "Each model can only be added once."
    if (!password) found.password = "Enter your password to confirm."
    return found
  }

  async function act(what: "test" | "save") {
    const found = check()
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(what)
    try {
      await confirmPassword(password) // UC-10.4 step 2, before the key is sent (NFR-3.5)
      if (what === "test") {
        setResult(await testConnection(body))
      } else {
        onSaved(await addProvider(body))
        close()
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.code === "connection_test_failed") {
        setResult({ ok: false, model: "", reply: null, duration_ms: 0, cost_usd: "0", error: error.message, message: error.message })
        setErrors({})
      } else {
        const fields = fieldErrors(error)
        setErrors(
          Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." },
        )
      }
    } finally {
      setPending(null)
    }
  }

  const kind = KINDS.find((k) => k.value === data.kind)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void act("save")
          }}
          className="flex min-h-full flex-col"
        >
          <SheetHeader className="border-b px-6 py-4 pr-12">
            <SheetTitle className="text-base font-semibold">Add provider</SheetTitle>
            <SheetDescription>
              Sentra tests the connection before the provider is saved. Nothing is kept if the test fails.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 px-6 py-5">
            {errors.form && (
              <Alert variant="destructive" role="alert">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            )}

            <FormField id="provider-kind" label="Type">
              <Select value={data.kind} onValueChange={(next) => pick(next as ProviderKind)}>
                <SelectTrigger id="provider-kind" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{kind?.hint}</p>
            </FormField>

            <FormField id="provider-name" label="Name" error={errors.name}>
              <Input
                id="provider-name"
                value={data.name}
                maxLength={80}
                onChange={(event) => setData({ ...data, name: event.target.value })}
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? "provider-name-error" : undefined}
                className="h-9"
              />
            </FormField>

            {needsBaseUrl(data.kind) || data.kind === "openai" ? (
              <FormField
                id="provider-url"
                label={needsBaseUrl(data.kind) ? "Base URL" : "Base URL (optional)"}
                error={errors.base_url}
              >
                <Input
                  id="provider-url"
                  value={data.base_url}
                  maxLength={300}
                  spellCheck={false}
                  placeholder="http://ollama:11434"
                  onChange={(event) => setData({ ...data, base_url: event.target.value })}
                  aria-invalid={!!errors.base_url || undefined}
                  aria-describedby={errors.base_url ? "provider-url-error" : undefined}
                  className="h-9 font-mono text-[13px]"
                />
                <p className="text-xs text-muted-foreground">
                  A loopback or private address means the data stays on the platform; a public one means it leaves.
                </p>
              </FormField>
            ) : null}

            {data.kind !== "ollama" && (
              <FormField
                id="provider-key"
                label={needsApiKey(data.kind) ? "API key" : "API key (optional)"}
                error={errors.api_key}
              >
                <KeyInput
                  id="provider-key"
                  value={data.api_key}
                  onChange={(value) => {
                    setData({ ...data, api_key: value })
                    setResult(null)
                  }}
                  invalid={!!errors.api_key}
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted and never shown again. You&apos;ll confirm with your password.
                </p>
              </FormField>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm leading-none font-medium">Models</legend>
              <p className="text-xs text-muted-foreground">
                As the provider names them, for example <span className="font-mono">llama3.1:8b</span>. The first one is
                used for the test request.
              </p>
              {rows.map((row, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor={`model-name-${index}`}>
                      Model {index + 1}, name at the provider
                    </label>
                    <Input
                      id={`model-name-${index}`}
                      value={row.name}
                      maxLength={120}
                      spellCheck={false}
                      placeholder="claude-sonnet-5-5"
                      onChange={(event) => setRow(index, { name: event.target.value })}
                      className="h-9 font-mono text-[13px]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor={`model-label-${index}`}>
                      Model {index + 1}, name for people
                    </label>
                    <Input
                      id={`model-label-${index}`}
                      value={row.label}
                      maxLength={120}
                      placeholder="Claude Sonnet"
                      onChange={(event) => setRow(index, { label: event.target.value })}
                      className="h-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0"
                    disabled={rows.length === 1}
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="size-4" aria-hidden="true" />
                    <span className="sr-only">Remove model {index + 1}</span>
                  </Button>
                </div>
              ))}
              {errors.models && (
                <p id="provider-models-error" className="text-xs text-destructive">
                  {errors.models}
                </p>
              )}
              {rows.length < MAX_MODELS && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((current) => [...current, { name: "", label: "" }])}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add another model
                </Button>
              )}
            </fieldset>

            <FormField id="provider-password" label="Confirm with your password" error={errors.password} announce>
              <PasswordInput
                id="provider-password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                invalid={!!errors.password}
              />
            </FormField>

            {result && <TestOutcome result={result} />}
          </div>

          <SheetFooter className="gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
            {result?.ok && (
              <Badge variant="outline" className="mr-auto self-center gap-1.5">
                <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
                Connection tested
              </Badge>
            )}
            <Button type="button" variant="outline" onClick={close} disabled={!!pending}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => void act("test")} disabled={!!pending}>
              {pending === "test" ? "Testing…" : "Test connection"}
            </Button>
            <Button type="submit" disabled={!!pending}>
              {pending === "save" ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
