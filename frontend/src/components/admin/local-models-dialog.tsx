"use client"

import { useState } from "react"
import { CircleCheck, Info, TriangleAlert } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
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
import { ApiError, fieldErrors } from "@/lib/api"
import { type DataSharing, type LLMTaskRow, setLocalModelsOnly } from "@/lib/data-and-ai"
import { listNames } from "@/lib/platform"

/**
 * Screen 59, turning "Local models only" on or off (UC-10.5 steps 3-6, 3a, 4a). Before the
 * administrator confirms with their password (NFR-3.5), the dialog says which functions become
 * unavailable and what each does then.
 */
export function LocalModelsDialog({
  target,
  tasks,
  onClose,
  onSaved,
}: {
  /** The setting to save: true turns the restriction on; null: closed */
  target: boolean | null
  tasks: LLMTaskRow[]
  onClose: () => void
  onSaved: (saved: DataSharing) => void
}) {
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  function close(open: boolean) {
    if (open) return
    setPassword("")
    setErrors({})
    onClose()
  }

  if (target === null) return null
  const missing = tasks.filter((t) => !t.local_model)
  const external = tasks.filter((t) => t.deployment === "external")
  const providers = [...new Set(external.map((t) => t.provider ?? "an external provider"))]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (target === null) return
    if (!password) {
      setErrors({ password: "Enter your password to confirm." })
      return
    }
    setPending(true)
    try {
      onSaved(await setLocalModelsOnly(target, password))
      close(false)
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{target ? "Use local models only?" : "Allow external providers again?"}</DialogTitle>
            <DialogDescription>
              {target
                ? "No data of the organization goes to an external LLM provider any more."
                : "Sentra uses the platform's configured providers again."}
            </DialogDescription>
          </DialogHeader>

          {target && missing.length > 0 && (
            <section aria-labelledby="local-check" className="rounded-lg border border-warning/50 p-3">
              <h3 id="local-check" className="flex items-start gap-2 text-sm font-semibold text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                No local model is configured for: {listNames(missing.map((t) => t.function))}.
              </h3>
              <p className="mt-1 text-sm text-text-secondary">
                These functions are unavailable until a Platform Administrator assigns local models; the Platform
                Administrators are told. Until then:
              </p>
              <ul className="mt-2 space-y-1.5">
                {missing.map((t) => (
                  <li key={t.task} className="text-sm text-text-secondary">
                    <span className="font-medium text-foreground">{t.function}:</span> {t.without_model}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {target && missing.length === 0 && (
            <p className="flex items-start gap-2 text-sm text-success">
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Every task has a local model, so all functions stay available.
            </p>
          )}
          {!target && (
            <p className="text-sm text-text-secondary">
              {external.length
                ? `${listNames(external.map((t) => t.function))} ${external.length === 1 ? "uses" : "use"} ${listNames(providers)} again; the data is masked before it leaves Sentra.`
                : "Every task uses a local model, so no data leaves the platform."}
            </p>
          )}

          <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
            <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Applies immediately, including to running campaign runs, and is recorded in the audit log.
          </p>

          <FormField id="local-models-password" label="Confirm with your password" error={errors.password}>
            <PasswordInput
              id="local-models-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              invalid={!!errors.password}
            />
          </FormField>
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={pending}>
              {pending ? "Saving…" : target ? "Use local models only" : "Allow external providers"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
