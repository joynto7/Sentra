"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronsUpDown } from "lucide-react"

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
import { SentraLogo } from "@/components/layout/sentra-logo"
import { visibleNavigation } from "@/config/navigation"
import { currentUser, initials } from "@/lib/session"

export function AppSidebar() {
  const pathname = usePathname()
  const groups = visibleNavigation(currentUser.role)

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
          aria-label={`Organization: ${currentUser.organization}`}
        >
          <span className="truncate">{currentUser.organization}</span>
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

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {initials(currentUser.name)}
          </span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium text-white">{currentUser.name}</p>
            <p className="truncate text-xs text-sidebar-label">{currentUser.roleLabel}</p>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
