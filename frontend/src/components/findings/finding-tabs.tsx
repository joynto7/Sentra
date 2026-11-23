"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"

export type FindingTab = "summary" | "evidence" | "remediation" | "activity"

const TABS: { id: FindingTab; label: string; path: string }[] = [
  { id: "summary", label: "Summary", path: "" },
  { id: "evidence", label: "Evidence", path: "/evidence" },
  { id: "remediation", label: "Remediation", path: "/remediation" },
  { id: "activity", label: "Activity", path: "/activity" },
]

/** The tabs of one finding (Screens 39 and 40). */
export function FindingTabs({ code, active }: { code: string; active: FindingTab }) {
  return (
    <nav aria-label="Finding" className="mb-5 overflow-x-auto border-b">
      <ul className="flex gap-6">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={`/findings/${code}${tab.path}`}
              aria-current={tab.id === active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center border-b-2 px-0.5 text-sm whitespace-nowrap",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                tab.id === active
                  ? "border-primary font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
