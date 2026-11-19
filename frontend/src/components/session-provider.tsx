"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { ApiError, apiFetch } from "@/lib/api"
import type { SessionUser } from "@/lib/session"

const SessionContext = createContext<SessionUser | null>(null)

/** Loads the logged-in user. Without a valid session, it sends the browser to the login page. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<SessionUser>("/v1/auth/me")
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(async (error) => {
        if (cancelled || !(error instanceof ApiError) || error.status !== 401) return
        // Remove the expired cookie, then log in again and come back here.
        await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
        router.replace(`/login?next=${encodeURIComponent(pathname)}`)
      })
    return () => {
      cancelled = true
    }
  }, [router, pathname])

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    )
  }
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
}

export function useSession(): SessionUser {
  const user = useContext(SessionContext)
  if (!user) throw new Error("useSession must be used inside SessionProvider")
  return user
}
