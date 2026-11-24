"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Ban, ChevronDown, Circle, CircleCheck, Clock } from "lucide-react"

import { type JourneyState, type JourneyTask, summarize } from "@/components/hub/journey"
import { useJourney } from "@/components/hub/use-journey"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ROLE_NAMES, type OrganizationRole } from "@/config/help"
import { cn } from "@/lib/utils"

const SHOWN_FIRST = 3

const LOOK: Record<JourneyState, { icon: typeof Circle; word: string; tone: string }> = {
  ready: { icon: ArrowRight, word: "Ready for you", tone: "text-link" },
  blocked: { icon: Ban, word: "Blocked", tone: "text-destructive" },
  waiting: { icon: Clock, word: "Waiting", tone: "text-warning" },
  optional: { icon: Circle, word: "Optional", tone: "text-muted-foreground" },
  done: { icon: CircleCheck, word: "Done", tone: "text-success" },
}

const storeKey = (userId: string, organizationId: string) => `sentra.first-steps.v1:${userId}:${organizationId}`
function readChoice(key: string): boolean | null {
  try {
    const found = window.localStorage.getItem(key)
    return found === "open" ? true : found === "closed" ? false : null
  } catch {
    return null
  }
}
function writeChoice(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? "open" : "closed")
  } catch {
    // Not kept in this browser: the panel still opens and closes
  }
}

function Row({ task }: { task: JourneyTask }) {
  const look = LOOK[task.state]
  const Icon = look.icon
  return (
    <li className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-state={task.state}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", look.tone)} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {task.title}
            <span className={cn("ml-2 text-xs font-normal", look.tone)}>
              {look.word}
              {task.who && (task.state === "waiting" || task.state === "blocked") ? `: ${task.who}` : ""}
            </span>
          </p>
          <p className="text-[13px] text-text-secondary">{task.detail}</p>
        </div>
      </div>
      {task.href && task.action && task.state !== "done" && (
        <Button asChild variant={task.state === "ready" ? "default" : "outline"} size="sm" className="h-8 shrink-0 self-start">
          <Link href={task.href}>{task.action}</Link>
        </Button>
      )}
      {task.href && task.action && task.state === "done" && (
        <Link href={task.href} className="shrink-0 self-start text-[13px] font-medium text-link hover:underline">
          {task.action}
        </Link>
      )}
    </li>
  )
}

function Panel() {
  const session = useSession()
  const organization = session.organization
  const { tasks, failed, partial, announce, retry } = useJourney()
  const key = storeKey(session.id, organization?.id ?? "")
  // The person's own choice to hide or show the panel, kept in this browser only; never a step done
  const [chosen, setChosen] = useState<boolean | null>(() => (typeof window === "undefined" ? null : readChoice(key)))
  const [more, setMore] = useState(false)
  const role = (organization?.role ? ROLE_NAMES[organization.role as OrganizationRole] : undefined) ?? ""

  if (!tasks) {
    return failed ? (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          The first steps could not be loaded.
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <Skeleton className="h-16 w-full" role="status" aria-label="Loading the first steps" />
    )
  }

  const summary = summarize(tasks)
  const open = chosen ?? !summary.quiet
  const active = tasks.filter((task) => task.state === "ready" || task.state === "blocked" || task.state === "waiting")
  const shown = active.slice(0, SHOWN_FIRST)
  const rest = [...active.slice(SHOWN_FIRST), ...tasks.filter((task) => !active.includes(task))]
  const waiting = tasks.some((task) => task.state === "waiting" || task.state === "blocked")
  const headline = summary.ready > 0 ? `${summary.ready} ${summary.ready === 1 ? "step needs" : "steps need"} you` : waiting ? "Waiting on others" : "Setup complete"

  function toggle() {
    setChosen(!open)
    writeChoice(key, !open)
  }

  return (
    <section aria-labelledby="first-steps-heading" className="rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
        <div className="min-w-0">
          <h2 id="first-steps-heading" className="text-[15px] font-semibold">
            First steps
            <span className={cn("ml-2 text-[13px] font-normal", summary.ready > 0 ? "text-link" : "text-muted-foreground")}>{headline}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            In {organization?.name}, as {role || "a member"}
            {summary.total > 0 ? ` · ${summary.done} of ${summary.total} of your setup steps done` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="h-8">
            <Link href="/getting-started">All steps</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" aria-expanded={open} aria-controls="first-steps-body" onClick={toggle}>
            {open ? "Hide" : "Show"}
            <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {summary.total > 0 && (
        <div
          role="progressbar"
          aria-label="Setup steps done"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.done}
          aria-valuetext={`${summary.done} of ${summary.total} steps done`}
          className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(summary.done / summary.total) * 100}%` }} />
        </div>
      )}

      <div id="first-steps-body" hidden={!open}>
        {failed && (
          <p className="mx-4 mb-2 flex flex-wrap items-center gap-3 text-xs text-warning" role="status">
            These steps could not be refreshed and may be out of date.
            <Button variant="outline" size="sm" className="h-7" onClick={retry}>
              Try again
            </Button>
          </p>
        )}
        {partial && !failed && (
          <p className="mx-4 mb-2 text-xs text-muted-foreground" role="status">Waiting approvals could not be read.</p>
        )}
        {shown.length > 0 ? (
          <ul className="border-t">
            {shown.map((task) => (
              <Row key={task.id} task={task} />
            ))}
          </ul>
        ) : (
          <p className="border-t px-4 py-3 text-[13px] text-text-secondary">Nothing is open in the setup of {organization?.name}. Your work is listed under Needs your attention.</p>
        )}
        {rest.length > 0 && (
          <div className="border-t px-4 py-2">
            <button
              type="button"
              aria-expanded={more}
              aria-controls="first-steps-more"
              onClick={() => setMore((now) => !now)}
              className="rounded text-[13px] font-medium text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {more ? "Show fewer" : `Show ${rest.length} more: optional and finished steps`}
            </button>
            <ul id="first-steps-more" hidden={!more} className="mt-2">
              {rest.map((task) => (
                <Row key={task.id} task={task} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </section>
  )
}

/**
 * The dashboard's first-steps panel (Phase 04): a compact, role-aware list of the setup steps this
 * person has or waits for, from the server's state. Keyed by the organization, so switching
 * organization starts from nothing and shows only the new one's steps.
 */
export function FirstSteps() {
  const session = useSession()
  if (!session.organization) return null
  return <Panel key={session.organization.id} />
}
