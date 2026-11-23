"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"

export type TargetTab = "overview" | "profile" | "threat-model" | "campaigns" | "findings" | "shield" | "history"

/** The path of each tab, after /targets/{id}. */
const TABS: { id: TargetTab; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "" },
  { id: "profile", label: "Profile", path: "/profile" },
  { id: "threat-model", label: "Threat model", path: "/threat-model" },
  { id: "campaigns", label: "Campaigns", path: "/campaigns" },
  { id: "findings", label: "Findings", path: "/findings" },
  { id: "shield", label: "Sentra Shield", path: "/shield" },
  { id: "history", label: "History", path: "/history" },
]

/** The tabs of one target (Screen 20): everything about it, in one place. */
export function TargetTabs({ targetId, active }: { targetId: string; active: TargetTab }) {
  return (
    <nav aria-label="Target" className="mb-5 overflow-x-auto border-b">
      <ul className="flex gap-6">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={`/targets/${targetId}${tab.path}`}
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
