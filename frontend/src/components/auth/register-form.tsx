"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail } from "lucide-react"

import { AuthCard } from "@/components/auth/auth-card"
import { FormField } from "@/components/auth/form-field"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ApiError, apiFetch, fieldErrors } from "@/lib/api"

// Friendlier wording for the API's format errors.
const FRIENDLY_ERRORS: Record<string, string> = {
  name: "Enter your full name.",
  email: "Enter a valid e-mail address, for example name@company.com.",
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  return domain ? `${local.slice(0, 1)}****@${domain}` : email
}

export function RegisterForm() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setErrors({})
    setFormError(null)
    try {
      await apiFetch("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, accept_terms: acceptTerms }),
      })
      setSentTo(email)
    } catch (err) {
      const fields = Object.fromEntries(
        Object.entries(fieldErrors(err)).map(([field, message]) => [field, FRIENDLY_ERRORS[field] ?? message]),
      )
      setErrors(fields)
      if (Object.keys(fields).length === 0) {
        setFormError(err instanceof ApiError ? err.message : "Something went wrong. Try again.")
      }
    } finally {
      setPending(false)
    }
  }

  async function resend() {
    await apiFetch("/v1/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email: sentTo }),
    }).catch(() => undefined)
    setResent(true)
  }

  if (sentTo) {
    return (
      <AuthCard title="Check your e-mail" wide>
        <Mail className="mb-4 size-10 text-muted-foreground" strokeWidth={1.25} aria-hidden="true" />
        <p className="text-sm">
          We&apos;ve sent a verification link to <span className="font-medium">{maskEmail(sentTo)}</span>. The link
          works once and is valid for 24 hours.
        </p>
        <div className="mt-6 flex items-center gap-4">
          <Button variant="outline" className="h-9" onClick={resend} disabled={resent}>
            {resent ? "Link sent again" : "Resend link"}
          </Button>
          <Link href="/login" className="text-sm font-medium text-link hover:underline">
            Back to login
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <>
      <AuthCard title="Create your Sentra account" wide>
        {formError && (
          <Alert variant="destructive" className="mb-5" role="alert">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="name" label="Full name" error={errors.name}>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              className="h-9"
            />
          </FormField>
          <FormField id="email" label="Work e-mail" error={errors.email}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-invalid={!!errors.email || undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
              className="h-9"
            />
          </FormField>
          <FormField id="password" label="Password" error={errors.password}>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              invalid={!!errors.password}
            />
            <PasswordChecklist password={password} email={email} serverError={errors.password} />
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
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </AuthCard>
      <p className="mt-5 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-link hover:underline">
          Log in
        </Link>
      </p>
    </>
  )
}
