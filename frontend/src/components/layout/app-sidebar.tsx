"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, ShieldCheck, UserRound } from "lucide-react"

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
import { OrganizationSwitcher } from "@/components/layout/organization-switcher"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { useSession } from "@/components/session-provider"
import { platformNavigation, visibleNavigation } from "@/config/navigation"
import { apiFetch } from "@/lib/api"
import { initials } from "@/lib/session"
import { forgetKeptLists } from "@/lib/kept-lists"

/** The sidebar of the app, or with `platform` of the Platform Administrator's pages, whose menu
 * has only the PLATFORM group and whose switcher reads "Sentra platform" (UI plan, Screen 61). */
export function AppSidebar({ platform = false }: { platform?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useSession()
  // Pages inside the app always have an organization (the session provider makes sure); the
  // platform pages don't need one.
  const organization = user.organization
  const groups = platform ? platformNavigation : visibleNavigation(organization!.role)
  const roleLabel = platform ? "Platform Administrator" : organization!.role_label

  async function logOut() {
    await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
    forgetKeptLists() // Back to a list keeps nothing of this person (UX task 3.0)
    router.replace("/login")
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <Link href={platform ? "/platform" : "/dashboard"} className="flex items-center gap-2.5 px-1" aria-label="Sentra home">
          <SentraLogo />
          <span className="text-[17px] font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden">
            Sentra
          </span>
        </Link>
        <OrganizationSwitcher current={platform ? null : organization} />
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
              <span className="block truncate text-xs text-sidebar-label">{roleLabel}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account/profile">
                <UserRound aria-hidden="true" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/security">
                <ShieldCheck aria-hidden="true" />
                Security
              </Link>
            </DropdownMenuItem>
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
