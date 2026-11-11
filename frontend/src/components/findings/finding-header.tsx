"use client"

import { Fragment } from "react"
import Link from "next/link"

import { StatusBadge } from "@/components/findings/finding-badges"
import { type Crumb, usePageCrumbs } from "@/components/layout/breadcrumbs"
import { AtlasId, OwaspLink } from "@/components/sentra/framework-ids"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import type { FindingDetail } from "@/lib/findings"
import { formatDateTime } from "@/lib/targets"

/**
 * "Reproducibility 4/6" as the header of Screen 40 writes it: of the attempts the score counts,
 * how many reproduced the weakness (FR-6.4, M6). A measurement that hasn't ended, or couldn't finish,
 * says so beside the figure (UC-6.3, 2a1 and 2b1).
 */
function reproducibility(finding: FindingDetail): { shown: string; spoken: string } {
  // Once the retention clean-up has deleted evidence, the attempts no longer show what they proved:
  // the score as it was rated while the evidence was kept is the one to show (UC-6.5, 4a)
  if (finding.evidence_deleted && finding.reproducibility !== null) {
    const share = Math.round(Number(finding.reproducibility) * 100)
    return {
      shown: `Reproducibility ${share} %`,
      spoken: `Reproducibility ${share} percent, as rated while its evidence was kept`,
    }
  }
  const counted = finding.counted
  if (!counted) return { shown: "Not measured yet", spoken: "Reproducibility not measured yet" }
  const state = finding.repetitions?.status
  const note = state === "incomplete" ? ", incomplete" : state === "measuring" ? ", still measuring" : ""
  return {
    shown: `Reproducibility ${counted.successes}/${counted.attempts}${note}`,
    spoken: `Reproducibility: ${counted.successes} of ${counted.attempts} attempts reproduced it${note}`,
  }
}

/**
 * The head of a finding's four tabs (Screens 39 and 40): its code, category and MITRE ATLAS
 * techniques above the title, then how serious it is, its status, where it is, how reliably it
 * reproduces, when it was first seen and who owns it (UC-6.5 step 3; FR-6.5, M6).
 */
export function FindingHeader({
  finding,
  action,
  crumbs,
}: {
  finding: FindingDetail
  /** The tab's own actions, e.g. "Triage" on Screen 39; the Evidence and Activity tabs show none. */
  action?: React.ReactNode
  /** A tab that names itself in the breadcrumb passes its own, e.g. "F-002 / Remediation". */
  crumbs?: Crumb[]
}) {
  usePageCrumbs(crumbs ?? [{ label: finding.code }])
  const repro = reproducibility(finding)
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-[13px] text-muted-foreground">
          <span>{finding.code}</span>
          <span aria-hidden="true">·</span>
          <OwaspLink code={finding.category} />
          {finding.atlas.map((technique) => (
            <Fragment key={technique}>
              <span aria-hidden="true">·</span>
              <AtlasId code={technique} />
            </Fragment>
          ))}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{finding.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <SeverityBadge severity={finding.severity} />
          <StatusBadge status={finding.status} />
          <span>
            {/* 24 px high, the target size of WCAG 2.5.8 */}
            <Link
              href={`/targets/${finding.target.id}`}
              className="inline-block min-h-6 leading-6 text-link underline underline-offset-2"
            >
              {finding.target.name}
            </Link>
            <span className="text-muted-foreground"> · {finding.component.label}</span>
          </span>
          <span className="tabular text-muted-foreground">
            <span aria-hidden="true">{repro.shown}</span>
            <span className="sr-only">{repro.spoken}</span>
          </span>
          <span className="text-muted-foreground">
            First seen <time dateTime={finding.first_seen_at}>{formatDateTime(finding.first_seen_at)}</time>
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
