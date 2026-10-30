"use client"

import Link from "next/link"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type FindingTab = "summary" | "evidence" | "remediation" | "activity"

const TABS: { id: FindingTab; label: string; path?: string; comesWith?: string }[] = [
  { id: "summary", label: "Summary", path: "" },
  { id: "evidence", label: "Evidence", path: "/evidence" },
  { id: "remediation", label: "Remediation", comesWith: "the remediation of findings (M8)" },
  { id: "activity", label: "Activity", comesWith: "the triage of findings (FR-6.5)" },
]

const SHARED = "flex h-10 items-center border-b-2 px-0.5 text-sm whitespace-nowrap"

/** The tabs of one finding (Screens 39 and 40); what a later module brings says so. */
export function FindingTabs({ code, active }: { code: string; active: FindingTab }) {
  return (
    <nav aria-label="Finding" className="mb-5 overflow-x-auto border-b">
      <ul className="flex gap-6">
        {TABS.map((tab) =>
          tab.path === undefined ? (
            <li key={tab.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-disabled="true"
                    className={cn(SHARED, "cursor-not-allowed border-transparent text-muted-foreground/60")}
                  >
                    {tab.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Comes with {tab.comesWith}.</TooltipContent>
              </Tooltip>
            </li>
          ) : (
            <li key={tab.id}>
              <Link
                href={`/findings/${code}${tab.path}`}
                aria-current={tab.id === active ? "page" : undefined}
                className={cn(
                  SHARED,
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  tab.id === active
                    ? "border-primary font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  )
}
