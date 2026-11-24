import Link from "next/link"

import { Delta } from "@/components/risk/risk-tiles"
import { ScoreMethod } from "@/components/risk/score-method"
import { RiskScore, SeverityCountsStrip } from "@/components/sentra/risk-score"
import { SEVERITY_LABEL, type Severity } from "@/components/sentra/severity-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { COUNTED, notScoredText, type TargetRiskRow } from "@/lib/risk"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

// What "Last campaign run" says while a run of the target is going on (FR-5.6, M5).
const LIVE: Record<string, string> = { running: "Running now", paused: "Paused", queued: "Waiting to start" }

/** The change of a target's score since the start of the period, in a column of its own: a first
 * score, no change, and a change are three different things. */
function ScoreChange({ row, since }: { row: TargetRiskRow; since: string }) {
  if (row.score === null) return null
  if (row.score_then === null || row.score_then === undefined) {
    return (
      <p className="text-[13px] whitespace-nowrap text-muted-foreground">
        First score<span className="sr-only">: no score on {since}</span>
      </p>
    )
  }
  const change = row.score - row.score_then
  return (
    <Delta
      change={change}
      worseWhen="up"
      against={change === 0 ? "Same" : ""}
      spoken={
        change === 0
          ? `The same score as on ${since}.`
          : `${Math.abs(change)} points ${change > 0 ? "higher" : "lower"} than on ${since}, when it was ${row.score_then}.`
      }
      className="whitespace-nowrap"
    />
  )
}

/** The targets without a score, folded into one line: what each one needs before it can have one. */
function NotScored({ rows, canVerify }: { rows: TargetRiskRow[]; canVerify: boolean | undefined }) {
  const verify = (row: TargetRiskRow) => row.not_scored_reason === "ownership_not_verified"
  return (
    <p className="border-t px-4 py-3 text-[13px]">
        <span className="font-medium">
          {rows.length} {rows.length === 1 ? "target isn't" : "targets aren't"} scored yet:
        </span>{" "}
        {rows.map((row, index) => (
          <span key={row.id}>
            {index > 0 && "; "}
            <Link href={`/targets/${row.id}`} className="inline-flex min-h-6 items-center text-link underline underline-offset-2">
              {row.name}
            </Link>
            <span className="text-muted-foreground"> — {notScoredText(row.not_scored_reason).replace(/^Not scored — /, "")}</span>
            {verify(row) && canVerify && (
              <>
                {" · "}
                <Link href={`/targets/${row.id}/verify`} className="inline-flex min-h-6 items-center text-link underline underline-offset-2">
                  Verify ownership
                </Link>
              </>
            )}
            {/* Whoever can't verify learns who can (FR-2.3, M2) */}
            {verify(row) && !canVerify && <span className="text-muted-foreground"> · an AI Application Developer verifies it</span>}
          </span>
        ))}
    </p>
  )
}

/**
 * The "Target risk" table (UC-7.3 step 2): a score per target, its change since the period began,
 * the open findings with their severities, how many wait for a confirmation, and the last campaign
 * run. Numbers are right-aligned in columns of their own, so that a column reads as a column; a
 * zero is a zero (muted), "First score" is not a change, and a target without a score is not low risk.
 */
