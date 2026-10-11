"use client"

import { usePathname } from "next/navigation"
import { Bell, CircleHelp, Search } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { findNavItem } from "@/config/navigation"

export function TopBar() {
  const pathname = usePathname()
  const match = findNavItem(pathname)

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="h-5" />
      <Breadcrumb>
        <BreadcrumbList>
          {match && (
            <>
              <BreadcrumbItem className="hidden md:block">{match.group.label}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{match.item.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        <label className="relative mr-2 hidden lg:block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search targets, findings, campaigns"
            className="h-9 w-80 rounded-[7px] border border-input bg-card pr-10 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 font-mono text-[11px] text-muted-foreground">
            ⌘K
          </kbd>
        </label>
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Help">
          <CircleHelp aria-hidden="true" />
        </Button>
      </div>
    </header>
  )
}
