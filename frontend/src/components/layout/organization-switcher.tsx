"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

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

/** The organization menu in the sidebar: switch organizations or create one (FR-1.4). */
export function OrganizationSwitcher({ current }: { current: CurrentOrganization }) {
  const [organizations, setOrganizations] = useState<CurrentOrganization[] | null>(null)

  async function loadList(open: boolean) {
    if (!open || organizations !== null) return
    setOrganizations(await apiFetch<CurrentOrganization[]>("/v1/organizations").catch(() => [current]))
  }

  async function openOrganization(id: string) {
    if (id === current.id) return
    await apiFetch(`/v1/organizations/${id}/switch`, { method: "POST" })
    // Reload so every page shows the data of the newly opened organization.
    window.location.reload()
  }

  return (
    <DropdownMenu onOpenChange={loadList}>
      <DropdownMenuTrigger
        className="flex h-9 w-full items-center justify-between rounded-md border border-sidebar-border px-2.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
        aria-label={`Organization: ${current.name}. Switch organization`}
      >
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="size-4 text-sidebar-label" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organizations</DropdownMenuLabel>
        {(organizations ?? [current]).map((organization) => (
          <DropdownMenuItem key={organization.id} onSelect={() => openOrganization(organization.id)}>
            <span className="flex-1 truncate">{organization.name}</span>
            {organization.id === current.id && <Check aria-label="Current organization" />}
          </DropdownMenuItem>
        ))}
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
