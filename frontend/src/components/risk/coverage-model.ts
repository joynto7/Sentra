import type { Severity } from "@/components/sentra/severity-badge"
import type { Coverage, CoverageCell, CoverageStatus, SeverityCounts } from "@/lib/risk"

/** From this many open findings a verified application sits in the innermost ring. */
export const CRITICAL_AT = 8

/** The ring of the radar an application is drawn in. */
export type Ring = "critical" | "moderate" | "covered" | "blind"

/** What one category says about one application, in the words the drawer uses. */
export type Standing =
  | { kind: "open"; open: number }
  | { kind: "gap"; stale: boolean }
  | { kind: "clean" }
  | { kind: "not_applicable" }
  | { kind: "not_verified" }
  | { kind: "out_of_scope" }

export type AppRow = { code: string; name: string | null; inScope: boolean; cell: CoverageCell; standing: Standing }

export type App = {
  id: string
  name: string
  type: string
  environment: string
  verified: boolean
  open: number
  gaps: number
  lastTested: string | null
  ring: Ring
  /** The most serious open finding, which colours the application's node. */
  worst: Severity | null
  rows: AppRow[]
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"]

export function worstOf(counts: SeverityCounts): Severity | null {
  return SEVERITIES.find((severity) => (counts[severity] ?? 0) > 0) ?? null
}

function standing(status: CoverageStatus, open: number): Standing {
  if (open > 0) return { kind: "open", open }
  if (status === "gap" || status === "stale") return { kind: "gap", stale: status === "stale" }
  if (status === "tested") return { kind: "clean" }
  if (status === "not_testable") return { kind: "not_verified" }
  if (status === "out_of_scope") return { kind: "out_of_scope" }
  return { kind: "not_applicable" }
}

/** Each target of the coverage as an application of the radar, with its numbers worked out. */
export function buildApps(data: Coverage): App[] {
  return data.targets.map((target, index) => {
    const rows: AppRow[] = data.rows.map((row) => {
      const cell = row.cells[index]
      return { code: row.code, name: row.name, inScope: row.in_scope, cell, standing: standing(cell.status, cell.open_findings) }
    })
    const counted = rows.filter((row) => row.inScope)
    const open = counted.reduce((sum, row) => sum + row.cell.open_findings, 0)
    const gaps = counted.filter((row) => row.standing.kind === "gap").length
    const total = counted.reduce(
      (sum, row) => {
        for (const severity of SEVERITIES) sum[severity] += row.cell.open_by_severity[severity] ?? 0
        return sum
      },
      { critical: 0, high: 0, medium: 0, low: 0, informational: 0 } as SeverityCounts,
    )
    const ran = counted.map((row) => row.cell.run?.ended_at).filter((at): at is string => Boolean(at))
    const verified = target.target_status === "verified"
    const ring: Ring = !verified ? "blind" : open >= CRITICAL_AT ? "critical" : open > 0 || gaps > 0 ? "moderate" : "covered"
    return {
      id: target.id,
      name: target.name,
      type: target.type,
      environment: target.environment,
      verified,
      open,
      gaps,
      lastTested: ran.sort().at(-1) ?? null,
      ring,
      worst: worstOf(total),
      rows,
    }
  })
}

export type Lane = {
  code: string
  name: string | null
  open: number
  bySeverity: SeverityCounts
  worst: Severity | null
  /** Of the verified applications the category applies to: how many were tested, and still are. */
  tested: number
  applicable: number
  /** The applications it was never tested on, or not since they changed. */
  gaps: { app: string; stale: boolean }[]
}

/** The categories of the coverage, the one with the most open findings first. `targetId` narrows them to one application. */
export function buildLanes(data: Coverage, targetId: string): Lane[] {
  return data.rows
    .filter((row) => row.in_scope)
    .map((row) => {
      const cells = row.cells.filter((cell) => !targetId || cell.target_id === targetId)
      const bySeverity = cells.reduce(
        (sum, cell) => {
          for (const severity of SEVERITIES) sum[severity] += cell.open_by_severity[severity] ?? 0
          return sum
        },
        { critical: 0, high: 0, medium: 0, low: 0, informational: 0 } as SeverityCounts,
      )
      const applicable = cells.filter((cell) => ["tested", "stale", "gap"].includes(cell.status))
      return {
        code: row.code,
        name: row.name,
        open: cells.reduce((sum, cell) => sum + cell.open_findings, 0),
        bySeverity,
        worst: worstOf(bySeverity),
        tested: applicable.filter((cell) => cell.status === "tested").length,
        applicable: applicable.length,
        gaps: applicable
          .filter((cell) => cell.status !== "tested")
          .map((cell) => ({ app: cell.target_name, stale: cell.status === "stale" })),
      }
    })
    .sort((a, b) => b.open - a.open || a.code.localeCompare(b.code))
}

export const severityVar = (severity: Severity) => `var(--severity-${severity === "informational" ? "info" : severity})`
