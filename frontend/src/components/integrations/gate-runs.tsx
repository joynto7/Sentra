"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { ChevronDown, CircleCheck, CircleHelp, CircleX, Loader2 } from "lucide-react"

import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { VERDICT_LABEL, VERDICT_MEANING, type GateFinding, type GateRun } from "@/lib/gates"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const ICON = {
  passed: CircleCheck,
  failed: CircleX,
  error: CircleHelp,
  running: Loader2,
} as const

const TONE = {
  passed: "text-success",
  failed: "text-destructive",
  error: "text-warning",
  running: "text-muted-foreground",
} as const

/** The verdict as a word with its shape, never as a colour alone (NFR-4.3, WCAG 1.4.1). */
export function Verdict({ run }: { run: GateRun }) {
  const Icon = ICON[run.verdict]
  return (
    <span className="flex items-center gap-1.5">
      <Icon
        className={cn("size-4 shrink-0", TONE[run.verdict], run.verdict === "running" && "animate-spin")}
        aria-hidden="true"
      />
      <span className="font-medium">{VERDICT_LABEL[run.verdict]}</span>
    </span>
  )
}

function duration(run: GateRun): string {
  if (!run.finished_at) return "—"
  const minutes = Math.round(
    (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 60000,
  )
  return minutes < 1 ? "under a minute" : `${minutes} min`
}

function Build({ run }: { run: GateRun }) {
  if (!run.build_ref && !run.build_commit) {
    return <span className="text-muted-foreground">Not named</span>
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {run.build_url ? (
        <a
          href={run.build_url}
          className="text-link underline underline-offset-2"
          rel="noreferrer noopener"
          target="_blank"
        >
          {run.build_ref ?? "the build"}
        </a>
      ) : (
        <span>{run.build_ref}</span>
      )}
      {run.build_commit && <span className="font-mono text-xs">{run.build_commit}</span>}
    </span>
  )
}

function Findings({ rows }: { rows: GateFinding[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((finding) => (
        <li key={finding.code} className="flex flex-wrap items-center gap-2 text-[13px]">
          <SeverityBadge severity={finding.severity} />
          <Link
            href={`/findings/${finding.code}`}
            className="font-mono text-link underline underline-offset-2"
          >
            {finding.code}
          </Link>
          <span>{finding.title}</span>
          <span className="text-muted-foreground">
            {finding.why === "reopened"
              ? "— fixed before and came back"
              : "— new since the last accepted run"}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The release history of Screen 55: one row per call of the gate, and the findings that blocked a
 * release under the row that failed. Every result is readable as text — the verdict's word, its
 * sentence, and what was compared with what.
 */
export function GateRuns({ runs, release }: { runs: GateRun[]; release?: number }) {
  const [open, setOpen] = useState<number | null>(
    // The release a notification points at (5a1), else the newest one that blocked a release.
    (release && runs.some((run) => run.number === release) ? release : null) ??
      runs.find((run) => run.breaking.length > 0)?.number ??
      null,
  )

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No release checked yet.</p>
    )
  }

  return (
    <Table
      container={{
        tabIndex: 0,
        role: "group",
        "aria-label": "Releases this gate checked",
        className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      }}
    >
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="text-xs">Release</TableHead>
          <TableHead scope="col" className="text-xs">Build</TableHead>
          <TableHead scope="col" className="text-xs">Result</TableHead>
          <TableHead scope="col" className="text-xs">New findings</TableHead>
          <TableHead scope="col" className="text-xs">Took</TableHead>
          <TableHead scope="col" className="text-xs">Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const shown = open === run.number
          const details = run.breaking.length > 0 ? run.breaking : run.new_findings
          return (
            <Fragment key={run.number}>
              <TableRow>
                <TableCell className="font-mono text-[13px]">
                  {run.gate} #{run.number}
                  {run.run_code && (
                    <div className="text-xs text-muted-foreground">{run.run_code}</div>
                  )}
                </TableCell>
                <TableCell className="text-[13px]">
                  <Build run={run} />
                </TableCell>
                <TableCell className="text-[13px]">
                  <Verdict run={run} />
                </TableCell>
                <TableCell className="tabular text-[13px]">
                  {run.new_findings.length}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-1 h-7 px-1.5 text-xs"
                    aria-expanded={shown}
                    aria-controls={`gate-run-${run.number}`}
                    aria-label={`${shown ? "Hide" : "Show"} what ${run.gate} #${run.number} decided`}
                    onClick={() => setOpen(shown ? null : run.number)}
                  >
                    {shown ? "Hide" : "Show"}
                    <ChevronDown
                      className={cn("size-3.5 transition-transform", shown && "rotate-180")}
                      aria-hidden="true"
                    />
                  </Button>
                </TableCell>
                <TableCell className="text-[13px]">{duration(run)}</TableCell>
                <TableCell className="text-[13px]">
                  {formatDateTime(run.started_at)}
                  {run.started_by && (
                    <div className="text-xs text-muted-foreground">{run.started_by}</div>
                  )}
                </TableCell>
              </TableRow>
              <TableRow hidden={!shown}>
                <TableCell colSpan={6} id={`gate-run-${run.number}`} className="bg-muted/30">
                  <p className="mb-2 text-[13px]">{run.message ?? VERDICT_MEANING[run.verdict]}</p>
                  {details.length > 0 && <Findings rows={details} />}
                  <p className="mt-2 text-xs text-text-secondary">
                    Judged by the policy of this release: {run.policy_words}.
                    {run.compared_with
                      ? ` Compared with ${run.compared_with}, the last run this gate accepted.`
                      : " Nothing to compare it with yet, so it became the baseline."}
                  </p>
                </TableCell>
              </TableRow>
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
