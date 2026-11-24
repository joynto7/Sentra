"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, apiFetch, safeNextPath } from "@/lib/api"
import { type InvitationDetails, invitationDetails } from "@/lib/members"
import { type LoginResult, secondStepPath } from "@/lib/mfa"
import { startSso } from "@/lib/sso"

export function LoginForm({
  next,
  notice,
  problem,
}: {
  next?: string
  notice?: string
  /** Why a login through the identity provider did not finish (UC-1.5, 5a and 5b). */
  problem?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<ApiError | null>(null)
  const [pending, setPending] = useState(false)
  const [resent, setResent] = useState(false)
  const [invited, setInvited] = useState<InvitationDetails | null>(null)
  // UC-1.5 step 1: the same card asks for a company address instead of an address and a password.
  const [withSso, setWithSso] = useState(false)
  const [ssoProblem, setSsoProblem] = useState(problem ?? "")

  // Opened from "Log in to accept" (Screen 05): fill in the invited address so it is never typed again (WCAG 3.3.7).
  useEffect(() => {
    const token = invitationToken(next)
    if (!token) return
    invitationDetails(token)
      .then((details) => {
        setInvited(details)
        setEmail((typed) => typed || details.email)
      })
      .catch(() => undefined)
  }, [next])
  const shownNotice = notice ?? (invited && `Log in with ${invited.email} to join ${invited.organization}.`)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await apiFetch<LoginResult>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      // With two-step verification the code comes next (UC-1.2 steps 3-4), or its setup (3b).
      if (result.step === "done") router.replace(safeNextPath(next))
      else router.push(secondStepPath(result.step, next))
    } catch (err) {
      setError(err instanceof ApiError ? err : null)
      setPending(false)
    }
  }

  async function onSsoSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setSsoProblem("")
    try {
      const result = await startSso(email)
      if (result.authorization_url) {
        window.location.assign(result.authorization_url) // step 2: the provider's own login page
        return
      }
      setSsoProblem(result.message ?? "") // 2a: no provider is connected for this domain
    } catch (err) {
      setSsoProblem(err instanceof Error ? err.message : "Single sign-on is not available.")
    }
    setPending(false)
  }

  async function resendLink() {
    await apiFetch("/v1/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }).catch(() => undefined)
    setResent(true)
  }

  return (
    <>
      <AuthCard title="Log in to Sentra">
        {shownNotice && !error && (
          <Alert className="mb-5">
            <AlertDescription>{shownNotice}</AlertDescription>
          </Alert>
        )}
        {!withSso && ssoProblem && !error && (
          <Alert variant="destructive" className="mb-5" role="alert">
            <AlertDescription>{ssoProblem}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-5" role="alert">
            <AlertDescription>
              {error.code === "validation_error" ? "Enter a valid e-mail address and your password." : error.message}
              {error.code === "email_not_verified" && (
                <span className="mt-2 block">
                  {resent ? (
                    "We've sent a new link. Check your e-mail."
                  ) : (
                    <button type="button" onClick={resendLink} className="font-medium text-link underline-offset-4 hover:underline">
                      Send a new link
                    </button>
                  )}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {withSso ? (
          <form onSubmit={onSsoSubmit} className="space-y-4" noValidate>
            {ssoProblem && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{ssoProblem}</AlertDescription>
              </Alert>
            )}
            <FormField id="sso-email" label="Company e-mail">
              <Input
                id="sso-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-9"
                aria-describedby="sso-note"
              />
            </FormField>
            <p id="sso-note" className="text-[13px] text-muted-foreground">You go to your company&apos;s login page.</p>
            <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
              {pending ? "Taking you there…" : "Continue"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setWithSso(false)
                setSsoProblem("")
                setPending(false)
              }}
              className="flex h-9 w-full items-center justify-center text-sm font-medium text-link underline-offset-4 hover:underline"
            >
              Back to password login
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <FormField id="email" label="Work e-mail">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-9"
                />
              </FormField>
              <FormField
                id="password"
                label="Password"
                labelAction={
                  <Link href="/forgot-password" className="text-xs font-medium text-link hover:underline">
                    Forgot password?
                  </Link>
                }
              >
                <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
              </FormField>
              <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
                {pending ? "Logging in…" : "Log in"}
              </Button>
            </form>
            {/* Single sign-on is an equal way in, not a smaller one (FR-1.3, UC-1.5 step 1). */}
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full"
              onClick={() => {
                setWithSso(true)
                setError(null)
              }}
            >
              Log in with single sign-on
            </Button>
          </>
        )}
      </AuthCard>
      <p className="mt-5 text-sm text-muted-foreground">
        New to Sentra?{" "}
        <Link href="/register" className="font-medium text-link hover:underline">
          Create account
        </Link>
      </p>
    </>
  )
}

/** The invitation token when "next" is the accept-invitation page, else null. */
function invitationToken(next: string | undefined): string | null {
  const url = new URL(safeNextPath(next), "http://sentra.local")
  return url.pathname === "/invitations/accept" ? url.searchParams.get("token") : null
}
