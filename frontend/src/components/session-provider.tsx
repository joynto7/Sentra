"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { ApiError, apiFetch } from "@/lib/api"
import type { SessionUser } from "@/lib/session"
import { forgetKeptLists } from "@/lib/kept-lists"

const SessionContext = createContext<SessionUser | null>(null)

/**
 * Loads the logged-in user. Without a valid session, it sends the browser to the login page.
 * Pages inside the app also need an organization; without one, the user creates it first.
 */
export function SessionProvider({
  children,
  requireOrganization = true,
}: {
  children: React.ReactNode
  requireOrganization?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<SessionUser>("/v1/auth/me")
      .then((me) => {
        if (cancelled) return
        if (requireOrganization && !me.organization) {
          // A Platform Administrator without an organization works on the platform pages.
          router.replace(me.platform_admin ? "/platform/accounts" : "/organizations/new")
          return
        }
        setUser(me)
      })
      .catch(async (error) => {
        if (cancelled || !(error instanceof ApiError) || error.status !== 401) return
        // Remove the expired cookie, then log in again and come back here.
        await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
        forgetKeptLists() // Back to a list keeps nothing of this person (UX task 3.0)
        router.replace(`/login?next=${encodeURIComponent(pathname)}`)
      })
    return () => {
      cancelled = true
    }
  }, [router, pathname, requireOrganization])

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
