"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

import { SentraLogo, SentraWordmark } from "@/components/layout/sentra-logo"
import { useSession } from "@/components/session-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { apiFetch } from "@/lib/api"
import { initials } from "@/lib/session"
import { forgetKeptLists } from "@/lib/kept-lists"

/** Minimal top bar for focused pages: the logo on the left, the user menu on the right. */
export function FocusedHeader() {
  const router = useRouter()
  const user = useSession()

  async function logOut() {
    await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
    forgetKeptLists() // Back to a list keeps nothing of this person (UX task 3.0)
    router.replace("/login")
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-2.5">
        <SentraLogo />
        <SentraWordmark size={18} className="text-foreground" />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md p-1 hover:bg-muted" aria-label={`Account menu for ${user.name}`}>
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span className="text-sm font-medium">{user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logOut}>
            <LogOut aria-hidden="true" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
