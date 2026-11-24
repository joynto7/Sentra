"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Gauge, LockKeyhole, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { SegmentedControl } from "@/components/sentra/segmented-control"
import { ConnectionTestCard } from "@/components/targets/connection-test"
import { CredentialFields, emptyRows } from "@/components/targets/credential-fields"
import { FormatFields, type FormatValue } from "@/components/targets/format-fields"
import { clearRegisterDraft, loadRegisterDraft, registerDraftAdapter, registerDraftKey } from "@/components/targets/register-draft"
import { VerifyOwnership } from "@/components/targets/verify-ownership"
import { TypeCards } from "@/components/targets/type-cards"
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
import { useSession } from "@/components/session-provider"
import { DraftStatus } from "@/components/wizard/status"
import { useDraftFeedback } from "@/components/wizard/use-draft-feedback"
import { ApiError, fieldErrors } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type AuthMode,
  type CredentialInput,
  type Environment,
  EXAMPLE_TEMPLATE,
  MAX_RATE,
  type Target,
  type TargetType,
  checkEndpoint,
  getTarget,
  credentialProblems,
  credentialsPayload,
  nameProblem,
  pathProblem,
  rateProblem,
  registerTarget,
  templateProblem,
  urlProblem,
} from "@/lib/targets"
import { cn } from "@/lib/utils"

const STEPS = ["Target details", "Connection format", "Credentials", "Test and verify"] as const
const STEP_OF_FIELD: Record<string, number> = {
  type: 1,
  name: 1,
  endpoint_url: 1,
  environment: 1,
  max_request_rate: 1,
  request_format: 2,
  request_template: 2,
  reply_path: 2,
  tool_calls_path: 2,
}

const NEXT_POINTS = [
  { icon: LockKeyhole, text: "Credentials are encrypted and never shown again." },
  { icon: ShieldCheck, text: "You prove ownership before any security test runs." },
  { icon: Gauge, text: "Sentra never sends requests faster than the rate you set." },
]

