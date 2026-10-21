"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown, Plus, ServerCog } from "lucide-react"

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
import type { CurrentOrganization } from "@/lib/session"

/** The organization menu in the sidebar: switch organizations or create one (FR-1.4). A Platform
 * Administrator also opens the Sentra platform here; `current` is null on the platform pages. */
export function OrganizationSwitcher({ current }: { current: CurrentOrganization | null }) {
  const router = useRouter()
  const platformAdmin = useSession().platform_admin
  const [organizations, setOrganizations] = useState<CurrentOrganization[] | null>(null)

  async function loadList(open: boolean) {
    if (!open || organizations !== null) return
    setOrganizations(await apiFetch<CurrentOrganization[]>("/v1/organizations").catch(() => (current ? [current] : [])))
  }

  async function openOrganization(id: string) {
    if (id === current?.id) return
    await apiFetch(`/v1/organizations/${id}/switch`, { method: "POST" })
    // Reload so every page shows the data of the newly opened organization; from the platform
    // pages, open the organization's start page (its layout loads the session anew).
    if (current) window.location.reload()
    else router.push("/dashboard")
  }

  const name = current?.name ?? "Sentra platform"
  const list = organizations ?? (current ? [current] : [])

  return (
    <DropdownMenu onOpenChange={loadList}>
      <DropdownMenuTrigger
        className="flex h-9 w-full items-center justify-between rounded-md border border-sidebar-border px-2.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
        aria-label={current ? `Organization: ${name}. Switch organization` : "Sentra platform. Switch to an organization"}
      >
        <span className="truncate">{name}</span>
        <ChevronsUpDown className="size-4 text-sidebar-label" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organizations</DropdownMenuLabel>
        {list.map((organization) => (
          <DropdownMenuItem key={organization.id} onSelect={() => openOrganization(organization.id)}>
            <span className="flex-1 truncate">{organization.name}</span>
            {organization.id === current?.id && <Check aria-label="Current organization" />}
          </DropdownMenuItem>
        ))}
        {organizations !== null && list.length === 0 && (
          <DropdownMenuItem disabled>You don&apos;t belong to an organization</DropdownMenuItem>
        )}
        {platformAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/platform">
                <ServerCog aria-hidden="true" />
                <span className="flex-1">Sentra platform</span>
                {!current && <Check aria-label="Current" />}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/organizations/new">
            <Plus aria-hidden="true" />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
