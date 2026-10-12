"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { ResendLinkForm } from "@/components/auth/resend-link-form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { apiFetch } from "@/lib/api"

/** Opened from the link in the confirmation e-mail (UC-1.1 steps 6–7). */
export function VerifyEmail({ token }: { token?: string }) {
  const router = useRouter()
  const started = useRef(false)
  const [failed, setFailed] = useState(!token)

  useEffect(() => {
    // The link works only once, so make sure it is sent only once.
    if (!token || started.current) return
    started.current = true
    apiFetch("/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => router.replace("/login?verified=1"))
      .catch(() => setFailed(true))
  }, [token, router])

  if (!failed) {
    return (
      <AuthCard title="Confirming your e-mail address">
        <p className="text-sm text-muted-foreground" role="status">
          One moment…
        </p>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Confirm your e-mail address">
      <Alert variant="destructive" className="mb-5" role="alert">
        <AlertDescription>This link has expired or has already been used.</AlertDescription>
      </Alert>
      <ResendLinkForm />
      <p className="mt-5 text-sm">
        <Link href="/login" className="font-medium text-link hover:underline">
          Back to login
        </Link>
      </p>
    </AuthCard>
  )
}
