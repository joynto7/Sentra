"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  CircleAlert,
  Hourglass,
  OctagonX,
  Rocket,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useCountUp } from "@/hooks/use-count-up"
import { ApiError } from "@/lib/api"
import {
  ACTIVE,
  type Autopilot,
  STAGES,
  STATUS_LABEL,
  type Step,
  getAutopilot,
  refreshAutopilot,
  stopAutopilot,
  waitingLink,
} from "@/lib/autopilot"
import { formatCount } from "@/lib/campaigns"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const POLL_MS = 4000
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"]
const SEVERITY_BAR: Record<string, string> = {
  critical: "bg-destructive",
  high: "bg-[#c2410c]",
  medium: "bg-warning",
  low: "bg-primary",
  info: "bg-muted-foreground",
}

type StageState = "done" | "current" | "waiting" | "problem" | "later"

/** Where each stage stands, from the stage the autopilot is in and how it ended. */
function stateOf(index: number, run: Autopilot): StageState {
  const current = run.stage === "done" ? STAGES.length : STAGES.findIndex((s) => s.stage === run.stage)
  if (index < current) return "done"
  if (index > current) return "later"
  if (run.status === "waiting") return "waiting"
  if (run.status === "failed" || run.status === "stopped") return "problem"
  return run.status === "completed" ? "done" : "current"
}

const STATE_WORD: Record<StageState, string> = {
  done: "Done",
  current: "In progress",
  waiting: "Waiting for you",
  problem: "Stopped here",
  later: "Not yet",
}

const STATE_WORD_TONE: Record<StageState, string> = {
  done: "text-success",
  current: "text-primary",
  waiting: "text-warning",
  problem: "text-destructive",
  later: "text-muted-foreground",
}

/** The last thing the autopilot said while it was in a stage: the outcome shown under a finished one. */
function outcomeOf(steps: Step[], stage: string): string | null {
  const said = steps.filter((step) => step.stage === stage)
  return said.length ? said[said.length - 1].text : null
}

