"use client"

import { useState } from "react"
import { TriangleAlert } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
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
import { ApiError, fieldErrors } from "@/lib/api"
import { confirmPassword } from "@/lib/mfa"
import { type SystemHealth, type Thresholds, setThresholds } from "@/lib/system-health"

const FIELDS = [
  { name: "queue_length", label: "Queue length (jobs waiting)", min: 1, max: 1_000_000 },
  { name: "error_rate_percent", label: "Error rate (% of requests)", min: 1, max: 100 },
  { name: "worker_load_percent", label: "Worker load (% of capacity)", min: 1, max: 100 },
  { name: "storage_percent", label: "Object storage (% of its disk)", min: 1, max: 100 },
  { name: "gateway_silence_minutes", label: "Gateway silence (minutes)", min: 1, max: 1_440 },
] as const

type Name = (typeof FIELDS)[number]["name"]

/**
 * Screen 63, "Alert thresholds": what the Monitoring component measures against (UC-10.9 step 3).
 * A change applies from the next tick of Sentra's own clock.
 */
export function ThresholdsDialog({
  thresholds,
  open,
  onClose,
  onSaved,
}: {
  thresholds: Thresholds
  open: boolean
  onClose: () => void
  onSaved: (health: SystemHealth) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {/* The form starts from the thresholds in force, so it is mounted with them. */}
        {open && <ThresholdsForm thresholds={thresholds} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function ThresholdsForm({
  thresholds,
  onClose,
  onSaved,
}: {
  thresholds: Thresholds
  onClose: () => void
  onSaved: (health: SystemHealth) => void
}) {
  const [values, setValues] = useState<Record<Name, string>>({
    queue_length: String(thresholds.queue_length),
    error_rate_percent: String(thresholds.error_rate_percent),
    worker_load_percent: String(thresholds.worker_load_percent),
    storage_percent: String(thresholds.storage_percent),
    gateway_silence_minutes: String(thresholds.gateway_silence_minutes),
  })
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    for (const field of FIELDS) {
      const value = Number(values[field.name])
      if (!values[field.name].trim() || !Number.isFinite(value) || value < field.min || value > field.max) {
        found[field.name] = `Use a number between ${field.min.toLocaleString("en-GB")} and ${field.max.toLocaleString("en-GB")}.`
      }
    }
    if (!password) found.password = "Enter your password to confirm."
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(true)
    try {
      await confirmPassword(password) // NFR-3.5, right before the thresholds change
      onSaved(
        await setThresholds({
          queue_length: Number(values.queue_length),
          error_rate_percent: Number(values.error_rate_percent),
          worker_load_percent: Number(values.worker_load_percent),
          storage_percent: Number(values.storage_percent),
          gateway_silence_minutes: Number(values.gateway_silence_minutes),
        }),
      )
      onClose()
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(
        Object.keys(fields).length
          ? fields
          : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." },
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form noValidate onSubmit={save}>
      <DialogHeader>
        <DialogTitle>Alert thresholds</DialogTitle>
        <DialogDescription>
          When a component passes one of these, Sentra raises an alert and tells the Platform
          Administrators. A change applies from the next check.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {errors.form && (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        {FIELDS.map((field) => (
          <FormField
            key={field.name}
            id={`threshold-${field.name}`}
            label={field.label}
            error={errors[field.name]}
          >
            <Input
              id={`threshold-${field.name}`}
              type="number"
              min={field.min}
              max={field.max}
              step={field.name === "error_rate_percent" ? "0.1" : "1"}
              inputMode="decimal"
              value={values[field.name]}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              aria-invalid={!!errors[field.name] || undefined}
              aria-describedby={errors[field.name] ? `threshold-${field.name}-error` : undefined}
              className="tabular h-9"
            />
          </FormField>
        ))}
        <FormField id="threshold-password" label="Confirm with your password" error={errors.password} announce>
          <PasswordInput
            id="threshold-password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            invalid={!!errors.password}
          />
        </FormField>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save thresholds"}
        </Button>
      </DialogFooter>
    </form>
  )
}
