"use client"

import Link from "next/link"

import { StatusBadge } from "@/components/findings/finding-badges"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import type { FindingDetail } from "@/lib/findings"

/** The head of Screens 39 and 40: what the finding is, where it is and how serious it is. */
export function FindingHeader({ finding }: { finding: FindingDetail }) {
  usePageCrumbs([{ label: finding.code }])
  return (
    <div className="mb-5">
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
      </div>
    </div>
  )
}
