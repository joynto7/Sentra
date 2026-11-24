import Link from "next/link"

import { RetestChip } from "@/components/remediation/badges"
import type { RemediationRow } from "@/lib/remediation"

/**
 * How far the fix has come after the approval (UC-8.5, UC-8.6): the changes the developer still
 * has to make, and what the retest said. Each one is a link to the page that can do something
 * about it, so Screen 45 stays the entry to the whole of M8.
 */
export function Progress({ row }: { row: RemediationRow }) {
  if (!row.latest) return <span className="text-[13px] text-muted-foreground">—</span>
  return (
    <div className="space-y-1">
      {row.open_changes > 0 && (
        <Link href="/remediation/changes" className="block py-0.5 text-[13px] text-link hover:underline">
          {row.open_changes} application {row.open_changes === 1 ? "change" : "changes"} open
        </Link>
      )}
      {row.retest && (
        <Link
          href={`/remediation/${row.finding.code}/retest`}
          className="inline-flex py-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Retest ${row.retest.number} of ${row.finding.code}: ${row.retest.verdict_label ?? row.retest.status_label}`}
        >
          <RetestChip retest={row.retest} />
        </Link>
      )}
      {row.open_changes === 0 && !row.retest && <span className="text-[13px] text-muted-foreground">—</span>}
    </div>
  )
}
