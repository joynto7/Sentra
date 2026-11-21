"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, CircleAlert } from "lucide-react"
import { toast } from "sonner"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { type AgentTrail, formatCount, getRunAgent, stopRunAgent } from "@/lib/campaigns"
import { cn } from "@/lib/utils"

/** What the card says about the agent, in one word, so the state never depends on colour. */
function stateOf(trail: AgentTrail, active: boolean): { label: string; tone: string } {
  if (!trail.enabled) return { label: "Off", tone: "border-border-strong text-muted-foreground" }
  if (trail.stopped_reason) return { label: "Stopped", tone: "border-warning/60 text-warning" }
  if (!active) return { label: "Finished", tone: "border-success/40 text-success" }
  return { label: "On", tone: "border-success/40 text-success" }
}

/**
 * The adaptive testing agent in one run (Screens 36 and 37): whether it is working, how many
 * refinements it added, how many it had to discard, why it stopped if it did, and the one control
 * that stops it. Stopping the agent never stops the run (UC-5.5, 2a1).
 *
 * `refreshKey` changes whenever the live stream shows something the agent did, so the numbers
 * follow the run without polling.
 */
export function AgentCard({
  code,
  number,
  active,
  canStop,
  refreshKey,
  onTrail,
}: {
  code: string
  number: number
  /** The run is queued, running or paused. */
  active: boolean
  canStop: boolean
  refreshKey: number
  /** Gives the page the trail it read, so the summary's tab shows the same numbers. */
  onTrail?: (trail: AgentTrail) => void
}) {
  const [trail, setTrail] = useState<AgentTrail | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const stopButton = useRef<HTMLButtonElement>(null)

  const load = useCallback(
    (signal?: AbortSignal) => {
      getRunAgent(code, number, signal)
        .then((found) => {
          setTrail(found)
          setFailed(false)
          onTrail?.(found)
        })
        .catch((error) => {
          if (signal?.aborted) return
          if (error instanceof ApiError || error instanceof Error) setFailed(true)
        })
    },
    [code, number, onTrail],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load, refreshKey])

  async function stop() {
    setBusy(true)
    try {
      const updated = await stopRunAgent(code, number, reason.trim())
      setTrail(updated)
      onTrail?.(updated)
      setConfirm(false)
      setReason("")
      toast.success("The agent stopped. The run goes on with its planned tests")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "That didn't work. Try again.")
      load()
    } finally {
      setBusy(false)
    }
  }

  const heading = (
    <h2 className="flex items-center gap-2 text-[15px] font-semibold">
      <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
      Adaptive testing agent
    </h2>
  )

  if (!trail) {
    return (
      <section aria-label="Adaptive testing agent" className="min-w-0 space-y-3 rounded-[10px] border bg-card p-5">
        {heading}
        {failed ? (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-sm text-warning">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              What the agent did couldn&apos;t be loaded.
            </p>
            <Button variant="outline" className="h-8" onClick={() => load()}>
              Try again
            </Button>
          </div>
        ) : (
          <div role="status" aria-label="Loading the adaptive testing agent">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-16 w-full" />
          </div>
        )}
      </section>
    )
  }

  const state = stateOf(trail, active)
  const working = trail.enabled && !trail.stopped_reason && active

  return (
    <section aria-label="Adaptive testing agent" className="min-w-0 space-y-3 rounded-[10px] border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        <span
          className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium", state.tone)}
        >
          {working && <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden="true" />}
          {state.label}
        </span>
      </div>

      {!trail.enabled ? (
        <p className="text-sm text-text-secondary">
          The agent is switched off for this campaign, so the run sends its planned tests only.
        </p>
      ) : (
        <>
          {trail.stopped_reason ? (
            <p className="flex items-start gap-2 text-sm text-warning">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {trail.stopped_reason}
                <span className="block text-text-secondary">The run goes on with its planned tests.</span>
              </span>
            </p>
          ) : (
            <p className="text-sm text-text-secondary">
              {working
                ? "It writes follow-up attempts for tests that didn't reach their objective, inside the approved scope, budget and rate, and records why."
                : "It stayed inside the approved scope, budget and rate, and recorded why it wrote each attempt."}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Refinements added</dt>
              <dd className="tabular">{formatCount(trail.sent)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Discarded, out of scope</dt>
              <dd className="tabular">{formatCount(trail.discarded)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Nothing usable</dt>
              <dd className="tabular">{formatCount(trail.refused)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Left to add</dt>
              <dd className="tabular">{working ? formatCount(trail.refinements_left) : "–"}</dd>
            </div>
            <div className="col-span-2 flex justify-between gap-2">
              <dt className="text-muted-foreground">LLM cost of the agent</dt>
              <dd className="tabular">${Number(trail.cost_usd).toFixed(2)}</dd>
            </div>
          </dl>
        </>
      )}

      {canStop && working && (
        <Button
          ref={stopButton}
          variant="outline"
          className="h-9 border-destructive/40 text-destructive hover:bg-destructive/5"
          onClick={() => setConfirm(true)}
        >
          Stop the agent
        </Button>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          className="sm:max-w-[480px]"
          onCloseAutoFocus={(event) => {
            // Back to the button that opened it, so a keyboard user keeps their place.
            event.preventDefault()
            stopButton.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Stop the adaptive testing agent?</DialogTitle>
            <DialogDescription>
              It writes no more attempts in this run. The run itself goes on with its planned tests, and the refinements
              the agent already added are still sent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="agent-stop-reason">Reason (optional)</Label>
            <Input
              id="agent-stop-reason"
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Its follow-ups aren't useful for this target"
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              It is recorded in the audit log and in the agent&apos;s trail.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep it running
              </Button>
            </DialogClose>
            <Button variant="destructive" className="h-9" disabled={busy} onClick={() => void stop()}>
              {busy ? "Stopping…" : "Stop the agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
