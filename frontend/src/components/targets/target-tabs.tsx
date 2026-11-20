"use client"

import Link from "next/link"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type TargetTab = "overview" | "profile" | "threat-model" | "campaigns" | "findings" | "shield" | "history"

type Tab = {
  id: TargetTab
  label: string
  /** The path after /targets/{id}; empty for the overview. Without one the page isn't built yet. */
  path?: string
  /** What brings the tab, while it isn't built. */
  comesWith?: string
}

const TABS: Tab[] = [
  { id: "overview", label: "Overview", path: "" },
  { id: "profile", label: "Profile", path: "/profile" },
  { id: "threat-model", label: "Threat model", comesWith: "the threat models (M3)" },
  { id: "campaigns", label: "Campaigns", comesWith: "the campaign runs (M5)" },
  { id: "findings", label: "Findings", comesWith: "the findings pages (M6)" },
  { id: "shield", label: "Sentra Shield", comesWith: "Sentra Shield (M8)" },
  { id: "history", label: "History", comesWith: "the target history (FR-2.6)" },
]

const SHARED = "flex h-10 items-center border-b-2 px-0.5 text-sm whitespace-nowrap"

/** The tabs of one target (Screens 20 to 23). A tab without a page yet says what brings it. */
export function TargetTabs({ targetId, active }: { targetId: string; active: TargetTab }) {
  return (
    <nav aria-label="Target" className="mb-5 overflow-x-auto border-b">
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
                href={`/targets/${targetId}${tab.path}`}
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
