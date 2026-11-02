"use client"

import Link from "next/link"

import { StatusBadge } from "@/components/findings/finding-badges"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import type { FindingDetail } from "@/lib/findings"

/**
 * The head of Screens 39, 40 and the Activity tab: what the finding is, where it is, how serious
 * it is, who owns it, and the triage that decides all of that (FR-6.5).
 */
export function FindingHeader({
  finding,
  action,
}: {
  finding: FindingDetail
  /** The "Triage" button of Screen 39; the other tabs show none. */
  action?: React.ReactNode
}) {
  usePageCrumbs([{ label: finding.code }])
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{finding.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">{finding.code}</span>
          <SeverityBadge severity={finding.severity} />
          <StatusBadge status={finding.status} />
          <span className="text-muted-foreground">
            <Link href={`/targets/${finding.target.id}`} className="text-link underline underline-offset-2">
              {finding.target.name}
            </Link>{" "}
            · {finding.component.label}
          </span>
          <span className="text-muted-foreground">
            {finding.owner ? `Owner ${finding.owner.name}` : "No owner yet"}
          </span>
        </div>
      </div>
      {action}
    </div>
  )
}
