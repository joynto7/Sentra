"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { FormField } from "@/components/auth/form-field"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { ApiError, apiFetch, fieldErrors } from "@/lib/api"
import { cn } from "@/lib/utils"

/** UC-1.3 steps 3–6, opened from the link in the reset e-mail. */
export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [linkInvalid, setLinkInvalid] = useState(!token)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setErrors({ confirm: "The passwords don't match." })
      return
    }
    setPending(true)
    setErrors({})
    try {
      await apiFetch("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      })
      router.replace("/login?reset=1")
    } catch (err) {
      if (err instanceof ApiError && err.code === "link_invalid") setLinkInvalid(true)
      else setErrors(fieldErrors(err))
      setPending(false)
    }
  }

  if (linkInvalid) {
    return (
      <AuthCard title="Choose a new password">
        <Alert variant="destructive" className="mb-5" role="alert">
          <AlertDescription>This reset link has expired or has already been used.</AlertDescription>
        </Alert>
        <Link href="/forgot-password" className={cn(buttonVariants(), "h-9 w-full hover:bg-primary-hover")}>
          Send a new link
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="new_password" label="New password" error={errors.new_password}>
          <PasswordInput
            id="new_password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={!!errors.new_password}
          />
          <PasswordChecklist password={password} serverError={errors.new_password} />
        </FormField>
        <FormField id="confirm" label="Confirm new password" error={errors.confirm}>
          <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!errors.confirm} />
        </FormField>
        <Alert>
          <AlertDescription>For your security, all your sessions will be logged out.</AlertDescription>
        </Alert>
        <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
          Set new password
        </Button>
      </form>
    </AuthCard>
  )
}
