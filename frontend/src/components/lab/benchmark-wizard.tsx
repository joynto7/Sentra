"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Info, Plus, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  type BenchmarkEstimate,
  type BenchmarkItem,
  type LabCard,
  type NewBenchmark,
  costRange,
  duration,
  estimateBenchmark,
  listBenchmarks,
  saveBenchmark,
  securityLab,
  startBenchmark,
} from "@/lib/lab"
import { useCan } from "@/lib/permissions"
import { type SuiteItem, listSuites } from "@/lib/test-library"
import { cn } from "@/lib/utils"

const LETTERS = ["A", "B", "C", "D", "E", "F"]

type Row = { key: string; name: string; suites: string[]; adaptive_agent: boolean }

function Section({
  number,
  id,
  title,
  children,
}: {
  number: number
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-[10px] border bg-card p-6">
      <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="tabular flex size-6 items-center justify-center rounded-full bg-muted text-xs">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * Screen 66: a new benchmark run (FR-11.3, UC-11.3). The fairness rule is on the page — every
 * strategy gets the same budget and the same repetitions — and so is the estimate with the
 * organization's monthly limits, before anything starts.
 */
export function BenchmarkWizard() {
  const router = useRouter()
  const canUse = useCan("use_security_lab")
  usePageCrumbs([{ label: "New benchmark run" }])

  const [cards, setCards] = useState<LabCard[] | null>(null)
  const [suites, setSuites] = useState<SuiteItem[] | null>(null)
  const [earlier, setEarlier] = useState<BenchmarkItem[]>([])
  const [failed, setFailed] = useState(false)

  const [name, setName] = useState("")
  const [targets, setTargets] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([
    { key: "A", name: "Static suites", suites: [], adaptive_agent: false },
    { key: "B", name: "Adaptive agent", suites: [], adaptive_agent: true },
  ])
  const [budget, setBudget] = useState("1000")
  const [repetitions, setRepetitions] = useState("5")
  const [judgeEvery, setJudgeEvery] = useState(true)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [found, setFound] = useState<{ key: string; estimate: BenchmarkEstimate } | null>(null)
  const [pending, setPending] = useState<"draft" | "start" | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      securityLab(controller.signal),
      listSuites(),
      listBenchmarks(controller.signal),
    ])
      .then(([lab, found, runs]) => {
        setCards(lab.cards)
        setSuites(found)
        setEarlier(runs.filter((run) => run.status === "completed"))
      })
      .catch(() => !controller.signal.aborted && setFailed(true))
    return () => controller.abort()
  }, [])

  const ready = useMemo(() => (cards ?? []).filter((card) => card.state === "ready"), [cards])
  const body: NewBenchmark = useMemo(
    () => ({
      name: name.trim(),
      target_ids: targets,
      strategies: rows.map((row) => ({
        key: row.key,
        name: row.name.trim() || `Strategy ${row.key}`,
        suites: row.suites,
        adaptive_agent: row.adaptive_agent,
      })),
      attempt_budget: Number(budget) || 0,
      repetitions: Number(repetitions) || 0,
      judge_every_attempt: judgeEvery,
      baseline_code: baseline,
    }),
    [name, targets, rows, budget, repetitions, judgeEvery, baseline],
  )

  const complete =
    targets.length > 0 && rows.length >= 2 && rows.every((row) => row.suites.length > 0)
  const key = JSON.stringify(body)

  // UC-11.3 step 5: the estimate follows the configuration, so the cost is visible while it is
  // still being decided. It is kept with the configuration it belongs to, so a stale one is never
  // shown beside changed numbers.
  useEffect(() => {
    if (!complete) return
    let current = true
    const timer = setTimeout(() => {
      estimateBenchmark(body)
        .then((answer) => current && setFound({ key, estimate: answer }))
        .catch(() => undefined)
    }, 400)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [key, complete, body])
  const estimate = complete && found?.key === key ? found.estimate : null

  const setRow = useCallback((index: number, change: Partial<Row>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))
  }, [])

  async function submit(what: "draft" | "start") {
    const found: Record<string, string> = {}
    if (!targets.length) found.target_ids = "Choose at least one lab target."
    if (rows.length < 2) found.strategies = "Define at least two strategies, so there is something to compare."
    if (rows.some((row) => !row.suites.length)) found.strategies = "Every strategy needs at least one test suite."
    if (!Number(budget)) found.attempt_budget = "Enter an attempt budget."
    if (!Number(repetitions)) found.repetitions = "Enter how often each configuration repeats."
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(what)
    try {
      const saved = await saveBenchmark(body)
      if (what === "start") {
        await startBenchmark(saved.code)
        toast.success(`${saved.code} has started.`, {
          description: "Each repetition starts from a freshly reset lab target.",
        })
      } else {
        toast.success(`${saved.code} is saved as a draft.`, {
          description: "Start it when you are ready.",
        })
      }
      router.push(`/lab/benchmarks/${saved.code}`)
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(
        Object.keys(fields).length
          ? fields
          : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." },
      )
    } finally {
      setPending(null)
    }
  }

  if (canUse === false) {
    return (
      <EmptyState
        title="Only a Security Analyst runs benchmarks"
        description="The Security Lab and its benchmark runs belong to the analysts of this organization."
      />
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New benchmark run</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The same lab targets, the same budget and the same repetitions for every strategy.
        </p>
      </div>

      {failed && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>The Security Lab could not be loaded.</AlertDescription>
        </Alert>
      )}

      {!cards && !failed && (
        <div className="space-y-4" role="status" aria-label="Loading the Security Lab">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {cards && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void submit("start")
            }}
            className="space-y-6"
          >
            {errors.form && (
              <Alert variant="destructive" role="alert">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            )}

            <Section number={1} id="benchmark-name-heading" title="What this experiment is">
              <FormField id="benchmark-name" label="Name" error={errors.name}>
                <Input
                  id="benchmark-name"
                  value={name}
                  maxLength={200}
                  placeholder="Static suites against the adaptive agent"
                  onChange={(event) => setName(event.target.value)}
                  className="h-9"
                />
              </FormField>
            </Section>

            <Section number={2} id="benchmark-targets-heading" title="Lab targets">
              {ready.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No lab target is ready. Deploy one in the{" "}
                  <Link href="/lab" className="text-primary underline underline-offset-2">
                    Security Lab
                  </Link>{" "}
                  first — a benchmark never runs against a real application.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(cards ?? []).map((card) => {
                    const usable = card.state === "ready" && !!card.target_id
                    return (
                      <li
                        key={card.key}
                        className={cn(
                          "flex items-start gap-3 rounded-[10px] border p-3",
                          !usable && "opacity-60",
                        )}
                      >
                        <Checkbox
                          id={`target-${card.key}`}
                          checked={!!card.target_id && targets.includes(card.target_id)}
                          disabled={!usable}
                          onCheckedChange={(on) =>
                            setTargets((current) =>
                              on
                                ? [...current, card.target_id!]
                                : current.filter((id) => id !== card.target_id),
                            )
                          }
                          className="mt-0.5"
                        />
                        <label htmlFor={`target-${card.key}`} className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{card.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {usable
                              ? `${card.vulnerabilities} known vulnerabilities · ${card.canaries} canary tokens`
                              : card.deployed
                                ? card.state_label
                                : "Not deployed"}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              {errors.target_ids && (
                <p id="benchmark-targets-error" className="text-xs text-destructive">
                  {errors.target_ids}
                </p>
              )}
            </Section>

            <Section number={3} id="benchmark-strategies-heading" title="Testing strategies">
              <p className="text-sm text-muted-foreground">
                At least two, so there is something to compare.
              </p>
              <ul className="space-y-3">
                {rows.map((row, index) => (
                  <li key={row.key} className="rounded-[10px] border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {row.key}
                        </span>
                        <label className="sr-only" htmlFor={`strategy-name-${row.key}`}>
                          Name of strategy {row.key}
                        </label>
                        <Input
                          id={`strategy-name-${row.key}`}
                          value={row.name}
                          maxLength={120}
                          onChange={(event) => setRow(index, { name: event.target.value })}
                          className="h-9"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0"
                        disabled={rows.length <= 2}
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                      >
                        <X className="size-4" aria-hidden="true" />
                        <span className="sr-only">Remove strategy {row.key}</span>
                      </Button>
                    </div>

                    <fieldset className="mt-3">
                      <legend className="text-xs text-muted-foreground">Test suites</legend>
                      <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        {(suites ?? []).map((suite) => (
                          <li key={suite.code} className="flex items-start gap-2">
                            <Checkbox
                              id={`suite-${row.key}-${suite.code}`}
                              checked={row.suites.includes(suite.code)}
                              onCheckedChange={(on) =>
                                setRow(index, {
                                  suites: on
                                    ? [...row.suites, suite.code]
                                    : row.suites.filter((code) => code !== suite.code),
                                })
                              }
                              className="mt-0.5"
                            />
                            <label
                              htmlFor={`suite-${row.key}-${suite.code}`}
                              className="min-w-0 flex-1 text-sm"
                            >
                              {suite.name}{" "}
                              <span className="text-muted-foreground">({suite.test_count})</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </fieldset>

                    <div className="mt-3 flex items-start gap-3 rounded-[10px] border p-3">
                      <Switch
                        id={`strategy-agent-${row.key}`}
                        checked={row.adaptive_agent}
                        onCheckedChange={(on) => setRow(index, { adaptive_agent: on })}
                      />
                      <Label htmlFor={`strategy-agent-${row.key}`} className="text-sm font-normal">
                        The adaptive testing agent refines the tests of this strategy
                        <span className="block text-xs text-muted-foreground">
                          It stays within the chosen suites, the budget and the rate.
                        </span>
                      </Label>
                    </div>
                  </li>
                ))}
              </ul>
              {errors.strategies && (
                <p id="benchmark-strategies-error" className="text-xs text-destructive">
                  {errors.strategies}
                </p>
              )}
              {rows.length < LETTERS.length && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows((current) => [
                      ...current,
                      {
                        key: LETTERS[current.length],
                        name: `Strategy ${LETTERS[current.length]}`,
                        suites: [],
                        adaptive_agent: false,
                      },
                    ])
                  }
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add strategy
                </Button>
              )}
            </Section>

            <Section number={4} id="benchmark-budget-heading" title="Budget and repetitions">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="benchmark-budget"
                  label="Attempt budget per strategy and lab target"
                  error={errors.attempt_budget}
                >
                  <Input
                    id="benchmark-budget"
                    type="number"
                    min={10}
                    max={20000}
                    inputMode="numeric"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                    className="tabular h-9"
                  />
                </FormField>
                <FormField id="benchmark-repetitions" label="Repetitions" error={errors.repetitions}>
                  <Input
                    id="benchmark-repetitions"
                    type="number"
                    min={1}
                    max={20}
                    inputMode="numeric"
                    value={repetitions}
                    onChange={(event) => setRepetitions(event.target.value)}
                    className="tabular h-9"
                  />
                </FormField>
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Every strategy gets the same budget and the same repetitions, so differences come
                from the strategy.
              </p>
            </Section>

            <Section number={5} id="benchmark-detection-heading" title="Detection">
              <div className="flex items-start gap-3 rounded-[10px] border p-3">
                <Switch
                  id="benchmark-judge"
                  checked={judgeEvery}
                  onCheckedChange={setJudgeEvery}
                />
                <Label htmlFor="benchmark-judge" className="text-sm font-normal">
                  The LLM judge evaluates every attempt
                  <span className="block text-xs text-muted-foreground">
                    So the judge on its own can be compared with the combined detection.
                  </span>
                </Label>
              </div>
            </Section>

            {earlier.length > 0 && (
              <Section number={6} id="benchmark-baseline-heading" title="Baseline">
                <ul className="space-y-2">
                  {earlier.slice(0, 5).map((run) => (
                    <li key={run.code} className="flex items-start gap-3">
                      <Checkbox
                        id={`baseline-${run.code}`}
                        checked={baseline === run.code}
                        onCheckedChange={(on) => setBaseline(on ? run.code : null)}
                        className="mt-0.5"
                      />
                      <label htmlFor={`baseline-${run.code}`} className="min-w-0 flex-1 text-sm">
                        Repeat {run.code} as a baseline
                        <span className="block text-xs text-muted-foreground">
                          {run.name} · {run.runs_total} campaign runs
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </form>

          <aside
            aria-labelledby="benchmark-summary-heading"
            className="space-y-3 rounded-[10px] border bg-card p-5 lg:sticky lg:top-6"
          >
            <h2 id="benchmark-summary-heading" className="text-[15px] font-semibold">
              Summary
            </h2>
            {!estimate ? (
              <p className="text-sm text-muted-foreground">
                Choose lab targets and give every strategy a suite to see the estimate.
              </p>
            ) : (
              <dl className="space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Campaign runs</dt>
                  <dd className="tabular">
                    {targets.length} lab target{targets.length === 1 ? "" : "s"} × {rows.length}{" "}
                    strategies × {repetitions} repetitions = {estimate.runs}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Attempts</dt>
                  <dd className="tabular">{estimate.attempts.toLocaleString("en-GB")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Time</dt>
                  <dd>{duration(estimate.minutes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">LLM cost</dt>
                  <dd className="tabular">
                    {costRange(estimate.llm_cost_low_usd, estimate.llm_cost_high_usd)}
                  </dd>
                </div>
              </dl>
            )}

            {estimate?.warnings.length ? (
              <Alert variant="destructive" role="alert">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>
                  <ul className="space-y-1">
                    {estimate.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : estimate ? (
              <p className="text-sm text-success">Within this month&apos;s limits.</p>
            ) : null}

            <p className="border-t pt-3 text-xs text-muted-foreground">
              The configuration and the versions of the suites, the tests and the models are fixed
              when the run starts.
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" disabled={!!pending || !complete} onClick={() => void submit("start")}>
                {pending === "start" ? "Starting…" : "Save and start"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!!pending || !complete}
                onClick={() => void submit("draft")}
              >
                {pending === "draft" ? "Saving…" : "Save draft"}
              </Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
