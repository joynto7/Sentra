"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Ban, Circle, CircleCheck, Clock } from "lucide-react"

import { type JourneyTask, buildPlatformJourney } from "@/components/hub/journey"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { llmConfiguration } from "@/lib/llm-providers"
import { systemHealth } from "@/lib/system-health"
import { usageOverview } from "@/lib/usage-limits"
import { cn } from "@/lib/utils"

const ICON = { ready: ArrowRight, blocked: Ban, waiting: Clock, optional: Circle, done: CircleCheck }
const WORD = { ready: "Ready for you", blocked: "Blocked", waiting: "Waiting", optional: "Optional", done: "Done" }
const TONE = { ready: "text-link", blocked: "text-destructive", waiting: "text-warning", optional: "text-muted-foreground", done: "text-success" }

/**
 * The Platform Administrator's first steps: the health of the services, the LLM providers and the
 * organizations at a limit, from the platform's own pages' data. It is a separate shell from any
 * organization's setup and shows no organization's content, only usage against limits.
 */
export function PlatformSteps() {
  const [tasks, setTasks] = useState<JourneyTask[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    void (async () => {
      const [health, providers, usage] = await Promise.allSettled([systemHealth(), llmConfiguration(), usageOverview()])
      if (!current) return
      setTasks(
        buildPlatformJourney({
          health: health.status === "fulfilled" ? { status: health.value.status, openAlerts: health.value.open_alerts.length } : null,
          providers: providers.status === "fulfilled" ? { total: providers.value.providers.length, untested: providers.value.providers.filter((p) => p.tested_at === null).map((p) => p.name) } : null,
          organizationsAtLimit: usage.status === "fulfilled" ? usage.value.organizations.filter((o) => o.limits.some((l) => l.reached)).length : null,
        }),
      )
      setFailed([health, providers, usage].some((r) => r.status !== "fulfilled"))
    })()
    return () => {
      current = false
    }
  }, [attempt])

  return (
    <section aria-labelledby="platform-steps" className="rounded-[10px] border bg-card">
      <div className="px-4 py-3">
        <h2 id="platform-steps" className="text-[15px] font-semibold">
          Platform next steps
        </h2>
      </div>
      {failed && (
        <Alert className="mx-4 mb-3 w-auto" role="status">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            Something could not be read, so it is left out rather than shown as fine.
            <Button variant="outline" size="sm" className="h-7" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!tasks ? (
        <div className="px-4 pb-4">
          <Skeleton className="h-16 w-full" role="status" aria-label="Loading the platform steps" />
        </div>
      ) : (
        <ul className="border-t">
          {tasks.map((task) => {
            const Icon = ICON[task.state]
            return (
              <li key={task.id} className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between" data-state={task.state}>
                <div className="flex min-w-0 items-start gap-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[task.state])} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {task.title}
                      <span className={cn("ml-2 text-xs font-normal", TONE[task.state])}>{WORD[task.state]}</span>
                    </p>
                    <p className="text-[13px] text-text-secondary">{task.detail}</p>
                  </div>
                </div>
                {task.href && task.action && (
                  <Button asChild variant={task.state === "ready" ? "default" : "outline"} size="sm" className="h-8 shrink-0 self-start">
                    <Link href={task.href}>{task.action}</Link>
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
