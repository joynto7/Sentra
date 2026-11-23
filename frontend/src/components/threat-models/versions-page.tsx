"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeftRight, CircleAlert, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { AiGeneratedLabel, CHIP, VersionStatus } from "@/components/threat-models/badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type ComparedThreat,
  type RunRef,
  type ThreatModelPage,
  type VersionComparison,
  type VersionSummary,
  compareVersions,
  getThreatModel,
  longDate,
  plural,
  restoreThreatModelVersion,
  shortDate,
} from "@/lib/threat-models"
import { cn } from "@/lib/utils"

const FIELD: Record<string, string> = {
  title: "Title",
  owasp: "OWASP",
  atlas: "MITRE ATLAS",
  likelihood: "Likelihood",
  impact: "Impact",
}

const FAILED = "Sentra could not load the versions."

/** Added, removed and changed are named in words, never by colour alone (NFR-4.3). */
function Tag({ kind }: { kind: "Added" | "Removed" | "Changed" }) {
  const style = {
    Added: "border-success/50 text-success",
    Removed: "border-destructive/50 text-destructive",
    Changed: "border-primary/40 text-link",
  }[kind]
  return <span className={cn(CHIP, "shrink-0", style)}>{kind}</span>
}

function ThreatLine({ threat, children }: { threat: ComparedThreat | { title: string; component_name: string; reason: string | null }; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">{threat.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{threat.component_name}</p>
      {children}
      {threat.reason && <p className="mt-1 text-xs text-text-secondary">Reason {threat.reason}</p>}
    </div>
  )
}

