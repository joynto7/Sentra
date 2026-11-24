"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Gauge,
  Hourglass,
  ListChecks,
  Repeat,
  Rocket,
  type LucideIcon,
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
import { ACTIVE, type Autopilot, type Plan, getPlan, startAutopilot } from "@/lib/autopilot"
import { formatCount } from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"
import { ENVIRONMENT_LABEL, type TargetListItem, TYPE_LABEL, listTargets } from "@/lib/targets"
import { cn } from "@/lib/utils"

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"

/** One number of the plan, large, that runs up to its value when the plan appears. */
function Tile({
  icon: Icon,
  value,
  unit,
  label,
  index,
}: {
  icon: LucideIcon
  value: number
  unit?: string
  label: string
  index: number
}) {
  const shown = useCountUp(value, 800)
  return (
    <div className="ap-rise rounded-xl border border-border bg-background/60 p-4" style={{ "--i": index } as React.CSSProperties}>
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <p className="tabular mt-2 text-2xl font-semibold leading-none">
        {formatCount(shown)}
        {unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/** One line of the pre-flight list: done, or what a person still has to do. */
function Preflight({ done, children, index }: { done: boolean; children: React.ReactNode; index: number }) {
  return (
    <li className="ap-rise flex items-start gap-2.5 text-sm" style={{ "--i": index } as React.CSSProperties}>
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      )}
      <span>
        <span className="sr-only">{done ? "Ready: " : "Needs you: "}</span>
        {children}
      </span>
    </li>
  )
}

/** A target as a card to pick: what it is, where it runs, and whether an assessment is already on it. */
function TargetCard({
  target,
  selected,
  focusable,
  busy,
  index,
  onSelect,
}: {
  target: TargetListItem
  selected: boolean
  focusable: boolean
  busy: boolean
  index: number
  onSelect: () => void
}) {
  const reviewed = target.profile_status === "reviewed"
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "llm-card ap-rise relative flex flex-col gap-3 rounded-2xl border p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border bg-card hover:border-primary/40",
      )}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{target.name}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{TYPE_LABEL[target.type]}</span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
          )}
        >
          {selected && <Check className="ap-pop size-3.5" />}
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        <span className={cn(CHIP, "border-border text-muted-foreground")}>{ENVIRONMENT_LABEL[target.environment]}</span>
        {target.is_lab && <span className={cn(CHIP, "border-primary/30 bg-primary/10 text-primary")}>Lab target</span>}
        <span className={cn(CHIP, reviewed ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground")}>
          {reviewed ? "Profile reviewed" : "Profile to review"}
        </span>
        {busy && (
          <span className={cn(CHIP, "border-warning/40 bg-warning/10 text-warning")}>
            <span className="ap-live size-1.5 rounded-full bg-warning" aria-hidden="true" />
            Assessment on
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * Start an assessment: pick a verified target from its card, read what the autopilot would do and
 * what a person still decides, then confirm. Starting sends test traffic to the target, so it is
 * never one click.
 */
export function AutopilotStart({ runs }: { runs: Autopilot[] | null }) {
  const router = useRouter()
  const canStart = useCan("manage_campaigns")
  const [targets, setTargets] = useState<TargetListItem[] | null>(null)
  const [targetId, setTargetId] = useState("")
  const [plan, setPlan] = useState<Plan | null>(null)
  const [planFailed, setPlanFailed] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    listTargets(new URLSearchParams({ page_size: "100" }), controller.signal)
      .then((list) => setTargets(list.items.filter((target) => target.status === "verified")))
      .catch(() => setTargets([]))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!targetId) return
    const controller = new AbortController()
    getPlan(targetId, controller.signal)
      .then(setPlan)
      .catch(() => {
        if (!controller.signal.aborted) setPlanFailed(true)
      })
    return () => controller.abort()
  }, [targetId])

  function choose(id: string) {
    if (id === targetId) return
    setPlan(null)
    setPlanFailed(false)
    setTargetId(id)
  }

  async function start() {
    setPending(true)
    setError(null)
    try {
      const run = await startAutopilot(targetId)
      toast.success(`${run.code} started`)
      router.push(`/autopilot/${run.id}`)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Something went wrong. Try again.")
      setConfirm(false)
    } finally {
      setPending(false)
    }
  }

  if (canStart === false) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Only a Security Analyst can start the autopilot. You can read every assessment below.
      </p>
    )
  }

  const target = targets?.find((item) => item.id === targetId)
  const activeTargets = new Set((runs ?? []).filter((run) => ACTIVE.includes(run.status)).map((run) => run.target_id))

  // A group of radio cards: arrow keys move between them, as in a native group of radios.
  function onKeyDown(event: React.KeyboardEvent) {
    if (!targets?.length) return
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const at = Math.max(0, targets.findIndex((item) => item.id === targetId))
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? at + 1 : at - 1
    const chosen = targets[(next + targets.length) % targets.length]
    choose(chosen.id)
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-target="${chosen.id}"] [role="radio"]`)?.focus(),
    )
  }

  return (
    <section aria-labelledby="start-heading" className="ap-rise space-y-5 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 id="start-heading" className="text-base font-semibold">
          Start an assessment
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose the verified target to assess.</p>
      </div>

      {targets === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There is no verified target yet. Register a target and verify that you own it first.
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Verified target"
          onKeyDown={onKeyDown}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {targets.map((item, index) => (
            <div key={item.id} data-target={item.id} className="contents">
              <TargetCard
                target={item}
                selected={item.id === targetId}
                focusable={targetId ? item.id === targetId : index === 0}
                busy={activeTargets.has(item.id)}
                index={index}
                onSelect={() => choose(item.id)}
              />
            </div>
          ))}
        </div>
      )}

      {targetId && !plan && !planFailed && <Skeleton className="h-48 w-full rounded-2xl" />}
      {planFailed && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The plan could not be loaded. Choose the target again.</AlertDescription>
        </Alert>
      )}

      {plan && (
        <div className="space-y-5 border-t border-border pt-5" aria-live="polite">
          <h3 className="text-sm font-semibold">What the autopilot would do on {plan.target_name}</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon={ListChecks} value={plan.tests} label="tests that apply" index={0} />
            <Tile icon={Repeat} value={plan.repetitions} unit="×" label="repetitions of each" index={1} />
            <Tile icon={Gauge} value={plan.attempt_budget} label="attempts, at most" index={2} />
            <Tile icon={Clock} value={plan.estimated_minutes} unit="min" label="about" index={3} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="ap-rise rounded-xl border border-border p-4" style={{ "--i": 4 } as React.CSSProperties}>
              <p className="text-sm font-semibold">Before it starts</p>
              <ul className="mt-3 space-y-2.5">
                <Preflight done index={5}>
                  The target is verified.
                </Preflight>
                <Preflight done={plan.has_reviewed_profile} index={6}>
                  {plan.has_reviewed_profile
                    ? "Its profile is reviewed."
                    : "Sentra maps its profile from a few harmless requests, and you confirm it."}
                </Preflight>
                <Preflight done={plan.has_approved_threat_model} index={7}>
                  {plan.has_approved_threat_model
                    ? "An approved threat model exists and is used."
                    : "Sentra makes a threat model, and you approve it."}
                </Preflight>
                {plan.requires_scope_approval && (
                  <Preflight done={false} index={8}>
                    A Security Manager approves the campaign&apos;s scope.
                  </Preflight>
                )}
              </ul>
            </div>
            <div className="ap-rise rounded-xl border border-border p-4" style={{ "--i": 5 } as React.CSSProperties}>
              <p className="text-sm font-semibold">The limits it keeps</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Request rate, at most</dt>
                  <dd className="tabular font-medium">{plan.request_rate} per minute</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">AI judge cost</dt>
                  <dd className="tabular font-medium">
                    {plan.llm_cost.low_usd ? `$${plan.llm_cost.low_usd}–${plan.llm_cost.high_usd}` : "Not measurable yet"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Every fix</dt>
                  <dd className="font-medium">Waits for your approval</dd>
                </div>
              </dl>
            </div>
          </div>

          {plan.warnings.map((warning) => (
            <p key={warning} className="text-sm text-warning">
              {warning}
            </p>
          ))}
          {plan.reason && (
            <Alert>
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{plan.reason}</AlertDescription>
            </Alert>
          )}
          <Button
            ref={trigger}
            onClick={() => setConfirm(true)}
            disabled={!plan.can_start}
            className="h-11 px-6 text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
          >
            <Rocket aria-hidden="true" />
            Start the autopilot
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          setConfirm(open)
          if (!open) requestAnimationFrame(() => trigger.current?.focus())
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start the autopilot on {target?.name}?</DialogTitle>
            <DialogDescription>
              This sends test traffic to {target?.name}: at most {plan?.request_rate} requests a minute and{" "}
              {plan ? formatCount(plan.attempt_budget) : ""} attempts. Only a verified target is tested. You can stop
              it at any time, and stopping it also stops the run.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={start} disabled={pending}>
              {pending ? "Starting…" : "Start the autopilot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
