"use client"

import Link from "next/link"

import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"

/** The platform pages are for Platform Administrators only (report 2.4). The API refuses every
 * platform request of anyone else anyway; this only explains it instead of showing errors. */
export function PlatformGuard({ children }: { children: React.ReactNode }) {
  const user = useSession()
  if (user.platform_admin) return <>{children}</>
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md rounded-[10px] border bg-card px-6 py-10 text-center">
        <h1 className="text-lg font-semibold">Only Platform Administrators open these pages</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The platform pages are for the people who operate Sentra itself. Your organization&apos;s pages are in the app.
        </p>
        <Button asChild className="mt-5 h-9 hover:bg-primary-hover">
          <Link href={user.organization ? "/dashboard" : "/organizations/new"}>
            {user.organization ? "Go to the dashboard" : "Create an organization"}
          </Link>
        </Button>
      </div>
    </main>
  )
}
