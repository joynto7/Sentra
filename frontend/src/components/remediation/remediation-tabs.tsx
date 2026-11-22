import Link from "next/link"

import { cn } from "@/lib/utils"

export type RemediationTab = "all" | "approval" | "changes" | "retesting"

/** The counts the tabs carry; each is left out while the page that knows it is still loading. */
export type TabCounts = {
  all?: number
  awaiting_me?: number
  open_changes?: number
  retesting?: number
}

const TABS: { id: RemediationTab; label: string; href: string; count: keyof TabCounts }[] = [
  { id: "all", label: "All", href: "/remediation", count: "all" },
  {
    id: "approval",
    label: "Awaiting my approval",
    href: "/remediation?show=approval",
    count: "awaiting_me",
  },
  {
    id: "changes",
    label: "Application changes",
    href: "/remediation/changes",
    count: "open_changes",
  },
  {
    id: "retesting",
    label: "Retesting",
    href: "/remediation?show=retesting",
    count: "retesting",
  },
]

const SHARED = "flex h-10 items-center border-b-2 px-0.5 text-sm whitespace-nowrap"

/**
 * The four tabs of Screen 45. Each one is a link with its own address, because one of them leads
 * to a page of its own (Screen 50) and the other three are states of this one worth keeping or
 * sharing; `aria-current` says which is being read. Tab roles belong to controls that switch a
 * panel in place, not to navigation (WCAG 4.1.2).
 */
export function RemediationTabs({
  active,
  counts,
}: {
  active: RemediationTab
  counts: TabCounts
}) {
  return (
    <nav aria-label="Remediation" className="mb-5 overflow-x-auto border-b">
      <ul className="flex gap-6">
        {TABS.map((tab) => {
          const count = counts[tab.count]
          const open = tab.id === "changes" && count !== undefined ? ` (${count} open)` : ""
          const plain = !open && count !== undefined ? ` (${count})` : ""
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={tab.id === active ? "page" : undefined}
                className={cn(
                  SHARED,
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  tab.id === active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-text-secondary hover:text-foreground",
                )}
              >
                {tab.label}
                {open || plain}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