function elapsed(from: string, to: string | null, now: number): string {
  const seconds = Math.max(0, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** The circle of one stage: what it is, in a shape and a movement, besides the word beside it. */
function Node({ state, index }: { state: StageState; index: number }) {
  const base = "relative z-10 grid size-9 shrink-0 place-items-center rounded-full border-2 bg-card"
  if (state === "done") {
    return (
      <span className={cn(base, "ap-pop border-success bg-success text-white")} style={{ "--i": index } as React.CSSProperties}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path className="ap-draw" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    )
  }
  if (state === "current") {
    return (
      <span className={cn(base, "border-primary text-primary")}>
        <span className="ap-ping absolute inset-0 rounded-full border-2 border-primary" aria-hidden="true" />
        <span className="size-3 rounded-full bg-primary ap-live" aria-hidden="true" />
      </span>
    )
  }
  if (state === "waiting") {
    return (
      <span className={cn(base, "ap-glow border-warning text-warning")}>
        <Hourglass className="ap-swing size-4" aria-hidden="true" />
      </span>
    )
  }
  if (state === "problem") {
    return (
      <span className={cn(base, "ap-shake border-destructive text-destructive")}>
        <OctagonX className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className={cn(base, "border-border text-muted-foreground")}>
      <Square className="size-3.5" aria-hidden="true" />
    </span>
  )
}

function Dots() {
  return (
    <span className="ml-1 inline-flex gap-0.5 align-middle" aria-hidden="true">
      {[0, 1, 2].map((d) => (
        <span key={d} className="ap-dot size-1 rounded-full bg-current" style={{ "--d": d } as React.CSSProperties} />
      ))}
    </span>
  )
}

/** A bar that glides to its width, and is crossed by light while the work goes on. */
function Bar({ value, max, moving, tone = "bg-primary", label }: { value: number; max: number; moving?: boolean; tone?: string; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-2.5 overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("ap-fill h-full rounded-full", tone, moving && percent < 100 && "ap-shimmer")} style={{ width: `${percent}%` }} />
    </div>
  )
}

function Counter({ value, label }: { value: number; label: string }) {
  const shown = useCountUp(value)
  return (
    <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
      <p className="tabular text-xl font-semibold leading-none">{formatCount(shown)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/** What the stage that is working shows underneath: the live numbers the server keeps. */
function Detail({ run }: { run: Autopilot }) {
  const p = run.progress
  if (run.stage === "check" && run.status === "running") {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Sentra is sending a few harmless requests to learn what the target is and what it can do
        <Dots />
      </p>
    )
  }
  if (run.stage === "threat_model" && run.status === "running") {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Sentra&apos;s LLM is reading the target&apos;s profile and suggesting threats
        <Dots />
      </p>
    )
  }
  if (run.stage === "run") {
    const sent = p.attempts_sent
    const total = p.attempts_planned || p.attempt_budget
    return (
      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              Attempts sent{p.run_status ? ` · run ${p.run_status}` : ""}
            </span>
            <span className="tabular font-medium">
              {formatCount(sent)} of {formatCount(total)}
            </span>
          </div>
          <Bar value={sent} max={total} moving={run.status === "running" && p.run_status === "running"} label="Attempts sent" />
        </div>
        {p.findings > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Counter value={p.findings} label={p.findings === 1 ? "finding so far" : "findings so far"} />
            {SEVERITY_ORDER.filter((s) => p.by_severity[s]).slice(0, 3).map((s) => (
              <Counter key={s} value={p.by_severity[s]} label={s} />
            ))}
          </div>
        )}
      </div>
    )
  }
  if (run.stage === "remediation" && run.status === "running") {
    return (
      <div className="mt-3 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Proposals drafted</span>
          <span className="tabular font-medium">
            {p.proposals} of {p.proposals_total}
          </span>
        </div>
        <Bar value={p.proposals} max={p.proposals_total} moving label="Proposals drafted" />
      </div>
    )
  }
  return null
}

function Result({ run }: { run: Autopilot }) {
  const summary = run.summary
  const findings = useCountUp(summary?.findings ?? 0, 900)
  const proposals = useCountUp(summary?.proposals ?? 0, 900)
  if (!summary) return null
  const top = Math.max(1, ...Object.values(summary.by_severity))
  return (
    <section aria-labelledby="result-heading" className="ap-rise overflow-hidden rounded-2xl border border-success/30 bg-card">
      <div className="flex items-center gap-3 border-b border-success/20 bg-success/5 px-5 py-4">
        <span className="ap-pop grid size-10 place-items-center rounded-full bg-success text-white">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path className="ap-draw" d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div>
          <h2 id="result-heading" className="text-base font-semibold">
            The assessment is finished
          </h2>
          <p className="text-sm text-muted-foreground">Nothing is applied yet. You approve every fix.</p>
        </div>
      </div>
      <div className="grid gap-6 p-5 md:grid-cols-[auto_1fr]">
        <div className="flex gap-6">
          <div>
            <p className="tabular text-4xl font-semibold leading-none">{formatCount(findings)}</p>
            <p className="mt-1 text-sm text-muted-foreground">open {summary.findings === 1 ? "finding" : "findings"}</p>
          </div>
          <div>
            <p className="tabular text-4xl font-semibold leading-none">{formatCount(proposals)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{summary.proposals === 1 ? "proposal" : "proposals"} drafted</p>
          </div>
        </div>
        {summary.findings > 0 && (
          <ul className="space-y-2" aria-label="Findings by severity">
            {SEVERITY_ORDER.filter((s) => summary.by_severity[s]).map((s) => (
              <li key={s} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-3 text-sm">
                <span className="capitalize">{s}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("ap-fill h-full rounded-full", SEVERITY_BAR[s])}
                    style={{ width: `${Math.round((summary.by_severity[s] / top) * 100)}%` }}
                  />
                </div>
                <span className="tabular text-right font-medium">{summary.by_severity[s]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
        <Button asChild className="ap-nudge h-9">
          <Link href="/findings">
            Review the findings
            <ArrowRight className="ap-arrow" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-9">
          <Link href="/remediation">
            <Wrench aria-hidden="true" />
            Review the remediation proposals
          </Link>
        </Button>
        {run.campaign_code && run.run_number && (
          <Button asChild variant="ghost" className="h-9">
            <Link href={`/campaigns/${run.campaign_code}/runs/${run.run_number}`}>
              <Rocket aria-hidden="true" />
              Open the run
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}

/**
 * One assessment of the autopilot: a hero that says where it is, the stages as a timeline that fills
 * as each one finishes, the live numbers of the stage that is working, what it waits for from a
 * person, and the story so far. While it is on, the page asks the server to take the next step every
 * few seconds (the clock does it every minute when nobody is looking). Movement only helps: every
 * state is also written in words, and all of it stops for someone who asks for reduced motion.
 */
export function AutopilotView({ id }: { id: string }) {
  const [run, setRun] = useState<Autopilot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [seen, setSeen] = useState<number | null>(null)
  const stopButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    getAutopilot(id, controller.signal)
      .then((first) => {
        setRun(first)
        setSeen(first.steps.length)
      })
      .catch((reason) => {
        if (controller.signal.aborted) return
        setError(reason instanceof ApiError ? reason.message : "Sentra could not be reached.")
      })
    return () => controller.abort()
  }, [id])

  const active = run ? ACTIVE.includes(run.status) : false
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const poll = setInterval(() => {
      refreshAutopilot(id, controller.signal)
        .then((next) => {
          setRun(next)
          setError(null)
        })
        .catch((reason) => {
          if (controller.signal.aborted) return
          setError(reason instanceof ApiError ? reason.message : "Sentra could not be reached.")
        })
    }, POLL_MS)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(clock)
      controller.abort()
    }
  }, [active, id])

  async function stop() {
    setStopping(true)
    try {
      setRun(await stopAutopilot(id))
      toast.success("The autopilot was stopped")
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Something went wrong. Try again.")
    } finally {
      setStopping(false)
      setConfirm(false)
    }
  }

  if (!run) {
    return error ? (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    )
  }

  const link = run.status === "waiting" ? waitingLink(run) : null
  const stageIndex = run.stage === "done" ? STAGES.length : Math.max(0, STAGES.findIndex((s) => s.stage === run.stage))
  const doneStages = run.status === "completed" ? STAGES.length : stageIndex
  const percent = Math.round((doneStages / STAGES.length) * 100)
  const tone =
    run.status === "completed"
      ? { chip: "border-success/40 bg-success/10 text-success", dot: "bg-success" }
      : run.status === "waiting"
        ? { chip: "border-warning/50 bg-warning/10 text-warning", dot: "bg-warning" }
        : run.status === "failed" || run.status === "stopped"
          ? { chip: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" }
          : { chip: "border-primary/40 bg-primary/10 text-primary", dot: "bg-primary" }

  return (
    <div className="space-y-6">
      <section aria-labelledby="hero-heading" className="ap-rise overflow-hidden rounded-2xl border border-border bg-card">
        <div className="bg-[linear-gradient(160deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_60%)] p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium", tone.chip)}>
                <span className={cn("size-2 rounded-full", tone.dot, run.status === "running" && "ap-live")} aria-hidden="true" />
                {STATUS_LABEL[run.status]}
              </span>
              <h2 id="hero-heading" className="mt-3 text-xl font-semibold tracking-tight">
                {run.code} · {run.target_name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Started {formatDateTime(run.created_at)}
                {run.started_by ? ` by ${run.started_by}` : ""} ·{" "}
                {active ? "running for " : "took "}
                <span className="tabular">{elapsed(run.created_at, run.finished_at, now)}</span>
              </p>
            </div>
            {run.can_stop && (
              <Button ref={stopButton} variant="outline" className="h-9 shrink-0" onClick={() => setConfirm(true)}>
                Stop the autopilot
              </Button>
            )}
          </div>

          <div className="mt-5" aria-live="polite">
            <p className="text-sm font-medium">
              {run.message}
              {run.status === "running" && <Dots />}
            </p>
            <div
              className="mt-3 grid grid-cols-5 gap-1.5"
              role="progressbar"
              aria-label="Assessment progress"
              aria-valuemin={0}
              aria-valuemax={STAGES.length}
              aria-valuenow={doneStages}
              aria-valuetext={`${doneStages} of ${STAGES.length} stages done`}
            >
              {STAGES.map((stage, index) => {
                const state = stateOf(index, run)
                return (
                  <span key={stage.stage} className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "ap-seg block h-full origin-left rounded-full",
                        state === "done" && "bg-success",
                        state === "current" && "bg-primary ap-shimmer",
                        state === "waiting" && "bg-warning",
                        state === "problem" && "bg-destructive",
                        state === "later" && "scale-x-0",
                      )}
                      style={state === "current" || state === "waiting" || state === "problem" ? { transform: "scaleX(0.55)" } : undefined}
                    />
                  </span>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground tabular">
              {percent}% · {doneStages} of {STAGES.length} stages done
            </p>
          </div>
        </div>
      </section>

      {link && (
        <section aria-labelledby="needs-heading" className="ap-rise ap-glow flex flex-wrap items-center gap-4 rounded-2xl border border-warning/50 bg-warning/5 p-5" style={{ "--i": 1 } as React.CSSProperties}>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
            <Hourglass className="ap-swing size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="needs-heading" className="text-base font-semibold">
              It is your turn
            </h2>
            <p className="text-sm text-muted-foreground">When you have done it, the autopilot goes on by itself.</p>
          </div>
          <Button asChild className="ap-nudge h-10">
            <Link href={link.href}>
              {link.label}
              <ArrowRight className="ap-arrow" aria-hidden="true" />
            </Link>
          </Button>
        </section>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="stages-heading" className="ap-rise" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 id="stages-heading" className="mb-3 text-base font-semibold">
          Stages
        </h2>
        <ol className="space-y-0">
          {STAGES.map((item, index) => {
            const state = stateOf(index, run)
            const last = index === STAGES.length - 1
            const outcome = state === "done" ? outcomeOf(run.steps, item.stage) : null
            return (
              <li key={item.stage} className="relative flex gap-4 pb-6 last:pb-0" aria-current={state === "current" || state === "waiting" ? "step" : undefined}>
                {!last && (
                  <span
                    aria-hidden="true"
                    className={cn("absolute left-[17px] top-9 bottom-0 w-0.5 rounded-full", state === "done" ? "ap-grow bg-success" : "bg-border")}
                    style={{ "--i": index } as React.CSSProperties}
                  />
                )}
                <Node state={state} index={index} />
                <div
                  className={cn(
                    "min-w-0 flex-1 rounded-xl border px-4 py-3 transition-colors",
                    state === "current" && "border-primary/40 bg-primary/5",
                    state === "waiting" && "border-warning/50 bg-warning/5",
                    state === "problem" && "border-destructive/40 bg-destructive/5",
                    (state === "done" || state === "later") && "border-border bg-card",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{item.label}</p>
                    <span className={cn("text-xs font-medium", STATE_WORD_TONE[state])}>{STATE_WORD[state]}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{outcome ?? item.what}</p>
                  {(state === "current" || state === "waiting") && <Detail run={run} />}
                  {state === "done" && item.stage === "run" && run.campaign_code && run.run_number && (
                    <Link
                      className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline"
                      href={`/campaigns/${run.campaign_code}/runs/${run.run_number}`}
                    >
                      Open run {run.campaign_code}-{run.run_number}
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <Result run={run} />

      <section aria-labelledby="story-heading">
        <h2 id="story-heading" className="mb-2 flex items-center gap-2 text-base font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          What happened
        </h2>
        <ol className="space-y-1.5 text-sm">
          {run.steps.map((step, index) => {
            const fresh = seen !== null && index >= seen
            return (
              <li
                key={`${step.at}-${index}`}
                className={cn("flex gap-3 rounded-md px-2 py-1", fresh && "ap-rise bg-primary/5")}
              >
                <time dateTime={step.at} className="w-36 shrink-0 text-muted-foreground tabular">
                  {formatDateTime(step.at)}
                </time>
                <span>{step.text}</span>
              </li>
            )
          })}
        </ol>
      </section>

      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          setConfirm(open)
          if (!open) requestAnimationFrame(() => stopButton.current?.focus())
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop the autopilot?</DialogTitle>
            <DialogDescription>
              Nothing more is sent to {run.target_name}: a run that is going on is stopped too. What it has found so
              far is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep it going</Button>
            </DialogClose>
            <Button variant="destructive" onClick={stop} disabled={stopping}>
              {stopping ? "Stopping…" : "Stop the autopilot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