export function TargetRisk({ rows, canVerify, since, className }: { rows: TargetRiskRow[]; canVerify: boolean | undefined; since: string; className?: string }) {
  const scored = rows.filter((row) => row.score !== null && row.band !== null)
  const unscored = rows.filter((row) => row.score === null || row.band === null)
  return (
    <section aria-labelledby="target-risk" className={cn("@container/targets min-w-0 rounded-[10px] border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="target-risk" className="text-[15px] font-semibold">
          Target risk
          <span className="tabular ml-2 text-[13px] font-normal text-muted-foreground">
            {rows.length} {rows.length === 1 ? "target" : "targets"}
          </span>
        </h2>
        <ScoreMethod />
      </div>
      <Table
        className="table-fixed"
        container={{
          tabIndex: 0,
          role: "group",
          "aria-label": "Target risk",
          className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        }}
      >
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead scope="col" className="text-xs">Target</TableHead>
            <TableHead scope="col" className="w-[150px] text-xs @min-[36rem]/targets:w-[168px]">Risk score</TableHead>
            <TableHead scope="col" className="hidden w-[116px] text-xs @min-[40rem]/targets:table-cell">
              Change<span className="sr-only"> since {since}</span>
              <span className="block font-normal text-muted-foreground" aria-hidden="true">since {since}</span>
            </TableHead>
            <TableHead scope="col" className="hidden w-[212px] text-xs @min-[36rem]/targets:table-cell">Open findings</TableHead>
            <TableHead scope="col" className="hidden w-[116px] text-right text-xs whitespace-normal @min-[56rem]/targets:table-cell">Awaiting confirmation</TableHead>
            <TableHead scope="col" className="hidden w-[148px] text-xs @min-[48rem]/targets:table-cell">Last campaign run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {scored.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="py-2.5 whitespace-normal">
                <Link href={`/targets/${row.id}`} className="inline-flex min-h-6 items-center font-medium text-link hover:underline">
                  {row.name}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {row.environment} ·{" "}
                  <Link
                    href={`/attack-paths?target=${row.id}`}
                    className="inline-flex min-h-6 items-center text-link underline underline-offset-2"
                    aria-label={`Attack paths of ${row.name}`}
                  >
                    Attack paths
                  </Link>
                </span>
                {/* What the columns that are out of room say, each while its column is hidden */}
                <Link
                  href={`/findings?view=open&target_id=${row.id}`}
                  className="mt-1 block rounded-[5px] hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @min-[36rem]/targets:hidden"
                  aria-label={`${row.open_total} open findings of ${row.name}`}
                >
                  <SeverityCountsStrip counts={row.open_by_severity} className="gap-2" />
                </Link>
                <span className="block text-xs text-muted-foreground @min-[48rem]/targets:hidden">
                  Last run:{" "}
                  {row.live_run ? `${LIVE[row.live_run.status]} (${row.live_run.code})` : row.last_run_at ? formatDate(row.last_run_at) : "Never"}
                </span>
                {row.awaiting_confirmation > 0 && (
                  <span className="block text-xs text-muted-foreground @min-[56rem]/targets:hidden">
                    {row.awaiting_confirmation} await confirmation
                  </span>
                )}
              </TableCell>
              <TableCell>
                <RiskScore score={row.score as number} band={row.band!} className="min-w-0" />
                <div className="mt-1 @min-[40rem]/targets:hidden">
                  <ScoreChange row={row} since={since} />
                </div>
              </TableCell>
              <TableCell className="hidden @min-[40rem]/targets:table-cell">
                <ScoreChange row={row} since={since} />
              </TableCell>
              <TableCell className="hidden @min-[36rem]/targets:table-cell">
                <Link
                  href={`/findings?view=open&target_id=${row.id}`}
                  className="block rounded-[5px] py-1 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label={`${row.open_total} open findings of ${row.name}${
                    row.open_total
                      ? `: ${COUNTED.filter((severity) => row.open_by_severity[severity])
                          .map((severity) => `${row.open_by_severity[severity]} ${SEVERITY_LABEL[severity as Severity].toLowerCase()}`)
                          .join(", ")}`
                      : ""
                  }`}
                >
                  <SeverityCountsStrip counts={row.open_by_severity} className="gap-2" />
                </Link>
              </TableCell>
              <TableCell className="tabular hidden text-right @min-[56rem]/targets:table-cell">
                {row.awaiting_confirmation > 0 ? (
                  <Link
                    href={`/findings?view=requires_confirmation&target_id=${row.id}`}
                    className="inline-block min-w-6 rounded-[5px] py-1 text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={`${row.awaiting_confirmation} findings of ${row.name} await confirmation`}
                  >
                    {row.awaiting_confirmation}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell className="hidden text-[13px] whitespace-nowrap @min-[48rem]/targets:table-cell">
                {row.live_run ? (
                  <>
                    <Link
                      href={`/campaigns/${row.live_run.campaign}/runs/${row.live_run.number}`}
                      className="inline-flex min-h-6 items-center font-medium text-link hover:underline"
                      aria-label={`${LIVE[row.live_run.status]}: ${row.live_run.code}, open its live monitor`}
                    >
                      {LIVE[row.live_run.status]}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{row.live_run.code}</span>
                    {row.last_run_at && (
                      <span className="block text-xs text-muted-foreground">before: {formatDate(row.last_run_at)}</span>
                    )}
                  </>
                ) : row.last_run_at ? (
                  formatDate(row.last_run_at)
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* Under the table, not in it: a row that spans every column would count the hidden ones too */}
      {unscored.length > 0 && <NotScored rows={unscored} canVerify={canVerify} />}
    </section>
  )
}
