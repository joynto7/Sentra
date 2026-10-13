"use client"

import { useState } from "react"
import { Eye, EyeOff, LockKeyhole, Plus, X } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AUTH_LABEL, type AuthMode, type CredentialInput } from "@/lib/targets"

const MAX_HEADERS = 10

export function emptyRows(mode: AuthMode): CredentialInput[] {
  if (mode === "none") return []
  const name = mode === "api_key" ? "X-Api-Key" : mode === "bearer_token" ? "Authorization" : ""
  return [{ credential_type: mode, name, value: "" }]
}

/** A secret typed into a masked field, with a show/hide button for checking what was typed. */
function SecretInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="h-9 pr-10 font-mono text-[13px]"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={visible ? "Hide value" : "Show value"}
        aria-controls={id}
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
}

/** "How does Sentra authenticate?" and the matching fields (UC-2.1 step 4, FR-2.2). */
export function CredentialFields({
  mode,
  rows,
  onModeChange,
  onRowsChange,
  errors,
}: {
  mode: AuthMode
  rows: CredentialInput[]
  onModeChange: (mode: AuthMode) => void
  onRowsChange: (rows: CredentialInput[]) => void
  errors: Record<string, string>
}) {
  const setRow = (i: number, patch: Partial<CredentialInput>) =>
    onRowsChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="auth-mode">How does Sentra authenticate?</Label>
        <Select
          value={mode}
          onValueChange={(next) => {
            onModeChange(next as AuthMode)
            onRowsChange(emptyRows(next as AuthMode))
          }}
        >
          <SelectTrigger id="auth-mode" className="h-9 w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AUTH_LABEL) as AuthMode[]).map((option) => (
              <SelectItem key={option} value={option}>
                {AUTH_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.credentials && <p className="text-xs text-destructive">{errors.credentials}</p>}
      </div>

      {mode === "api_key" && rows[0] && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="credentials.0.name" label="Header name" error={errors["credentials.0.name"]}>
            <Input
              id="credentials.0.name"
              value={rows[0].name}
              onChange={(e) => setRow(0, { name: e.target.value })}
              spellCheck={false}
              aria-invalid={!!errors["credentials.0.name"] || undefined}
              aria-describedby={errors["credentials.0.name"] ? "credentials.0.name-error" : undefined}
              className="h-9 font-mono text-[13px]"
            />
          </FormField>
          <FormField id="credentials.0.value" label="API key" error={errors["credentials.0.value"]}>
            <SecretInput id="credentials.0.value" value={rows[0].value} onChange={(v) => setRow(0, { value: v })} invalid={!!errors["credentials.0.value"]} />
          </FormField>
        </div>
      )}

      {mode === "bearer_token" && rows[0] && (
        <FormField id="credentials.0.value" label="Bearer token" error={errors["credentials.0.value"]}>
          <SecretInput id="credentials.0.value" value={rows[0].value} onChange={(v) => setRow(0, { value: v })} invalid={!!errors["credentials.0.value"]} />
          {!errors["credentials.0.value"] && (
            <p className="text-xs text-muted-foreground">Sent as &quot;Authorization: Bearer …&quot;. Paste the token without the word Bearer.</p>
          )}
        </FormField>
      )}

      {mode === "custom_header" && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium">Headers</legend>
          {rows.map((row, i) => (
            <div key={i} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <FormField id={`credentials.${i}.name`} label={`Header ${i + 1} name`} error={errors[`credentials.${i}.name`]}>
                <Input
                  id={`credentials.${i}.name`}
                  value={row.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  spellCheck={false}
                  aria-invalid={!!errors[`credentials.${i}.name`] || undefined}
                  aria-describedby={errors[`credentials.${i}.name`] ? `credentials.${i}.name-error` : undefined}
                  className="h-9 font-mono text-[13px]"
                />
              </FormField>
              <FormField id={`credentials.${i}.value`} label={`Header ${i + 1} value`} error={errors[`credentials.${i}.value`]}>
                <SecretInput id={`credentials.${i}.value`} value={row.value} onChange={(v) => setRow(i, { value: v })} invalid={!!errors[`credentials.${i}.value`]} />
              </FormField>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6 size-9"
                aria-label={`Remove header ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={rows.length >= MAX_HEADERS}
            onClick={() => onRowsChange([...rows, { credential_type: "custom_header", name: "", value: "" }])}
          >
            <Plus aria-hidden="true" />
            Add header
          </Button>
        </fieldset>
      )}

      {mode === "none" && (
        <p className="rounded-[10px] border bg-muted p-3 text-sm text-text-secondary">
          Sentra will call the endpoint without credentials. Choose this only if the endpoint doesn&apos;t need any.
        </p>
      )}

      {mode !== "none" && (
        <p className="flex items-start gap-2.5 rounded-[10px] border bg-muted p-3 text-sm text-text-secondary">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Encrypted with AES-256 before it&apos;s stored. Only Sentra&apos;s workers use it, and you won&apos;t be able to view it again.
        </p>
      )}
    </div>
  )
}
