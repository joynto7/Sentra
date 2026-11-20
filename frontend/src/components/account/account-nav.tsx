"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

// The Account sub-menu of Screens 08 and 09.
const ITEMS = [
  { href: "/account/profile", label: "Profile" },
  { href: "/account/security", label: "Security" },
]

/** Account sub-navigation, left of the content; for every user (FR-1.7). */
export function AccountNav() {
  const pathname = usePathname()
  return (
    <nav aria-labelledby="account-nav-heading" className="lg:w-52 lg:shrink-0">
      <h2 id="account-nav-heading" className="mb-2 px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Account
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
