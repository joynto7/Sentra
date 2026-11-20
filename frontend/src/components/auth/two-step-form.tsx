"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { CodeInput } from "@/components/auth/code-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, fieldErrors, safeNextPath } from "@/lib/api"
import { cancelLogin, pendingLogin, secondStepPath, verifyCode, verifyRecoveryCode } from "@/lib/mfa"

const LINK = "font-medium text-link underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
// Links on their own line are at least 24 px tall (WCAG 2.5.8).
const BLOCK_LINK = `${LINK} inline-flex min-h-6 items-center text-sm`

/**
 * Screen 02: UC-1.2 steps 3-5 after a correct password. The code from the authenticator app,
 * or a recovery code instead (4a); a wrong or old code asks for a new one (4b).
 */
export function TwoStepForm({ next }: { next?: string }) {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [mode, setMode] = useState<"app" | "recovery">("app")
  const [code, setCode] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [error, setError] = useState<string>()
  const [locked, setLocked] = useState<string>()
  const [pending, setPending] = useState(false)
  const codeField = useRef<HTMLInputElement>(null)
  const recoveryField = useRef<HTMLInputElement>(null)
  const switched = useRef(false) // focus moves only after the user switches between the two

  useEffect(() => {
    pendingLogin()
      .then((login) => {
        if (login.step === "mfa_setup") router.replace(secondStepPath("mfa_setup", next))
        else setEmail(login.email)
      })
      .catch(() => router.replace("/login?expired"))
  }, [router, next])

  useEffect(() => {
    if (!switched.current) return
    switched.current = false
    ;(mode === "app" ? codeField : recoveryField).current?.focus()
  }, [mode])

  function switchMode(to: "app" | "recovery") {
    switched.current = true
    setError(undefined)
    setMode(to)
  }

  async function backToLogin() {
    await cancelLogin().catch(() => undefined)
    router.replace("/login")
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const field = mode === "app" ? codeField : recoveryField
    if (mode === "app" && code.length !== 6) {
      setError("Enter the 6 digits that your app shows.")
      field.current?.focus()
      return
    }
    if (mode === "recovery" && !recoveryCode.trim()) {
      setError("Enter one of your recovery codes.")
      field.current?.focus()
      return
    }
    setPending(true)
    setError(undefined)
    try {
      await (mode === "app" ? verifyCode(code) : verifyRecoveryCode(recoveryCode))
      router.replace(safeNextPath(next)) // step 6: the workspace
    } catch (err) {
      setPending(false)
      if (err instanceof ApiError && err.code === "login_expired") {
        router.replace("/login?expired")
        return
      }
      if (err instanceof ApiError && err.status === 429) {
        setLocked(err.message) // the login has ended
        return
      }
      const fields = fieldErrors(err)
      setError(fields.code ?? fields.recovery_code ?? (err instanceof ApiError ? err.message : "Something went wrong. Try again."))
      if (mode === "app") setCode("")
      field.current?.focus()
    }
  }

  if (locked) {
    return (
      <AuthCard title="Two-step verification">
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{locked}</AlertDescription>
        </Alert>
        <Button className="h-9 w-full hover:bg-primary-hover" onClick={() => router.replace("/login")}>
          Back to login
        </Button>
      </AuthCard>
    )
  }

  if (!email) {
    return (
      <AuthCard title="Two-step verification">
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      </AuthCard>
    )
  }

  const errorId = mode === "app" ? "code-error" : "recovery-code-error"
  return (
    <>
      <AuthCard
        title="Two-step verification"
        description={
          <>
            {mode === "app" ? "Enter the 6-digit code from your authenticator app for " : "Enter one of the recovery codes you saved for "}
            <span className="font-medium text-foreground">{email}</span>.{" "}
            <button type="button" onClick={backToLogin} className={LINK}>
              Not you?
            </button>
          </>
        }
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          {mode === "app" ? (
            <div className="space-y-2.5">
              <Label htmlFor="code">Verification code</Label>
              <CodeInput
                ref={codeField}
                id="code"
                value={code}
                onChange={setCode}
                invalid={!!error}
                describedBy={error ? `${errorId} code-hint` : "code-hint"}
              />
              {error && (
                <p id={errorId} role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <p id="code-hint" className="text-xs text-muted-foreground">
                Codes change every 30 seconds.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="recovery-code">Recovery code</Label>
              <Input
                ref={recoveryField}
                id="recovery-code"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? `${errorId} recovery-hint` : "recovery-hint"}
                className="h-9 font-mono tracking-wider uppercase"
              />
              {error && (
                <p id={errorId} role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <p id="recovery-hint" className="text-xs text-muted-foreground">
                Each recovery code works only once.
              </p>
            </div>
          )}

          <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
          </Button>
          <button type="button" className={BLOCK_LINK} onClick={() => switchMode(mode === "app" ? "recovery" : "app")}>
            {mode === "app" ? "Use a recovery code instead" : "Use the code from your app instead"}
          </button>
        </form>
      </AuthCard>
      <button type="button" onClick={backToLogin} className={`${BLOCK_LINK} mt-5`}>
        Back to login
      </button>
    </>
  )
}
