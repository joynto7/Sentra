"use client"

import { Fragment } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { usePageCrumbsValue } from "@/components/layout/breadcrumbs"
import { HelpPanel } from "@/components/layout/help-panel"
import { SearchBox } from "@/components/layout/search-box"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { findNavItem } from "@/config/navigation"

/** `platform`: the Platform Administrator's shell has no organization, so nothing to search. */
export function TopBar({ platform = false }: { platform?: boolean }) {
  const pathname = usePathname()
  const match = findNavItem(pathname)
  const crumbs = usePageCrumbsValue()

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="h-5 self-center" />
      <Breadcrumb>
        <BreadcrumbList>
          {match && (
            <>
              <BreadcrumbItem className="hidden md:block">{match.group.label}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                {crumbs.length ? (
                  <BreadcrumbLink asChild>
                    <Link href={match.item.href}>{match.item.title}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{match.item.title}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {crumbs.map((crumb, i) => (
                <Fragment key={`${i}-${crumb.label}`}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {i < crumbs.length - 1 && crumb.href ? (
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </>
          )}
          {/* Pages outside the sidebar, such as Account / Profile, show only their own steps. */}
          {!match &&
            crumbs.map((crumb, i) => (
              <Fragment key={`${i}-${crumb.label}`}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {i < crumbs.length - 1 && crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        {!platform && <SearchBox />}
        <ThemeToggle />
        <NotificationBell />
        <HelpPanel />
      </div>
    </header>
  )
}
