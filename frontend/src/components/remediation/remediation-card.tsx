import Link from "next/link"

import { StatusChip } from "@/components/remediation/badges"
import { Progress } from "@/components/remediation/remediation-progress"
import { GLASS_BUTTON, GlassCard } from "@/components/sentra/glass-card"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { AiGeneratedLabel } from "@/components/threat-models/badges"
import type { RemediationRow } from "@/lib/remediation"

/** What the card says about the proposal of a finding, or why it has none yet. */
function ProposalState({ row }: { row: RemediationRow }) {
  if (row.latest) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={row.latest.status} />
          {row.latest.ai_generated && <AiGeneratedLabel />}
        </div>
      </>
    )
  }
  const writing = row.job && (row.job.status === "queued" || row.job.status === "running")
  return (
    <p className="text-[13px] text-foreground/65">
      {writing ? "Sentra is writing a proposal…" : (row.blocker ?? "No proposal yet")}
    </p>
  )
}

/**
 * Screen 45 as cards: one confirmed finding, the same facts as a row of the table. The severity and
 * the finding's code on top; its title and target; the state of the proposal; the fixes as three
 * figures and their kinds; how far the fix has come; and the way in: the finding's proposal, or
 * "Review proposal" for the person who may decide it.
 */
export function RemediationCard({ row }: { row: RemediationRow }) {
  const { finding, latest } = row
  const href = `/remediation/${finding.code}`
  return (
    <GlassCard label={`${finding.code}: ${finding.title}`}>
      <div className="flex items-center justify-between gap-3">
        <SeverityBadge severity={finding.severity} />
        <Link
          href={href}
          className="inline-flex min-h-6 items-center rounded-md font-mono text-[13px] text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {finding.code}
        </Link>
      </div>

      <h3 className="mt-3 line-clamp-3 text-lg leading-6 font-medium">{finding.title}</h3>
      <p className="text-sm text-foreground/65">{finding.target_name}</p>

      <div className="mt-2.5">
        <ProposalState row={row} />
      </div>

      {latest && (
        <p className="tabular mt-2.5 text-sm text-foreground/65">
          Version {latest.version} · {latest.fix_count} {latest.fix_count === 1 ? "fix" : "fixes"}
        </p>
      )}

      <div className="mt-2 text-[13px]">
        <Progress row={row} />
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Link href={href} className={GLASS_BUTTON}>
          {row.can_approve ? "Review" : "Open"}
        </Link>
      </div>
    </GlassCard>
  )
}
