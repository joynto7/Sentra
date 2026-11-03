"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bug, CircleCheck, CircleHelp, FlaskConical, Info, KeyRound, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { KnownVulnerabilitiesDialog } from "@/components/lab/known-vulnerabilities-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError } from "@/lib/api"
import {
  BENCHMARK_STATUS_LABEL,
  type BenchmarkItem,
  type Lab,
  type LabCard,
  deployLabTarget,
  listBenchmarks,
  memory,
  resetLabTarget,
  securityLab,
} from "@/lib/lab"
import { useCan } from "@/lib/permissions"
import { TYPE_LABEL } from "@/lib/targets"
import { cn } from "@/lib/utils"

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

/** Readiness in words as well as in colour (WCAG 1.4.1), with a spinner while a reset runs. */
function Readiness({ card }: { card: LabCard }) {
  if (!card.deployed) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <CircleHelp className="size-3.5 text-muted-foreground" aria-hidden="true" />
        Not deployed
      </Badge>
    )
  }
  if (card.state === "deploying" || card.state === "resetting") {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        {card.state_label}
      </Badge>
    )
  }
  const ready = card.state === "ready"
  return (
    <Badge variant="outline" className={cn("gap-1.5", !ready && "border-destructive text-destructive")}>
      {ready ? (
        <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <TriangleAlert className="size-3.5" aria-hidden="true" />
      )}
      {card.state_label}
    </Badge>
  )
}

