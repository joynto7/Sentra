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

/** The tabs of one finding (Screens 39 and 40). The Evidence tab says how many records it holds. */
export function FindingTabs({
  code,
  active,
  evidence,
}: {
  code: string
  active: FindingTab
  /** The finding's evidence records, with those of the duplicates merged into it (FR-6.6, M6). */
  evidence?: number
}) {
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
              {tab.id === "evidence" && evidence !== undefined && (
                <span className="tabular ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-foreground">
                  {evidence}
                  <span className="sr-only">{evidence === 1 ? " record" : " records"}</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