function Runs({ version, runs }: { version: number; runs: RunRef[] }) {
  if (runs.length === 0) return null
  return (
    <section aria-labelledby={`runs-${version}`} className="rounded-[10px] border bg-card p-4">
      <h3 id={`runs-${version}`} className="text-sm font-semibold">
        Campaign runs based on v{version}
      </h3>
      {/* Each code leads to that run's monitor (Screen 36, FR-5.4); a retest or benchmark run
       * belongs to no campaign and has no page of its own yet, so it stays plain text. */}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {runs.map((run) => (
          <li key={run.id} className={cn(CHIP, "border-border font-mono text-text-secondary")}>
            {run.campaign ? (
              <Link href={`/campaigns/${run.campaign}/runs/${run.number}`} className="text-link hover:underline">
                {run.code}
              </Link>
            ) : (
              run.code
            )}
            {run.started_at && <span className="font-sans text-muted-foreground">{shortDate(run.started_at)}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function VersionRow({ version, current, active }: { version: VersionSummary; current: boolean; active: boolean }) {
  return (
    <li className={cn("border-t px-4 py-3 text-sm first:border-t-0", active && "bg-accent/40")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular font-semibold">v{version.version}</span>
        <VersionStatus version={version} />
        {current ? (
          <span className={cn(CHIP, "border-border-strong text-text-secondary")}>Current</span>
        ) : (
          <span className={cn(CHIP, "border-border text-muted-foreground")}>Read-only</span>
        )}
        {version.ai_generated && version.status === "draft" && <AiGeneratedLabel />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {version.status === "approved" && version.approved_at
          ? `Approved ${longDate(version.approved_at)}${version.approved_by ? ` by ${version.approved_by}` : ""}`
          : `Saved ${longDate(version.created_at)}${version.created_by ? ` by ${version.created_by}` : " by Sentra"}`}
        {" · "}
        {plural(version.threat_count, "threat", "threats")}
        {" · "}
        {version.runs === 0 ? "no runs yet" : `used by ${plural(version.runs, "run", "runs")}`}
      </p>
    </li>
  )
}

/** Screen 28: the versions of a target's threat model, what changed between two of them, and
 * restoring an earlier one as a new draft (UC-3.4, FR-3.3). */
export function VersionsPage({
  targetId,
  initialBase,
  initialCompare,
}: {
  targetId: string
  initialBase: number | null
  initialCompare: number | null
}) {
  const router = useRouter()
  const canManage = useCan("manage_threat_models")
  const [page, setPage] = useState<ThreatModelPage | null>(null)
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null)
  const [base, setBase] = useState<number | null>(initialBase)
  const [compare, setCompare] = useState<number | null>(initialCompare)
  const [comparison, setComparison] = useState<VersionComparison | null>(null)
  const [comparing, setComparing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [announcement, setAnnouncement] = useState("")

  // The versions, and right away the comparison the page opens with: the newest version against
  // the one before it, unless the address named a pair (UC-3.4 steps 1-2).
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const found = await getThreatModel(targetId, null, controller.signal)
        setPage(found)
        setLoadError(null)
        const numbers = found.versions.map((v) => v.version)
        const to = initialCompare && numbers.includes(initialCompare) ? initialCompare : (numbers[0] ?? null)
        const from =
          initialBase && numbers.includes(initialBase) && initialBase !== to ? initialBase : (numbers[1] ?? null)
        setCompare(to)
        setBase(from)
        if (from !== null && to !== null && from !== to) {
          setComparison(await compareVersions(targetId, from, to, controller.signal))
        }
      } catch (caught) {
        if (controller.signal.aborted) return
        setLoadError(
          caught instanceof ApiError ? { code: caught.code, message: caught.message } : { code: "error", message: FAILED },
        )
      }
    }
    void load()
    return () => controller.abort()
  }, [targetId, initialBase, initialCompare])

  usePageCrumbs(page ? [{ label: page.target.name, href: `/threat-models/${targetId}` }, { label: "Versions" }] : [])

  // The pair in the address bar, so a comparison can be linked to and reopened (UC-3.4 step 2).
  async function run(from: number, to: number, push = true) {
    setComparing(true)
    try {
      const found = await compareVersions(targetId, from, to)
      setComparison(found)
      setAnnouncement(
        found.identical
          ? `Version ${from} and version ${to} have the same threats.`
          : `${found.added.length} added, ${found.removed.length} removed, ${found.changed.length} changed between version ${from} and version ${to}.`,
      )
      if (push) router.replace(`/threat-models/${targetId}/versions?base=${from}&compare=${to}`, { scroll: false })
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The versions couldn't be compared.")
    } finally {
      setComparing(false)
    }
  }

  async function restore(version: number) {
    setRestoring(true)
    try {
      const result = await restoreThreatModelVersion(targetId, version)
      const draft = result.current?.version
      toast.success(`Version ${version} is restored as version ${draft}, a new draft to approve.`)
      router.push(`/threat-models/${targetId}`)
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The version couldn't be restored.")
      setRestoring(false)
    }
  }

  // The page keeps its heading while it loads and when it has nothing to show.
  if (!page) {
    return (
      <div className="mx-auto w-full max-w-[1200px]">
        <h1 className="mb-5 text-2xl font-semibold tracking-tight">Threat model versions</h1>
        {loadError ? (
          <EmptyState
            title={loadError.code === "not_found" ? "Threat model not found" : "Versions not available"}
            description={loadError.message}
            action={
              <Button asChild variant="outline">
                <Link href="/threat-models">Back to Threat Models</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the versions">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        )}
      </div>
    )
  }

  const versions = page.versions
  const newest = versions[0] ?? null
  const archived = page.target.status === "archived"
  const canRestore = Boolean(canManage && !archived && base !== null && newest && base !== newest.version)
  const counts = comparison
    ? [
        ["Added", comparison.added.length],
        ["Removed", comparison.removed.length],
        ["Changed", comparison.changed.length],
      ]
    : []

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Threat model versions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change to {page.target.name}&apos;s threat model is a new version. Stored versions never change, so a
          campaign always says what it was based on.
        </p>
      </div>

      {archived && (
        <Alert className="mb-4">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>This target is archived, so its versions can only be read.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section aria-labelledby="versions-heading" className="self-start rounded-[10px] border bg-card">
          <h2 id="versions-heading" className="px-4 pt-4 pb-2 text-[15px] font-semibold">
            Versions
          </h2>
          <ul>
            {versions.map((version) => (
              <VersionRow
                key={version.version}
                version={version}
                current={newest?.version === version.version}
                active={version.version === base || version.version === compare}
              />
            ))}
          </ul>
        </section>

        <div className="min-w-0 space-y-4">
          {versions.length < 2 ? (
            <Alert>
              <CircleAlert aria-hidden="true" />
              <AlertDescription>
                There is only version 1 so far. The next review or generation makes a version to compare it with.
              </AlertDescription>
            </Alert>
          ) : (
            <section aria-labelledby="compare-heading" className="rounded-[10px] border bg-card p-4">
              <h2 id="compare-heading" className="sr-only">
                Compare two versions
              </h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="compare-base">Base</Label>
                  <Select value={base ? String(base) : ""} onValueChange={(value) => setBase(Number(value))}>
                    <SelectTrigger id="compare-base" className="h-9 w-36">
                      <SelectValue placeholder="Version" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v.version} value={String(v.version)} disabled={v.version === compare}>
                          v{v.version} · {v.status === "approved" ? "Approved" : "Draft"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ArrowLeftRight className="mb-2.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1.5">
                  <Label htmlFor="compare-compare">Compare</Label>
                  <Select value={compare ? String(compare) : ""} onValueChange={(value) => setCompare(Number(value))}>
                    <SelectTrigger id="compare-compare" className="h-9 w-36">
                      <SelectValue placeholder="Version" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v.version} value={String(v.version)} disabled={v.version === base}>
                          v{v.version} · {v.status === "approved" ? "Approved" : "Draft"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="mb-0.5 h-9 hover:bg-primary-hover"
                  onClick={() => base !== null && compare !== null && void run(base, compare)}
                  disabled={comparing || base === null || compare === null || base === compare}
                  aria-describedby={base === null || compare === null || base === compare ? "compare-hint" : undefined}
                >
                  {comparing ? "Comparing…" : "Compare"}
                </Button>
                {(base === null || compare === null || base === compare) && (
                  <p id="compare-hint" className="mb-1.5 text-xs text-muted-foreground">
                    Choose two different versions to compare them.
                  </p>
                )}
                {canRestore && base !== null && (
                  <Button
                    variant="outline"
                    className="mb-0.5 h-9"
                    onClick={() => void restore(base)}
                    disabled={restoring}
                  >
                    <RotateCcw aria-hidden="true" />
                    {restoring ? "Restoring…" : `Restore v${base} as a new draft`}
                  </Button>
                )}
              </div>
              {canRestore && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Restoring copies version {base} into a new draft; the draft needs an approval of its own, and the
                  stored versions stay as they are.
                </p>
              )}
            </section>
          )}

          {comparison && (
            <>
              <section aria-labelledby="changes-heading" className="rounded-[10px] border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
                  <h2 id="changes-heading" className="text-[15px] font-semibold">
                    What changed from v{comparison.base.version} to v{comparison.compare.version}
                  </h2>
                  <ul className="flex flex-wrap gap-2" aria-label="Summary of the changes">
                    {counts.map(([label, value]) => (
                      <li key={label} className={cn(CHIP, "border-border text-text-secondary")}>
                        <span className="tabular font-semibold">{value}</span> {String(label).toLowerCase()}
                      </li>
                    ))}
                  </ul>
                </div>

                {comparison.identical ? (
                  <p className="border-t px-4 py-8 text-center text-sm text-muted-foreground">
                    Both versions hold the same threats with the same ratings.
                  </p>
                ) : (
                  <ul aria-label="Changes between the two versions">
                    {comparison.added.map((threat) => (
                      <li key={`a-${threat.number}`} className="flex items-start gap-3 border-t px-4 py-3">
                        <Tag kind="Added" />
                        <ThreatLine threat={threat}>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            <span className="font-mono">{threat.owasp.join(", ")}</span>
                            {threat.atlas && <span className="font-mono"> · {threat.atlas}</span>} · likelihood{" "}
                            {threat.likelihood} · impact {threat.impact}
                          </p>
                        </ThreatLine>
                      </li>
                    ))}
                    {comparison.removed.map((threat) => (
                      <li key={`r-${threat.number}`} className="flex items-start gap-3 border-t px-4 py-3">
                        <Tag kind="Removed" />
                        <ThreatLine threat={threat} />
                      </li>
                    ))}
                    {comparison.changed.map((threat) => (
                      <li key={`c-${threat.number}`} className="flex items-start gap-3 border-t px-4 py-3">
                        <Tag kind="Changed" />
                        <ThreatLine threat={threat}>
                          <ul className="mt-1 space-y-0.5">
                            {threat.changes.map((change) => (
                              <li key={change.field} className="text-xs text-text-secondary">
                                {FIELD[change.field] ?? change.field}{" "}
                                <span className="text-muted-foreground">{change.before}</span> →{" "}
                                <span className="font-medium">{change.after}</span>
                              </li>
                            ))}
                          </ul>
                        </ThreatLine>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Runs version={comparison.base.version} runs={comparison.base_runs} />
              <Runs version={comparison.compare.version} runs={comparison.compare_runs} />

              {!canManage && canManage !== undefined && (
                <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>Only a Security Analyst can restore an earlier version.</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