function LabTargetCard({
  card,
  busy,
  canUse,
  onDeploy,
  onReset,
  onVulnerabilities,
}: {
  card: LabCard
  busy: boolean
  canUse: boolean
  onDeploy: () => void
  onReset: () => void
  onVulnerabilities: () => void
}) {
  return (
    <section aria-label={card.name} className="flex flex-col rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" />
            {card.name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{TYPE_LABEL[card.type] ?? card.type}</p>
        </div>
        <Readiness card={card} />
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{card.about}</p>

      {card.deployed ? (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <Bug className="size-3.5" aria-hidden="true" />
              Known vulnerabilities
            </dt>
            <dd className="tabular">{card.vulnerabilities}</dd>
            <dd className="flex flex-wrap gap-1">
              {card.categories.map((category) => (
                <Badge key={category} variant="outline" className="font-mono text-xs">
                  {category}
                </Badge>
              ))}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden="true" />
              Planted canary tokens
            </dt>
            <dd className="tabular">{card.canaries}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted-foreground">Last reset</dt>
            <dd className="tabular">
              {card.last_reset_at ? WHEN.format(new Date(card.last_reset_at)) : "Not reset yet"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          About {card.minutes} minutes · needs {memory(card.memory_mb)} memory
        </p>
      )}

      {card.last_error && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{card.last_error}</AlertDescription>
        </Alert>
      )}
      {card.active_run && (
        <p className="mt-3 text-xs text-muted-foreground">
          {card.active_run} is running against it, so it can&apos;t be reset now.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        {card.deployed ? (
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={`/targets/${card.target_id}`}>
                Open
                <span className="sr-only"> {card.name}</span>
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={busy || !canUse || card.state !== "ready" || !!card.active_run}
            >
              Reset
              <span className="sr-only"> {card.name}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onVulnerabilities} disabled={!card.vulnerabilities}>
              Known vulnerabilities
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onDeploy} disabled={busy || !canUse}>
            {busy ? "Deploying…" : "Deploy"}
            <span className="sr-only"> {card.name}</span>
          </Button>
        )}
      </div>
    </section>
  )
}

/**
 * Screen 65: the Security Lab (FR-11.1, FR-11.2). Deploying is one action (UC-11.1), a reset puts
 * a lab target back to its original state with new canary tokens (UC-11.2), and the isolation of
 * the Lab zone is said on the page.
 */
export function SecurityLabPage() {
  const canUse = useCan("use_security_lab")
  const [data, setData] = useState<Lab | null>(null)
  const [error, setError] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [showing, setShowing] = useState<LabCard | null>(null)
  const [runs, setRuns] = useState<BenchmarkItem[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    securityLab(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [reloads])

  useEffect(() => {
    const controller = new AbortController()
    listBenchmarks(controller.signal)
      .then((found) => setRuns(found))
      .catch(() => !controller.signal.aborted && setRuns([]))
    return () => controller.abort()
  }, [reloads])

  const reload = useCallback(() => setReloads((n) => n + 1), [])
  const working =
    data?.cards.some((card) => card.state === "deploying" || card.state === "resetting") ?? false

  // While a worker deploys or resets, the page asks again, so the card becomes "Ready" by itself
  // (UC-11.1 step 6, UC-11.2 step 6).
  useEffect(() => {
    if (!working) return
    const timer = setTimeout(reload, 3000)
    return () => clearTimeout(timer)
  }, [working, reload, reloads])

  async function deploy(card: LabCard) {
    setBusy(card.key)
    try {
      const done = await deployLabTarget(card.key)
      // It is not ready yet: a worker is reading what it reports and testing its connection, and
      // the card says "Deploying" until it is (UC-11.1 steps 2 and 6).
      toast.success(`${done.name} is being deployed.`, {
        description: "Sentra places its ownership token, reads its canary tokens and tests the connection.",
      })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The lab target could not be deployed.")
    } finally {
      setBusy(null)
    }
  }

  async function reset(card: LabCard) {
    if (!card.target_id) return
    setBusy(card.key)
    try {
      await resetLabTarget(card.target_id)
      toast.success(`${card.name} is being reset.`, {
        description: "It gets its synthetic data back and new canary tokens.",
      })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The lab target could not be reset.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Security Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Intentionally vulnerable lab targets in an isolated zone — synthetic data, simulated
            tools, no internet access.
          </p>
        </div>
        {canUse !== false && (
          <Button asChild>
            <Link href="/lab/benchmarks/new">New benchmark run</Link>
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            The Security Lab could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="targets">
        <TabsList>
          <TabsTrigger value="targets">Lab targets</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmark runs</TabsTrigger>
        </TabsList>

        <TabsContent
          value="targets"
          className="mt-4 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {!data && !error && (
            <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading the lab targets">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          )}

          {data && data.cards.length === 0 && (
            <EmptyState
              title="The Security Lab isn't enabled in this deployment"
              description="Whoever runs Sentra starts the Lab zone and names its hosts in LAB_HOSTS. Until then there is no lab target to deploy."
            />
          )}

          {data && data.cards.length > 0 && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {data.cards.map((card) => (
                  <LabTargetCard
                    key={card.key}
                    card={card}
                    busy={busy === card.key}
                    canUse={canUse !== false}
                    onDeploy={() => void deploy(card)}
                    onReset={() => void reset(card)}
                    onVulnerabilities={() => setShowing(card)}
                  />
                ))}
              </div>
              <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {data.isolation}
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent
          value="benchmarks"
          className="mt-4 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {runs === null ? (
            <Skeleton className="h-28 w-full" />
          ) : runs.length === 0 ? (
            <EmptyState
              title="No benchmark run yet"
              description="A benchmark run compares testing strategies on the same lab targets under equal conditions."
            />
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li key={run.code}>
                  <Link
                    href={`/lab/benchmarks/${run.code}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border bg-card p-4 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium">
                        {run.code} — {run.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {run.lab_targets.join(", ")} · {run.strategies.length} strategies ·{" "}
                        {run.repetitions} repetitions
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular text-xs text-muted-foreground">
                        {run.runs_done} of {run.runs_total} runs
                      </span>
                      <Badge variant="outline">{BENCHMARK_STATUS_LABEL[run.status]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <KnownVulnerabilitiesDialog card={showing} onClose={() => setShowing(null)} />
    </div>
  )
}
