"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleAlert, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { AiGeneratedLabel, VersionStatus } from "@/components/threat-models/badges"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type ThreatModelPage,
  generateThreatModel,
  getThreatModel,
  jobActive,
  longDate,
  plural,
} from "@/lib/threat-models"

const POLL_MS = 2000
const FAILED = "The threat model couldn't be loaded."
const NOT_STARTED = "The threat model couldn't be generated."

/** The threat model of one target, inside the "Threat model" card of the target overview
 * (Screen 20): what the newest version says, the way into the review page (Screen 26), and
 * "Generate threat model" for a Security Analyst — the same trigger as on Screens 25 and 26
 * (UC-3.1 trigger 2), so an analyst who is looking at a target doesn't have to go elsewhere. */
export function TargetThreatModel({ targetId }: { targetId: string }) {
  const canManage = useCan("manage_threat_models")
  const [page, setPage] = useState<ThreatModelPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setPage(await getThreatModel(targetId, null, signal))
        setError(null)
      } catch (caught) {
        if (signal?.aborted) return
        setError(caught instanceof ApiError ? caught.message : FAILED)
      }
    },
    [targetId],
  )

  useEffect(() => {
    const controller = new AbortController()
    // The answer is taken in the callback, not in the effect body (react-hooks/set-state-in-effect).
    getThreatModel(targetId, null, controller.signal)
      .then((found) => {
        setPage(found)
        setError(null)
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof ApiError ? caught.message : FAILED)
      })
    return () => controller.abort()
  }, [targetId])

  // Generating runs on a worker (UC-3.1 step 1), so the card follows the job until it is done.
  const active = jobActive(page?.job)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, load])

  async function onGenerate() {
    setStarting(true)
    try {
      const job = await generateThreatModel(targetId)
      if (job.status === "failed") toast.error(job.message ?? NOT_STARTED)
      else toast.success("Generating the threat model. This card updates when it's ready.")
      await load()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : NOT_STARTED)
    } finally {
      setStarting(false)
    }
  }

  if (!page) {
    return error ? (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" className="h-8" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="space-y-2" aria-busy="true" aria-label="Loading the threat model">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-48" />
      </div>
    )
  }

  const latest = page.versions[0] ?? null // the newest version first
  const generate = canManage && !page.blocker && !active && (
    <Button
      size="sm"
      variant={latest ? "outline" : "default"}
      className="h-8 hover:bg-primary-hover"
      onClick={() => void onGenerate()}
      disabled={starting}
    >
      <Sparkles aria-hidden="true" />
      {starting ? "Starting…" : latest ? "Generate again" : "Generate threat model"}
    </Button>
  )

  return (
    <div className="space-y-3">
      {/* aria-live: the job is followed in the background, so its end is announced (NFR-4.1). */}
      <div aria-live="polite" className="space-y-2">
        {active ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
            <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Sentra is working out what could go wrong.
          </p>
        ) : latest ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <VersionStatus version={latest} />
              <span>
                Version {latest.version} · {plural(latest.threat_count, "threat", "threats")}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {latest.status === "approved" && latest.approved_at
                ? `Approved by ${latest.approved_by ?? "a Security Analyst"} on ${longDate(latest.approved_at)}.`
                : "Waiting for a Security Analyst to review it."}
            </p>
            {latest.status === "draft" && latest.ai_generated && <AiGeneratedLabel />}
          </>
        ) : page.blocker ? (
          <p className="text-sm text-muted-foreground">{page.blocker}</p>
        ) : page.job?.status === "failed" ? (
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Generating the threat model didn&apos;t work.
              <span className="block text-xs text-muted-foreground">{page.job.message}</span>
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "No threat model yet. Sentra lists what could go wrong, from the target's profile."
              : "No threat model yet. A Security Analyst generates it."}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {latest && (
          <Link href={`/threat-models/${targetId}`} className="text-sm text-link hover:underline">
            Open the threat model
          </Link>
        )}
        {generate}
      </div>
    </div>
  )
}
