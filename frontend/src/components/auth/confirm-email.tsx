"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { confirmEmailChange } from "@/lib/account"
import { ApiError } from "@/lib/api"

/** Opened from the link sent to a new e-mail address (UC-1.11, alternative 2a). */
export function ConfirmEmail({ token }: { token?: string }) {
  const started = useRef(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    token ? null : { ok: false, message: "This link has expired or has already been used." },
  )

  useEffect(() => {
    // The link works only once, so make sure it is sent only once.
    if (!token || started.current) return
    started.current = true
    confirmEmailChange(token)
      .then((response) => setResult({ ok: true, message: response.message }))
      .catch((error) =>
        setResult({ ok: false, message: error instanceof ApiError ? error.message : "Something went wrong. Try again." }),
      )
  }, [token])

  if (!result) {
    return (
      <AuthCard title="Confirming your new address">
        <p className="text-sm text-muted-foreground" role="status">
          One moment…
        </p>
      </AuthCard>
    )
  }
  return (
    <AuthCard title={result.ok ? "New address confirmed" : "Address not changed"}>
      {result.ok ? (
        <p className="text-sm" role="status">
          {result.message} Use it the next time you log in.
        </p>
      ) : (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      <p className="mt-6 text-sm">
        <Link href="/account/profile" className="font-medium text-link hover:underline">
          Go to your profile
        </Link>
      </p>
    </AuthCard>
  )
}
