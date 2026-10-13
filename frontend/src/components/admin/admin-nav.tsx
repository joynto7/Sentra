"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

// The Administration sub-menu of the UI brief, in its order. Each item appears once its page is
// built: Organization Security with FR-1.2 (M1), Data and AI with Screen 59, Data Retention with
// FR-10.5 (M10).
const ITEMS = [{ href: "/admin/members", label: "Members" }]

/** Administration sub-navigation, left of the content (Organization Administrators only). */
export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav aria-labelledby="admin-nav-heading" className="lg:w-52 lg:shrink-0">
      <h2 id="admin-nav-heading" className="mb-2 px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Administration
      </h2>
      <ul className="flex gap-1 lg:flex-col">
        {ITEMS.map((item) => {
          const current = pathname.startsWith(item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-md px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  current ? "bg-accent font-semibold text-accent-foreground" : "text-text-secondary hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