/** "What happens next" beside step 1: what the user can expect once the target is saved. */
function NextSteps() {
  return (
    <>
      <h2 id="next-heading" className="text-sm font-semibold">
        What happens next
      </h2>
      <ul className="mt-3 space-y-3">
        {NEXT_POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-sm text-text-secondary">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </>
  )
}

function clean(errors: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Record<string, string>
}

/** Screens 17 and 18: UC-2.1 Register Target, as a three-step wizard. */
export function RegisterWizard() {
  usePageCrumbs([{ label: "Register Target" }])
  const router = useRouter()
  const canManage = useCan("manage_targets")
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  const session = useSession()
  const draftId = registerDraftKey(session.id, session.organization?.id ?? "")
  // An unfinished registration of this person in this organization, if one was kept in this browser.
  // It holds no credential: those are asked for again.
  const [kept] = useState(() => (typeof window === "undefined" ? null : loadRegisterDraft(draftId)))
  const start = kept?.data

  const [step, setStep] = useState(start?.step ?? 1)
  const [finished, setFinished] = useState<number[]>(start ? Array.from({ length: start.step - 1 }, (_, i) => i + 1) : [])
  const [type, setType] = useState<TargetType | "">(start?.type ?? "")
  const [name, setName] = useState(start?.name ?? "")
  const [endpoint, setEndpoint] = useState(start?.endpoint ?? "")
  const [environment, setEnvironment] = useState<Environment>(start?.environment ?? "staging")
  const [rate, setRate] = useState(start?.rate ?? "20")
  const [format, setFormat] = useState<FormatValue>(
    start?.format ?? {
      request_format: "openai_chat",
      request_template: EXAMPLE_TEMPLATE,
      reply_path: "$.output.text",
      tool_calls_path: "",
    },
  )
  const [mode, setMode] = useState<AuthMode>(start?.mode ?? "api_key")
  const [rows, setRows] = useState<CredentialInput[]>(emptyRows(start?.mode ?? "api_key"))
  const [restoredAt, setRestoredAt] = useState<string | null>(kept?.savedAt ?? null)
  const adapter = useMemo(() => registerDraftAdapter(draftId), [draftId])
  const draft = useDraftFeedback(adapter, 500)
  const { noteEdit } = draft
  const skipFirst = useRef(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<"checking" | "saving" | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [saved, setSaved] = useState(false)
  const [registered, setRegistered] = useState<Target | null>(null)

  const dirty = !saved && Boolean(type || name || endpoint || rows.some((r) => r.value))
  // Only what a draft may hold is worth keeping; credentials are never part of it
  const worthKeeping = !saved && Boolean(type || name.trim() || endpoint.trim())
  const typedCredentials = rows.some((r) => r.value)

  // The identity and the format are kept on this device a moment after the last change.
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    if (worthKeeping) noteEdit({ step: Math.min(step, 3), type, name, endpoint, environment, rate, format, mode })
  }, [worthKeeping, step, type, name, endpoint, environment, rate, format, mode, noteEdit])

  // A changed step moves the focus to its heading, so keyboard and screen-reader users follow.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    heading.current?.focus()
  }, [step])

  // Leaving the page with unsaved input asks first (closing the tab, reloading).
  // Credentials are the one thing a draft does not keep, so leaving with some typed asks first.
  useEffect(() => {
    if (saved || !typedCredentials) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [saved, typedCredentials])

  if (canManage === false) {
    return (
      <EmptyState
        page
        title="You can't register targets"
        description="Ask an AI Application Developer."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/targets">Back to targets</Link>
          </Button>
        }
      />
    )
  }

  function go(next: number) {
    setErrors({})
    setFormError(null)
    setFinished((list) => (list.includes(step) ? list : [...list, step]))
    setStep(next)
  }

  async function nextFromDetails() {
    const found = clean({
      type: type ? undefined : "Choose what kind of application it is.",
      name: nameProblem(name),
      endpoint_url: urlProblem(endpoint),
      max_request_rate: rateProblem(rate),
    })
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy("checking")
    try {
      const checked = await checkEndpoint(endpoint)
      setEndpoint(checked.endpoint_url)
      go(2)
    } catch (error) {
      const fields = fieldErrors(error)
      if (fields.endpoint_url) setErrors({ endpoint_url: fields.endpoint_url })
      else setFormError(error instanceof ApiError ? error.message : "Something went wrong. Try again.")
    } finally {
      setBusy(null)
    }
  }

  function nextFromFormat() {
    const custom = format.request_format === "custom_json"
    const found = custom
      ? clean({
          request_template: templateProblem(format.request_template),
          reply_path: pathProblem(format.reply_path, true),
          tool_calls_path: pathProblem(format.tool_calls_path, false),
        })
      : {}
    setErrors(found)
    if (!Object.keys(found).length) go(3)
  }

  async function save() {
    const found = credentialProblems(mode, rows)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy("saving")
    setFormError(null)
    const custom = format.request_format === "custom_json"
    try {
      const target = await registerTarget({
        name,
        type,
        endpoint_url: endpoint,
        environment,
        max_request_rate: Number(rate),
        request_format: format.request_format,
        request_template: custom ? format.request_template : null,
        reply_path: custom ? format.reply_path : null,
        tool_calls_path: custom && format.tool_calls_path.trim() ? format.tool_calls_path : null,
        credentials: credentialsPayload(mode, rows),
      })
      setSaved(true)
      clearRegisterDraft(draftId)
      draft.reset()
      setRegistered(target)
      setFinished([1, 2, 3])
      setStep(4)
      toast.success(`${target.name} is registered`, {
        description: "Sentra is testing the connection. Prove ownership to let campaigns run.",
      })
    } catch (error) {
      const fields = fieldErrors(error)
      if (Object.keys(fields).length) {
        // Back to the first step that has an error (UC-2.1, 5a).
        const first = Math.min(...Object.keys(fields).map((f) => STEP_OF_FIELD[f] ?? 3))
        setErrors(fields)
        setStep(first)
      } else {
        setFormError(error instanceof ApiError ? error.message : "Something went wrong. Try again.")
      }
    } finally {
      setBusy(null)
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    if (step === 1) void nextFromDetails()
    else if (step === 2) nextFromFormat()
    else void save()
  }

  const verifying = step === 4 && registered !== null
  const primary =
    step === 1
      ? busy === "checking"
        ? "Checking the address…"
        : "Next: Connection format"
      : step === 2
        ? "Next: Credentials"
        : busy === "saving"
          ? "Saving…"
          : "Save target"

  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Register Target</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step {step} of {STEPS.length}
            {step > 1 && name.trim() ? ` · ${name.trim()}` : ""}
          </p>
          {!verifying && <DraftStatus feedback={draft.feedback} onRetry={() => void draft.retry()} className="mt-1" />}
        </div>
        {!verifying && (
          <Button
            variant="outline"
            className="h-9"
            onClick={() => (dirty ? setConfirmCancel(true) : router.push("/targets"))}
          >
            Cancel
          </Button>
        )}
      </div>

      {restoredAt && !saved && (
        <Alert className="mb-5" role="status">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Your unfinished target from {new Date(restoredAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} was restored. Credentials are
              never kept in a draft, so you enter them again. Nothing has been registered.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                clearRegisterDraft(draftId)
                draft.reset()
                setStep(1)
                setFinished([])
                setType("")
                setName("")
                setEndpoint("")
                setEnvironment("staging")
                setRate("20")
                setFormat({ request_format: "openai_chat", request_template: EXAMPLE_TEMPLATE, reply_path: "$.output.text", tool_calls_path: "" })
                setMode("api_key")
                setRows(emptyRows("api_key"))
                setRestoredAt(null)
              }}
            >
              Start over
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,720px)]">
        <div className="flex flex-col gap-6">
          <nav aria-label="Registration steps">
            <ol className="flex flex-wrap gap-x-6 gap-y-2 lg:flex-col lg:gap-1">
              {STEPS.map((label, i) => {
                const number = i + 1
                const current = number === step
                // Once the target is registered its details are changed on its own page, not here.
                const done = finished.includes(number) && !current
                const content = (
                  <>
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                        current && "border-primary bg-primary text-primary-foreground",
                        done && "border-success bg-success text-white dark:text-background",
                      )}
                      aria-hidden="true"
                    >
                      {done ? <Check className="size-3.5" /> : number}
                    </span>
                    <span className={cn("text-sm", current ? "font-semibold" : "text-muted-foreground")}>{label}</span>
                    {done && <span className="sr-only">(finished)</span>}
                  </>
                )
                return (
                  <li key={label}>
                    {done && !registered ? (
                      <button
                        type="button"
                        onClick={() => setStep(number)}
                        className="flex min-h-9 items-center gap-2.5 rounded-md px-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {content}
                      </button>
                    ) : (
                      <span aria-current={current ? "step" : undefined} className="flex min-h-9 items-center gap-2.5 px-1">
                        {content}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>

          {step === 1 && (
            <aside aria-labelledby="next-heading" className="hidden rounded-[10px] border bg-card p-5 lg:block">
              <NextSteps />
            </aside>
          )}
        </div>

        {verifying ? (
          <div className="min-w-0 space-y-5">
            <h2 id="step-heading" ref={heading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
              {STEPS[3]}
            </h2>
            <ConnectionTestCard target={registered} />
            <VerifyOwnership
              target={registered}
              onVerified={() => void getTarget(registered.id).then(setRegistered).catch(() => undefined)}
              footer={
                <Button variant="outline" className="h-9" onClick={() => router.push(`/targets/${registered.id}`)}>
                  Finish later
                </Button>
              }
            />
            <p className="text-xs text-muted-foreground">Saved as Unverified until the check succeeds.</p>
          </div>
        ) : (
        <form onSubmit={onSubmit} noValidate aria-labelledby="step-heading" className="min-w-0 rounded-[10px] border bg-card p-6">
          <h2 id="step-heading" ref={heading} tabIndex={-1} className="mb-5 text-[15px] font-semibold outline-none">
            {STEPS[step - 1]}
          </h2>

          {formError && (
            <Alert variant="destructive" role="alert" className="mb-5">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <TypeCards value={type} onChange={setType} error={errors.type} />
              <FormField id="name" label="Name" error={errors.name}>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  className="h-9"
                />
              </FormField>
              <FormField id="endpoint_url" label="Endpoint URL" error={errors.endpoint_url}>
                <Input
                  id="endpoint_url"
                  type="url"
                  inputMode="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={!!errors.endpoint_url || undefined}
                  aria-describedby={errors.endpoint_url ? "endpoint_url-error" : "endpoint_url-help"}
                  className="h-9 font-mono text-[13px]"
                />
                {!errors.endpoint_url && (
                  <p id="endpoint_url-help" className="text-xs text-muted-foreground">
                    The address Sentra sends its requests to. It must be reachable from the internet.
                  </p>
                )}
              </FormField>
              <div className="space-y-1.5">
                <span id="environment-label" className="text-sm font-medium">
                  Environment
                </span>
                <SegmentedControl<Environment>
                  value={environment}
                  onChange={setEnvironment}
                  labelledBy="environment-label"
                  describedBy="environment-help"
                  options={[
                    { value: "staging", label: "Staging" },
                    { value: "production", label: "Production" },
                  ]}
                />
                <p id="environment-help" className="text-xs text-muted-foreground">
                  Test in staging first. Production tests reach the systems your users rely on.
                </p>
              </div>
              <FormField id="max_request_rate" label="Maximum safe request rate" error={errors.max_request_rate}>
                <div className="flex items-center gap-2">
                  <Input
                    id="max_request_rate"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_RATE}
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    aria-invalid={!!errors.max_request_rate || undefined}
                    aria-describedby={errors.max_request_rate ? "max_request_rate-error" : "max_request_rate-help"}
                    className="tabular h-9 w-28"
                  />
                  <span className="text-sm text-muted-foreground">requests per minute</span>
                </div>
                {!errors.max_request_rate && (
                  <p id="max_request_rate-help" className="text-xs text-muted-foreground">
                    Sentra never sends faster than this.
                  </p>
                )}
              </FormField>
            </div>
          )}

          {step === 2 && <FormatFields value={format} onChange={setFormat} errors={errors} type={type} />}

          {step === 3 && (
            <>
              <CredentialFields mode={mode} rows={rows} onModeChange={setMode} onRowsChange={setRows} errors={errors} />
              <p className="mt-5 rounded-[10px] bg-muted/60 p-3.5 text-sm text-text-secondary">
                <span className="font-medium text-foreground">What “Save target” does: </span>
                it registers the target as Unverified, encrypts these credentials (never shown again, never kept in a draft) and then sends one connection-test request to the endpoint. No security
                test runs and no campaign can run until you prove ownership on the next step.
              </p>
            </>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t pt-5">
            <Button type="button" variant="outline" className="h-9" disabled={step === 1 || !!busy} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={!!busy} aria-live="polite">
              {primary}
            </Button>
          </div>
        </form>
        )}

        {step === 1 && (
          <aside aria-labelledby="next-heading" className="rounded-[10px] border bg-card p-5 lg:hidden">
            <NextSteps />
          </aside>
        )}
      </div>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Leave this registration?</DialogTitle>
            <DialogDescription>
              Nothing is registered. Your answers so far, without any credentials, are kept on this device, so you can carry on later, or you can discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button variant="outline" className="h-9" onClick={() => router.push("/targets")}>
              Leave, keep the draft
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              onClick={() => {
                clearRegisterDraft(draftId)
                setSaved(true)
                router.push("/targets")
              }}
            >
              Discard the draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
