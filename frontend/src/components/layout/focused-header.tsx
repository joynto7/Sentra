"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

import { SentraLogo } from "@/components/layout/sentra-logo"
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

/** Minimal top bar for focused pages: the logo on the left, the user menu on the right. */
export function FocusedHeader() {
  const router = useRouter()
  const user = useSession()

  async function logOut() {
    await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
    router.replace("/login")
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <span className="flex items-center gap-2.5">
        <SentraLogo />
        <span className="text-[17px] font-semibold tracking-tight">Sentra</span>
      </span>
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
