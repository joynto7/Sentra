"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { DismissPathDialog } from "@/components/risk/dismiss-path-dialog"
import { PathGraph } from "@/components/risk/path-graph"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type AttackPath,
  type AttackPaths as Paths,
  type PathStep,
  dismissAttackPath,
  getAttackPaths,
  getRiskDashboard,
  restoreAttackPath,
} from "@/lib/risk"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

/** The findings of one step, with the chip that marks what still needs confirmation (3a1). */
function StepFindings({ step }: { step: PathStep }) {
  return (
    <ul className="mt-1 space-y-1">
      {step.findings.map((finding) => (
        <li key={finding.code} className="flex flex-wrap items-center gap-2">
          <Link
            href={`/findings/${finding.code}`}
            className="inline-block py-0.5 text-[13px] font-medium text-link hover:underline"
          >
            {finding.code}
          </Link>
          <span className="text-[13px]">{finding.title}</span>
          <SeverityBadge severity={finding.severity} />
          {finding.unconfirmed && (
            <span className="rounded border border-dashed border-warning/60 px-1.5 py-0.5 text-xs text-warning">
              Unconfirmed
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** One path, as the panel and the list both show it (UC-7.5 step 5). */
function PathCard({
  path,
  selected,
  expanded,
  onSelect,
  onDismiss,
  onRestore,
  canTriage,
  busy,
}: {
  path: AttackPath
  selected: boolean
  /** The steps are written out for the path that is being followed; the rest show their chain. */
  expanded: boolean
  onSelect?: () => void
  onDismiss?: () => void
  onRestore?: () => void
  canTriage: boolean | undefined
  busy: boolean
}) {
  return (
    <li
      className={cn(
        "rounded-[8px] border p-3",
        selected ? "border-primary bg-muted/40" : "bg-card",
        path.reason && "border-dashed",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {onSelect ? (
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className="rounded-[5px] px-1 py-0.5 text-[15px] font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {path.code}
          </button>
        ) : (
          <span className="px-1 py-0.5 text-[15px] font-semibold">{path.code}</span>
        )}
        <SeverityBadge severity={path.severity} />
        {path.has_unconfirmed && (
          <span className="rounded border border-dashed border-warning/60 px-1.5 py-0.5 text-xs text-warning">
            Depends on an unconfirmed finding
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-text-secondary">{path.description}</p>
      <p className="mt-1 text-sm">{path.impact}</p>
      {expanded ? (
        <ol className="mt-2 space-y-2 border-l pl-3">
          {path.steps.map((step) => (
            <li key={step.number}>
              <p className="text-[13px] font-medium">
                {step.number}. {step.component.label}
              </p>
              <p className="text-[13px] text-text-secondary">{step.sentence}</p>
              <StepFindings step={step} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {path.steps.map((step) => step.component.label).join(" → ")}
        </p>
      )}
      {path.reason ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <p className="text-[13px] text-muted-foreground">
            Dismissed by {path.dismissed_by || "someone"}
            {path.dismissed_at ? ` on ${formatDate(path.dismissed_at)}` : ""}: {path.reason}
          </p>
          {canTriage && onRestore && (
            <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={onRestore}>
              Show again
            </Button>
          )}
        </div>
      ) : (
        canTriage &&
        onDismiss && (
          <div className="mt-3 border-t pt-2">
            <Button variant="outline" size="sm" className="h-8" onClick={onDismiss}>
              Dismiss path…
            </Button>
          </div>
        )
      )}
    </li>
  )
}

/**
 * Screen 44, Attack Paths (UC-7.5): the target's components with its open findings on them, and
 * the paths that lead from something an attacker can reach to an impact. The List view holds the
 * same paths without the drawing, so every path can be followed with a keyboard and a screen
 * reader (NFR-4.3), and nothing here has to be dragged.
 */
export function AttackPaths({ target: preselected }: { target?: string }) {
  const canTriage = useCan("triage_findings")
  const canMap = useCan("map_target_profiles")
  const [targets, setTargets] = useState<{ id: string; name: string; open: number }[]>([])
  const [targetId, setTargetId] = useState(preselected ?? "")
  const [answer, setData] = useState<Paths | null>(null)
  const [view, setView] = useState<"graph" | "list">("graph")
  const [selected, setSelected] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<AttackPath | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // The targets, ordered by risk score, so the view opens on the one that carries the most.
  useEffect(() => {
    const controller = new AbortController()
    getRiskDashboard(undefined, controller.signal)
      .then((dashboard) => {
        const rows = dashboard.targets.map((row) => ({
          id: row.id,
          name: row.name,
          open: row.open_total,
        }))
        setTargets(rows)
        setTargetId((chosen) => chosen || rows.find((row) => row.open > 0)?.id || rows[0]?.id || "")
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!targetId) return
    const controller = new AbortController()
    getAttackPaths(targetId, controller.signal)
      .then((found) => {
        setData(found)
        setSelected(found.paths[0]?.key ?? null)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [targetId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  // While another target is being read, the page shows its skeleton, not the one before.
  const data = answer && answer.target.id === targetId ? answer : null
  const current = data?.paths.find((path) => path.key === selected) ?? null

  async function dismiss(key: string, reason: string) {
    setBusy(true)
    try {
      const after = await dismissAttackPath(targetId, key, reason)
      setData(after)
      setSelected(after.paths[0]?.key ?? null)
      setDismissing(null)
      toast.success("The path is dismissed with your reason.")
    } catch (problem) {
      toast.error(problem instanceof ApiError ? problem.message : "The path could not be dismissed.")
    } finally {
      setBusy(false)
    }
  }

  async function restore(key: string) {
    setBusy(true)
    try {
      setData(await restoreAttackPath(targetId, key))
      toast.success("The path is shown again.")
    } catch (problem) {
      toast.error(problem instanceof ApiError ? problem.message : "The path could not be brought back.")
    } finally {
      setBusy(false)
    }
  }

  const wide = view === "graph"
  const panel = data && (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="paths" className="text-[15px] font-semibold">
          Attack paths ({data.paths.length})
        </h2>
        {data.unconfirmed > 0 && (
          <span className="text-xs text-muted-foreground">
            {data.unconfirmed} of its findings still require confirmation
          </span>
        )}
      </div>
      {data.paths.length === 0 ? (
        <p className="rounded-[8px] border bg-card p-3 text-sm text-text-secondary">
          {data.no_paths_reason || "No multi-step path was found."}
        </p>
      ) : (
        <ol className={cn("gap-3", wide ? "grid lg:grid-cols-2" : "space-y-3")}>
          {data.paths.map((path) => (
            <PathCard
              key={path.key}
              path={path}
              selected={path.key === selected}
              expanded={view === "list" || path.key === selected}
              onSelect={() => setSelected(path.key)}
              onDismiss={() => setDismissing(path)}
              canTriage={canTriage}
              busy={busy}
            />
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Paths follow only the connections recorded in the Target Profile.
      </p>
      {data.dismissed.length > 0 && (
        <section aria-labelledby="dismissed" className="space-y-2">
          <h3 id="dismissed" className="text-[13px] font-medium text-muted-foreground">
            Dismissed ({data.dismissed.length})
          </h3>
          <ol className="space-y-2">
            {data.dismissed.map((path) => (
              <PathCard
                key={path.key}
                path={path}
                selected={false}
                expanded={false}
                onRestore={() => restore(path.key)}
                canTriage={canTriage}
                busy={busy}
              />
            ))}
          </ol>
        </section>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Attack Paths"
        description="How single weaknesses of a target combine into a larger impact, along the components its Target Profile records."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Target"
          value={targetId}
          onChange={(value) => {
            setTargetId(value)
            setSelected(null)
          }}
          options={targets.map((one) => ({
            value: one.id,
            label: `${one.name}${one.open ? ` · ${one.open} open` : ""}`,
          }))}
          allLabel={null}
        />
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => value && setView(value as "graph" | "list")}
          variant="outline"
          aria-label="How to show the paths"
        >
          <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
          <ToggleGroupItem value="list">List</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The attack paths could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the attack paths">
          <Skeleton className="h-72 w-full" />
        </div>
      )}

      {data?.blocker && (
        <div className="space-y-4">
          <EmptyState
            title="No graph for this target yet"
            description={
              canMap
                ? data.blocker.message
                : "The graph is drawn from the target's profile, and this target has none yet. An AI Application Developer or a Security Analyst maps it."
            }
            action={
              canMap ? (
                <Button asChild className="h-9 hover:bg-primary-hover">
                  <Link href={`/targets/${targetId}/profile`}>Map the target&apos;s profile</Link>
                </Button>
              ) : undefined
            }
          />
          {data.findings.length > 0 && (
            <section aria-labelledby="bare-findings" className="rounded-[10px] border bg-card p-4">
              <h2 id="bare-findings" className="text-[15px] font-semibold">
                Its open findings
              </h2>
              <ul className="mt-2 space-y-1">
                {data.findings.map((finding) => (
                  <li key={finding.code} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Link
                      href={`/findings/${finding.code}`}
                      className="inline-block py-0.5 font-medium text-link hover:underline"
                    >
                      {finding.code}
                    </Link>
                    {finding.title}
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-muted-foreground">{finding.component.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {data && !data.blocker && view === "graph" && (
        <div className="space-y-4">
          {/* The pipeline is wider than it is tall, so it gets the whole width: the design's
              canvas beside the panel would leave it too small to read. */}
          <section aria-label="The target's components" className="min-w-0 rounded-[10px] border bg-card p-3">
            <div
              tabIndex={0}
              role="group"
              aria-label="The graph of the target's components"
              className="overflow-x-auto rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <PathGraph nodes={data.nodes} edges={data.edges} findings={data.findings} selected={current} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {current
                ? `${current.code} is drawn through the numbered components.`
                : "Select a path to follow it through the components."}{" "}
              A dashed component is not in the Target Profile any more. The List view holds the same
              paths as text.
            </p>
          </section>
          <section aria-labelledby="paths" className="min-w-0">
            {panel}
          </section>
        </div>
      )}

      {data && !data.blocker && view === "list" && (
        <div className="grid gap-4 lg:grid-cols-5">
          <section aria-labelledby="paths" className="min-w-0 lg:col-span-3">
            {panel}
          </section>
          <section
            aria-labelledby="components"
            className="min-w-0 rounded-[10px] border bg-card p-4 lg:col-span-2"
          >
            <h2 id="components" className="text-[15px] font-semibold">
              Components and their findings
            </h2>
            <ul className="mt-2 space-y-2">
              {data.nodes.map((node) => (
                <li key={node.id} className="text-[13px]">
                  <span className="font-medium">{node.label}</span>
                  {!node.in_profile && (
                    <span className="ml-2 text-xs text-muted-foreground">not in the Target Profile</span>
                  )}
                  {node.impact && <span className="block text-xs text-muted-foreground">{node.impact}</span>}
                  {node.findings.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {node.findings.map((code) => (
                        <li key={code}>
                          <Link
                            href={`/findings/${code}`}
                            className="inline-block py-0.5 text-link hover:underline"
                          >
                            {code}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="block text-xs text-muted-foreground">No open finding</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <DismissPathDialog
        path={dismissing}
        busy={busy}
        onClose={() => setDismissing(null)}
        onDismiss={dismiss}
      />
    </>
  )
}
