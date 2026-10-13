"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { TriangleAlert } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ApiError, apiFetch, fieldErrors } from "@/lib/api"
import { secondStepPath } from "@/lib/mfa"
import {
  type InvitationDetails,
  acceptInvitation,
  declineInvitation,
  invitationDetails,
  registerAndAccept,
} from "@/lib/members"
import { initials } from "@/lib/session"

const NO_LONGER_VALID = "This invitation is no longer valid. Ask your Organization Administrator to send a new one."

type State = "loading" | "ready" | "invalid" | "declined"

/** Screen 05: UC-1.9 Accept Invitation, for every kind of visitor (alternatives 2a, 3a, 4a). */
export function AcceptInvitation({ token }: { token?: string }) {
  const router = useRouter()
  const [details, setDetails] = useState<InvitationDetails | null>(null)
  const [state, setState] = useState<State>(token ? "loading" : "invalid")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  // After "Decline" or "Switch account" the button is gone, so focus moves to the new heading.
  const heading = useRef<HTMLHeadingElement>(null)
  const moveFocus = useRef(false)

  const load = useCallback(() => {
    if (!token) return
    invitationDetails(token)
      .then((d) => {
        setDetails(d)
        setState("ready")
      })
      .catch(() => setState("invalid"))
  }, [token])
  useEffect(load, [load])

  useEffect(() => {
    if (state === "loading" || !moveFocus.current) return
    moveFocus.current = false
    heading.current?.focus()
  }, [state, details])

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setErrors({})
    try {
      const result = await action()
      // A new account in an organization that requires two-step verification sets it up first.
      const setupFirst = (result as { step?: string } | null)?.step === "mfa_setup"
      router.replace(setupFirst ? secondStepPath("mfa_setup") : "/dashboard") // step 6: the workspace
    } catch (error) {
      const fields = fieldErrors(error)
      if (error instanceof ApiError && error.code === "invitation_invalid") setState("invalid")
      else setErrors(Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
      setPending(false)
    }
  }

  async function decline() {
    if (!token) return
    setPending(true)
    moveFocus.current = true
    try {
      await declineInvitation(token)
      setState("declined")
    } catch {
      setState("invalid")
    } finally {
      setPending(false)
    }
  }

  async function switchAccount() {
    await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
    moveFocus.current = true
    setState("loading")
    load()
  }

  if (state === "loading") {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground" role="status">
          Opening your invitation…
        </p>
      </Shell>
    )
  }
  if (state === "invalid" || !details) {
    return (
      <Shell>
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
          Invitation not valid
        </h1>
        <p className="mt-3 text-sm">{NO_LONGER_VALID}</p>
        <Link href="/login" className="mt-6 inline-flex min-h-6 items-center text-sm font-medium text-link hover:underline">
          Go to login
        </Link>
      </Shell>
    )
  }
  if (state === "declined") {
    return (
      <Shell>
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
          Invitation declined
        </h1>
        <p className="mt-3 text-sm">
          You won&apos;t join {details.organization}.{details.invited_by && ` ${details.invited_by} has been told.`}
        </p>
      </Shell>
    )
  }

  const sameAccount = details.logged_in_as === details.email
  const otherAccount = !!details.logged_in_as && !sameAccount
  const newPerson = !details.logged_in_as && !details.has_account
  const loginHref = `/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`
  const article = /^[AEIOU]/.test(details.role_label) ? "an" : "a"

  return (
    <Shell>
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
        {initials(details.organization)}
      </div>
      <h1 ref={heading} tabIndex={-1} className="mt-4 text-xl font-semibold tracking-tight outline-none">
        Join {details.organization} on Sentra
      </h1>
      <p className="mt-1.5 text-sm text-text-secondary">
        {details.invited_by
          ? `${details.invited_by} invited you as ${article} ${details.role_label}.`
          : `You are invited as ${article} ${details.role_label}.`}
      </p>
      <p className="mt-4 rounded-[10px] border bg-muted p-3 text-sm">
        <span className="font-semibold">{details.role_label}</span>
        <span className="text-text-secondary">
          {" "}
          — {details.role_description.charAt(0).toLowerCase() + details.role_description.slice(1)}
        </span>
      </p>
      <p className="mt-4 text-sm">
        Invited address: <span className="font-medium break-all">{details.email}</span>
      </p>

      {errors.form && (
        <Alert variant="destructive" role="alert" className="mt-5">
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}

      {otherAccount && (
        <div className="mt-5 space-y-3">
          <p role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              You&apos;re logged in as {details.logged_in_as}. This invitation is for {details.email}.
            </span>
          </p>
          <Button variant="outline" className="h-9 w-full" onClick={switchAccount}>
            Switch account
          </Button>
        </div>
      )}

      {sameAccount && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">You&apos;re logged in as {details.email}.</p>
          <Button className="h-9 w-full hover:bg-primary-hover" disabled={pending} onClick={() => run(() => acceptInvitation(token!))}>
            {pending ? "Joining…" : "Accept invitation"}
          </Button>
        </div>
      )}

      {!details.logged_in_as && details.has_account && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">You already have a Sentra account. Log in with it to accept.</p>
          <Button asChild className="h-9 w-full hover:bg-primary-hover">
            <Link href={loginHref}>Log in to accept</Link>
          </Button>
        </div>
      )}

      {newPerson && (
        <form
          noValidate
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const found: Record<string, string> = {}
            if (!name.trim()) found.name = "Enter your full name."
            if (!password) found.password = "Choose a password."
            if (!acceptTerms) found.accept_terms = "You need to accept the terms to create an account. Sentra may only test systems you are allowed to test."
            setErrors(found)
            if (!Object.keys(found).length) void run(() => registerAndAccept(token!, name, password, acceptTerms))
          }}
        >
          <FormField id="email" label="Work e-mail">
            {/* Filled in and locked (WCAG 3.3.7); "username" lets a password manager save the new password for it. */}
            <Input id="email" name="email" value={details.email} readOnly autoComplete="username" aria-describedby="email-help" className="h-9 bg-muted" />
            <p id="email-help" className="text-xs text-muted-foreground">
              Confirmed by your invitation — no verification e-mail needed.
            </p>
          </FormField>
          <FormField id="name" label="Full name" error={errors.name}>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              className="h-9"
            />
          </FormField>
          <FormField id="password" label="Password" error={errors.password}>
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!errors.password} />
            <PasswordChecklist password={password} email={details.email} serverError={errors.password} />
          </FormField>
          <div className="space-y-1.5">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="accept_terms"
                checked={acceptTerms}
                onCheckedChange={(checked) => setAcceptTerms(checked === true)}
                aria-invalid={!!errors.accept_terms || undefined}
                aria-describedby={errors.accept_terms ? "accept_terms-error" : undefined}
                className="mt-0.5"
              />
              <label htmlFor="accept_terms" className="text-sm leading-snug">
                I agree to the Terms of Use and will test only AI applications that my organization owns or is
                authorized to test.
              </label>
            </div>
            {errors.accept_terms && (
              <p id="accept_terms-error" className="text-xs text-destructive">
                {errors.accept_terms}
              </p>
            )}
          </div>
          <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
            {pending ? "Creating account…" : "Create account and join"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href={loginHref} className="font-medium text-link hover:underline">
              Log in to accept
            </Link>
          </p>
        </form>
      )}

      <div className="mt-5 border-t pt-4 text-center">
        <Button variant="link" className="h-8 px-2 text-muted-foreground" disabled={pending} onClick={decline}>
          Decline invitation
        </Button>
      </div>
    </Shell>
  )
}

/** The 480 px card of Screen 05; every state uses it, so the card keeps its width. */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[480px] rounded-[10px] border bg-card p-8">{children}</div>
}
