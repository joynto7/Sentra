"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronsUpDown, LogOut } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { useSession } from "@/components/session-provider"
import { visibleNavigation } from "@/config/navigation"
import { apiFetch } from "@/lib/api"
import { initials, placeholderMembership } from "@/lib/session"

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const user = useSession()
  const membership = placeholderMembership
  const groups = visibleNavigation(membership.role)

  async function logOut() {
    await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
    router.replace("/login")
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1" aria-label="Sentra home">
          <SentraLogo />
          <span className="text-[17px] font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden">
            Sentra
          </span>
        </Link>
        <button
          type="button"
          className="flex h-9 items-center justify-between rounded-md border border-sidebar-border px-2.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
          aria-label={`Organization: ${membership.organization}`}
        >
          <span className="truncate">{membership.organization}</span>
          <ChevronsUpDown className="size-4 text-sidebar-label" aria-hidden="true" />
        </button>
      </SidebarHeader>

      <SidebarContent className="px-1">
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[11px] font-semibold tracking-wide text-sidebar-label uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="text-sidebar-foreground data-active:bg-sidebar-active data-active:text-white"
                      >
                        <Link href={item.href} aria-current={active ? "page" : undefined}>
                          <item.icon aria-hidden="true" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-sidebar-accent"
            aria-label={`Account menu for ${user.name}`}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-white"
              aria-hidden="true"
            >
              {initials(user.name)}
            </span>
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-sm font-medium text-white">{user.name}</span>
              <span className="block truncate text-xs text-sidebar-label">{membership.roleLabel}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
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
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
