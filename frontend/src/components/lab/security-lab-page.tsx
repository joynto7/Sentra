"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { KnownVulnerabilitiesDialog } from "@/components/lab/known-vulnerabilities-dialog"
import { LabTargetCard } from "@/components/lab/lab-card"
import { LabZone } from "@/components/lab/lab-zone"
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
  resetLabTarget,
  securityLab,
} from "@/lib/lab"
import { useCan } from "@/lib/permissions"
import { cn } from "@/lib/utils"

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
  const [show, setShow] = useState<"all" | "deployed" | "waiting">("all")
  const [flash, setFlash] = useState<string | null>(null)

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
  const working = data?.cards.some((card) => card.state === "deploying" || card.state === "resetting") ?? false

  const deployed = data?.cards.filter((card) => card.deployed) ?? []
  const shownCards = (data?.cards ?? []).filter((card) => show === "all" || (show === "deployed" ? card.deployed : !card.deployed))

  // While a worker deploys or resets, the page asks again, so the card becomes "Ready" by itself
  // (UC-11.1 step 6, UC-11.2 step 6).
  useEffect(() => {
    if (!working) return
    const timer = setTimeout(reload, 3000)
    return () => clearTimeout(timer)
  }, [working, reload, reloads])

  /** A node of the zone picture: go to its card and light it for a moment. */
  function pick(key: string) {
    setShow("all")
    window.setTimeout(() => document.getElementById(`lab-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
    setFlash(key)
    window.setTimeout(() => setFlash(null), 1800)
  }

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
          <p className="mt-1 text-sm text-muted-foreground">Vulnerable lab targets in an isolated zone, with synthetic data.</p>
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

      {canUse === false && (
        <p role="note" className="mb-4 rounded-[10px] border bg-card p-4 text-sm text-muted-foreground">
          Only Security Analysts deploy, reset or benchmark.
        </p>
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
            <EmptyState title="The Security Lab isn't enabled in this deployment" description="Start the Lab zone and set LAB_HOSTS." />
          )}

          {data && data.cards.length > 0 && (
            <>
              <LabZone cards={data.cards} isolation={data.isolation} onPick={pick} />
              <ul className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { id: "all", label: "Lab targets", value: data.cards.length, note: "In the zone", press: true },
                  { id: "deployed", label: "Deployed", value: deployed.length, note: "Yours to test", press: true },
                  {
                    id: "waiting",
                    label: "Not deployed",
                    value: data.cards.length - deployed.length,
                    note: "One click to deploy",
                    press: true,
                  },
                  {
                    id: "tokens",
                    label: "Canary tokens",
                    value: deployed.reduce((sum, card) => sum + card.canaries, 0),
                    note: "Planted now",
                    press: false,
                  },
                ].map((tile) => {
                  const body = (
                    <>
                      <span className="text-xs text-muted-foreground">{tile.label}</span>
                      <span className="tabular mt-1 text-3xl leading-none font-semibold">{tile.value}</span>
                      <span className="mt-2 text-xs text-muted-foreground">{tile.note}</span>
                    </>
                  )
                  return (
                    <li key={tile.id}>
                      {tile.press ? (
                        <button
                          type="button"
                          aria-pressed={show === tile.id}
                          onClick={() => setShow(tile.id as typeof show)}
                          className={cn(
                            "flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
                            show === tile.id ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
                          )}
                        >
                          {body}
                        </button>
                      ) : (
                        <div className="flex h-full flex-col rounded-2xl border bg-card p-4">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
              <ul className="grid gap-4 lg:grid-cols-2">
                {shownCards.map((card) => (
                  <li key={card.key} id={`lab-${card.key}`} className="min-w-0 scroll-mt-24">
                    <LabTargetCard
                      card={card}
                      busy={busy === card.key}
                      canUse={canUse !== false}
                      flash={flash === card.key}
                      onDeploy={() => void deploy(card)}
                      onReset={() => void reset(card)}
                      onVulnerabilities={() => setShowing(card)}
                    />
                  </li>
                ))}
              </ul>
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
            <EmptyState title="No benchmark run yet" description="Compare testing strategies on lab targets." />
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
                        {run.lab_targets.join(", ")} · {run.strategies.length} strategies · {run.repetitions} repetitions
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
