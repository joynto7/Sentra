"use client"

import { useCallback, useEffect, useState } from "react"

import { AtlasId, OwaspId } from "@/components/sentra/framework-ids"
import { CoveragePanel } from "@/components/risk/coverage-panel"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect } from "@/components/sentra/filter-select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  COVERAGE_SYMBOL,
  type Coverage,
  type CoverageCell,
  type CoverageStatus,
  getCoverage,
} from "@/lib/risk"
import { ATLAS_VERSION } from "@/lib/frameworks"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

const FRAMEWORKS = [
  { value: "owasp", label: "OWASP Top 10 for LLM Applications 2025" },
  { value: "atlas", label: `MITRE ATLAS ${ATLAS_VERSION}` },
] as const

/** What a cell says beside its symbol: short, and never only a colour (NFR-4.3). */
function cellText(cell: CoverageCell): string {
  if (cell.status === "tested" && cell.run) return formatDate(cell.run.ended_at).replace(/ \d{4}$/, "")
  if (cell.status === "stale") return "Stale"
  if (cell.status === "gap") return "Gap"
  if (cell.status === "not_testable") return "Not verified"
  if (cell.status === "out_of_scope") return "Out of scope"
  return "Not applicable"
}

const TINT: Partial<Record<CoverageStatus, string>> = {
  gap: "text-warning",
  stale: "text-warning",
  tested: "text-success",
}

/**
 * Screen 43, Framework Coverage (UC-7.4): which OWASP categories and MITRE ATLAS techniques have
 * been tested for each target, where the gaps are, and what lies outside Sentra's tests. Every
 * cell carries its own text, so the matrix can be read without colour, and selecting one opens
 * the panel with the threats, the suites and the way to accept the gap.
 */
export function FrameworkCoverage({ initialTarget = "" }: { initialTarget?: string } = {}) {
  const [framework, setFramework] = useState<"owasp" | "atlas">("owasp")
  const [target, setTarget] = useState(initialTarget)
  const [data, setData] = useState<Coverage | null>(null)
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<{ code: string; targetId: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ framework })
    if (target) params.set("target_id", target)
    getCoverage(params, controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
        if (!target) setOptions(found.targets.map((one) => ({ id: one.id, name: one.name })))
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [framework, target, attempt])

  const again = useCallback(() => setAttempt((n) => n + 1), [])

  return (
    <>
      <PageHeader
        title="Framework Coverage"
        description="Which OWASP and MITRE ATLAS categories have been tested, based on the campaign runs that actually ran."
      />

      <Tabs value={framework} onValueChange={(value) => setFramework(value as "owasp" | "atlas")}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Target"
            value={target}
            onChange={setTarget}
            options={options.map((one) => ({ value: one.id, label: one.name }))}
            allLabel={`All targets${options.length ? ` (${options.length})` : ""}`}
          />
          <TabsList>
            {FRAMEWORKS.map((one) => (
              <TabsTrigger key={one.value} value={one.value}>
                {one.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent
          value={framework}
          className="mt-0 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The coverage could not be loaded.
            <Button variant="outline" size="sm" onClick={again}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the coverage">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      )}

      {data && (
        <section aria-labelledby="coverage" className="min-w-0 rounded-[10px] border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
            <h2 id="coverage" className="text-[15px] font-semibold">
              {framework === "owasp"
                ? "OWASP Top 10 for LLM Applications (2025)"
                : `MITRE ATLAS ${ATLAS_VERSION} techniques`}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-text-secondary">
              {data.legend
                // A stale result is a gap of its own kind and shares its name, so it is named once.
                .filter((one, index, all) => all.findIndex((other) => other.label === one.label) === index)
                .filter(
                  (one) =>
                    one.status !== "not_testable" ||
                    data.targets.some((one) => one.target_status !== "verified"),
                )
                .map((one) => (
                  <li key={one.status}>
                    <span aria-hidden="true">{COVERAGE_SYMBOL[one.status]} </span>
                    {one.label}
                    {one.status === "gap" && " — never tested, or not since the target changed"}
                    {one.status === "not_applicable" && " — no test of the library applies"}
                    {one.status === "not_testable" && " — the target's ownership isn't verified"}
                  </li>
                ))}
            </ul>
          </div>
          <Table
            container={{
              tabIndex: 0,
              role: "group",
              "aria-label": "Framework coverage",
              className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            }}
          >
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead scope="col" className="text-xs">
                  {framework === "owasp" ? "Category" : "Technique"}
                </TableHead>
                {data.targets.map((one) => (
                  <TableHead key={one.id} scope="col" className="text-xs">
                    {one.name}
                  </TableHead>
                ))}
                <TableHead scope="col" className="text-xs">
                  Open findings
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.code} className={cn(!row.in_scope && "text-muted-foreground")}>
                  <TableCell className="align-top">
                    <span className="text-[13px] font-medium">
                      {framework === "owasp" ? <OwaspId code={row.code} /> : <AtlasId code={row.code} />}
                    </span>
                    <span className="block text-xs text-muted-foreground">{row.name ?? "—"}</span>
                    {!row.in_scope && (
                      <span className="block text-xs text-muted-foreground">
                        Out of scope — not part of application testing
                      </span>
                    )}
                  </TableCell>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.target_id} className="align-top">
                      <button
                        type="button"
                        onClick={() => setSelected({ code: row.code, targetId: cell.target_id })}
                        className={cn(
                          "min-h-6 rounded-[5px] px-1 py-1 text-left text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          TINT[cell.status],
                        )}
                        aria-label={`${row.code} for ${cell.target_name}: ${cell.label}`}
                        title={cell.reason || undefined}
                      >
                        <span aria-hidden="true">{COVERAGE_SYMBOL[cell.status]} </span>
                        {cellText(cell)}
                        {cell.open_findings > 0 && (
                          <span className="tabular block text-xs text-muted-foreground">
                            {cell.open_findings} open
                          </span>
                        )}
                      </button>
                    </TableCell>
                  ))}
                  <TableCell className="tabular align-top text-[13px]">{row.open_total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t p-3 text-[13px] text-muted-foreground">
            A category counts as tested when the target answered an attempt of a test of that category in a
            campaign run that ended — never because a campaign planned it.
          </p>
        </section>
      )}

        </TabsContent>
      </Tabs>

      <CoveragePanel
        code={selected?.code ?? null}
        targetId={selected?.targetId ?? null}
        framework={framework}
        onClose={() => setSelected(null)}
        onChanged={again}
      />
    </>
  )
}
