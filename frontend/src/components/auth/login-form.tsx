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

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<ApiError | null>(null)
  const [pending, setPending] = useState(false)
  const [resent, setResent] = useState(false)
  const [invited, setInvited] = useState<InvitationDetails | null>(null)

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
      await apiFetch("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      router.replace(safeNextPath(next))
    } catch (err) {
      setError(err instanceof ApiError ? err : null)
      setPending(false)
    }
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
