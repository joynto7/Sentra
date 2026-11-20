"use client"

import { useEffect, useRef, useState } from "react"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { ConnectApp, SaveRecoveryCodes, StepIndicator } from "@/components/auth/two-step-setup"
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
import { type MfaSetup, enableMfa, renewRecoveryCodes, startSetup } from "@/lib/mfa"

function message(error: unknown): string {
  return fieldErrors(error).password ?? (error instanceof ApiError ? error.message : "Something went wrong. Try again.")
}

/** The password step of both dialogs (UC-1.4 step 2, alternative 2a; NFR-3.5). */
function PasswordStep({
  intro,
  action,
  pendingLabel,
  onConfirm,
}: {
  intro: string
  action: string
  pendingLabel: string
  onConfirm: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!password) {
      setError("Enter your password.")
      document.getElementById("again-password")?.focus()
      return
    }
    setPending(true)
    setError(undefined)
    try {
      await onConfirm(password)
    } catch (err) {
      setError(message(err))
      setPending(false)
      document.getElementById("again-password")?.focus()
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-text-secondary">{intro}</p>
      <FormField id="again-password" label="Password" error={error} announce>
        <PasswordInput id="again-password" value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
      </FormField>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-9">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={pending}>
          {pending ? pendingLabel : action}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** While the recovery codes are shown, only "Finish" closes the dialog: they appear only once. */
function keepOpen(locked: boolean) {
  return {
    showCloseButton: !locked,
    onEscapeKeyDown: (event: Event) => locked && event.preventDefault(),
    onInteractOutside: (event: Event) => locked && event.preventDefault(),
  }
}

/**
 * Screen 10 over the Security page: UC-1.4 Enable Multi-Factor Authentication. The password
 * again (steps 1-2, 2a), the app (steps 3-5, 5a), then the recovery codes (step 6).
 */
export function SetUpTwoStepDialog({
  open,
  email,
  onOpenChange,
  onEnabled,
}: {
  open: boolean
  email: string
  onOpenChange: (open: boolean) => void
  onEnabled: () => void
}) {
  const [step, setStep] = useState(0)
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const scanHeading = useRef<HTMLHeadingElement>(null)
  const codesHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    // Each new step starts at its heading, so its instructions are read first.
    if (step === 1) scanHeading.current?.focus()
    if (step === 2) codesHeading.current?.focus()
  }, [step])

  function reset() {
    setStep(0)
    setSetup(null)
    setCodes(null)
  }

  function close(next: boolean) {
    if (next || step === 2) return
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-[600px]" {...keepOpen(step === 2)}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Set up two-step verification</DialogTitle>
          <DialogDescription className="sr-only">
            Three steps: confirm your password, connect your authenticator app, save your recovery codes.
          </DialogDescription>
        </DialogHeader>
        <StepIndicator steps={["Confirm password", "Connect your app", "Save recovery codes"]} current={step} />
        {step === 0 && (
          <PasswordStep
            intro="For your security, enter your password again."
            action="Continue"
            pendingLabel="Checking…"
            onConfirm={async (password) => {
              setSetup(await startSetup(password))
              setStep(1)
            }}
          />
        )}
        {step === 1 && setup && (
          <ConnectApp
            setup={setup}
            headingRef={scanHeading}
            onVerify={async (code) => {
              setCodes((await enableMfa(code)).recovery_codes)
              setStep(2)
            }}
            secondary={
              <DialogClose asChild>
                <Button type="button" variant="outline" className="h-9">
                  Cancel
                </Button>
              </DialogClose>
            }
          />
        )}
        {step === 2 && codes && (
          <SaveRecoveryCodes
            codes={codes}
            email={email}
            headingRef={codesHeading}
            onFinish={() => {
              reset()
              onEnabled()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** "Generate new codes" on the Security page: the password again, then ten new codes that
 * replace all earlier ones. */
export function NewRecoveryCodesDialog({
  open,
  email,
  onOpenChange,
  onRenewed,
}: {
  open: boolean
  email: string
  onOpenChange: (open: boolean) => void
  onRenewed: () => void
}) {
  const [codes, setCodes] = useState<string[] | null>(null)
  const codesHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (codes) codesHeading.current?.focus()
  }, [codes])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !codes && onOpenChange(false)}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-[560px]" {...keepOpen(!!codes)}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Generate new recovery codes</DialogTitle>
          <DialogDescription className={codes ? "sr-only" : undefined}>
            Ten new codes replace all of your current recovery codes, used or not.
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <SaveRecoveryCodes
            codes={codes}
            email={email}
            finishLabel="Done"
            headingRef={codesHeading}
            onFinish={() => {
              setCodes(null)
              onRenewed()
            }}
          />
        ) : (
          <PasswordStep
            intro="For your security, enter your password again."
            action="Generate new codes"
            pendingLabel="Generating…"
            onConfirm={async (password) => setCodes((await renewRecoveryCodes(password)).recovery_codes)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
