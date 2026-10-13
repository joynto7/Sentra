"use client"

import { Fragment, useRef, useState } from "react"
import { Check, Download, TriangleAlert } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { CopyButton } from "@/components/sentra/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, fieldErrors } from "@/lib/api"
import { type MfaSetup, groupKey, recoveryCodesText } from "@/lib/mfa"
import { cn } from "@/lib/utils"

// The steps of Screen 10, shared by the dialog on the Security page and the setup during a login.

/** "1 Confirm password ✓ · 2 Connect your app · 3 Save recovery codes": where the user is. */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
      {steps.map((step, i) => {
        const done = i < current
        return (
          <li
            key={step}
            aria-current={i === current ? "step" : undefined}
            className={cn("flex items-center gap-1.5", i === current ? "font-medium text-foreground" : "text-text-secondary")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "tabular flex size-5 items-center justify-center rounded-full border text-[11px]",
                done && "border-primary bg-primary text-primary-foreground",
                i === current && "border-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            {step}
            {done && <span className="sr-only">, done</span>}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * UC-1.4 steps 3-5 (5a): the QR code, the same secret as a key to type in, and the first code
 * from the app. `onVerify` turns two-step verification on and moves to the recovery codes.
 */
export function ConnectApp({
  setup,
  onVerify,
  secondary,
  headingRef,
  level = 3,
}: {
  setup: MfaSetup
  onVerify: (code: string) => Promise<void>
  /** "Cancel" in the dialog, "Log out" during a login */
  secondary: React.ReactNode
  headingRef?: React.Ref<HTMLHeadingElement>
  /** 3 under the dialog's title, 2 under the page's heading */
  level?: 2 | 3
}) {
  const Heading = level === 2 ? "h2" : "h3"
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const digits = code.replace(/\D/g, "")
    if (digits.length !== 6) {
      setError("Enter the 6-digit code that your app shows.")
      field.current?.focus()
      return
    }
    setPending(true)
    setError(undefined)
    try {
      await onVerify(digits)
    } catch (err) {
      setError(fieldErrors(err).code ?? (err instanceof ApiError ? err.message : "Something went wrong. Try again."))
      setCode("")
      field.current?.focus()
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <section aria-labelledby="scan-heading" className="space-y-3">
        <Heading id="scan-heading" ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
          Scan this QR code with your authenticator app
        </Heading>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* A data: URI made by the API, so Next's image optimizer has nothing to do. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr_code}
            alt="QR code for your authenticator app. If you can't scan it, type the key shown next to it."
            width={168}
            height={168}
            className="size-[168px] shrink-0 rounded-md border bg-white"
          />
          <div className="min-w-0 space-y-2 text-sm">
            <p className="text-text-secondary">Can&apos;t scan it? Enter this key instead:</p>
            <p className="font-mono text-[15px] tracking-wide">
              {/* A line may break between the groups of four, never inside one. */}
              {groupKey(setup.secret)
                .split(" ")
                .map((group, i) => (
                  <Fragment key={i}>
                    {i > 0 && " "}
                    <span className="whitespace-nowrap">{group}</span>
                  </Fragment>
                ))}
            </p>
            <CopyButton text={setup.secret} description="Copy the key" />
          </div>
        </div>
      </section>

      <FormField id="setup-code" label="6-digit code from the app" error={error} announce>
        <Input
          ref={field}
          id="setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          aria-invalid={!!error || undefined}
          aria-describedby={[error && "setup-code-error", "setup-code-hint"].filter(Boolean).join(" ")}
          className="h-9 w-40 font-mono tracking-widest"
        />
      </FormField>
      <p id="setup-code-hint" className="-mt-3 text-xs text-muted-foreground">
        Works with any authenticator app that supports time-based codes (TOTP).
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {secondary}
        <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={pending}>
          {pending ? "Verifying…" : "Verify and continue"}
        </Button>
      </div>
    </form>
  )
}

/**
 * UC-1.4 step 6: the ten recovery codes, shown only this once. "Finish" waits for the checkbox,
 * so nobody skips past them by accident.
 */
export function SaveRecoveryCodes({
  codes,
  email,
  finishLabel = "Finish",
  onFinish,
  headingRef,
  level = 3,
}: {
  codes: string[]
  email: string
  finishLabel?: string
  onFinish: () => void
  headingRef?: React.Ref<HTMLHeadingElement>
  level?: 2 | 3
}) {
  const [saved, setSaved] = useState(false)
  const Heading = level === 2 ? "h2" : "h3"

  function download() {
    const url = URL.createObjectURL(new Blob([recoveryCodesText(codes, email)], { type: "text/plain" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "sentra-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <Heading ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
        Save your recovery codes
      </Heading>
      <Alert role="note" className="border-warning/60 bg-warning/10">
        <TriangleAlert aria-hidden="true" className="text-warning" />
        <AlertTitle>Each code can be used once if you lose your phone.</AlertTitle>
        <AlertDescription>They won&apos;t be shown again. Keep them somewhere safe, such as a password manager.</AlertDescription>
      </Alert>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-[10px] border bg-muted/40 px-5 py-4 font-mono text-[15px] tracking-wide">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={codes.join("\n")} label="Copy all" copiedLabel="All codes copied" className="h-9 gap-1.5" />
        <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={download}>
          <Download aria-hidden="true" />
          Download .txt
        </Button>
      </div>
      <div className="flex items-start gap-2.5">
        <Checkbox id="codes-saved" checked={saved} onCheckedChange={(value) => setSaved(value === true)} className="mt-0.5" />
        <Label htmlFor="codes-saved" className="text-sm leading-snug font-normal">
          I have saved these codes somewhere safe
        </Label>
      </div>
      <div className="flex justify-end">
        <Button type="button" className="h-9 hover:bg-primary-hover" disabled={!saved} onClick={onFinish}>
          {finishLabel}
        </Button>
      </div>
    </div>
  )
}
