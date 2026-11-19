"use client"

import { useState } from "react"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { FormField } from "@/components/auth/form-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiFetch } from "@/lib/api"

const SENT =
  "If an account exists for this address, we've sent a reset link. It expires in 30 minutes."

/** UC-1.3 steps 1–2. The answer is the same whether or not the account exists. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await apiFetch("/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) })
      setSent(true)
    } catch {
      setError("Enter a valid e-mail address, for example name@company.com.")
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard title="Reset your password" description="Enter your work e-mail and we'll send you a reset link.">
      {sent ? (
        <Alert className="mb-5" role="status">
          <AlertDescription>{SENT}</AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="email" label="Work e-mail" error={error ?? undefined}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "email-error" : undefined}
              className="h-9"
            />
          </FormField>
          <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-5 text-sm">
        <Link href="/login" className="font-medium text-link hover:underline">
          Back to login
        </Link>
      </p>
    </AuthCard>
  )
}
