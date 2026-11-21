"use client"

import { useState } from "react"
import Link from "next/link"
import { Bot, Bug, CircleAlert, CircleCheck, CircleX, Info, Send } from "lucide-react"

import { SeverityBadge, type Severity } from "@/components/sentra/severity-badge"
import type { EventKind, LiveEvent } from "@/components/campaigns/use-run-events"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const FILTERS = [
  { id: "all", label: "All" },
  { id: "findings", label: "Findings" },
  { id: "attempts", label: "Attempts" },
  { id: "refinements", label: "Refinements" },
  { id: "warnings", label: "Warnings" },
] as const
type Filter = (typeof FILTERS)[number]["id"]

/** A refinement is shown as a row of its own, beside the attempt it followed. */
type RowKind = EventKind | "refinement"

const IN_FILTER: Record<Filter, RowKind[]> = {
  all: ["status", "plan", "attempt", "detection", "refinement", "warning", "finding", "finding_severity", "ended"],
  findings: ["finding", "finding_severity"],
  attempts: ["attempt", "detection"],
  refinements: ["refinement"],
  warnings: ["warning"],
}

/** What the adaptive testing agent did with an attempt, as the engine publishes it with the attempt. */
type AgentOutput = { refined?: boolean; attempt_no?: number; reason?: string; discarded?: number; stopped?: string }

function agentOf(event: LiveEvent): AgentOutput | null {
  if (event.kind !== "attempt") return null
  const results = (event.data.results ?? {}) as Record<string, unknown>
  const found = results.agent
  return found && typeof found === "object" ? (found as AgentOutput) : null
}

/** How many events carry something the agent did: the monitor reads the agent's trail again when it changes. */
export function agentEventCount(events: LiveEvent[]): number {
  return events.reduce((count, event) => count + (agentOf(event) ? 1 : 0), 0)
}

const METHOD_LABEL: Record<string, string> = {
  canary_token: "Canary token",
  rule_matching: "Rule matching",
  tool_call_inspection: "Tool-call inspection",
  llm_judge: "LLM judge",
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

/** "Met (Canary token ✓, LLM judge ✓)" — what the detection of an attempt found (UC-6.1). */
function verdictText(detection: Record<string, unknown> | undefined): string {
  if (!detection) return ""
  const methods = (detection.methods ?? {}) as Record<string, string>
  const found = Object.entries(methods)
    .map(
      ([method, outcome]) =>
        `${METHOD_LABEL[method] ?? method} ${outcome === "met" ? "✓" : outcome === "not_met" ? "✗" : "…"}`,
    )
    .join(", ")
  const verdict =
    detection.verdict === "met"
      ? "Met"
      : detection.verdict === "not_met"
        ? "Not met"
        : detection.verdict === "pending"
          ? "Waiting for the LLM judge"
          : "Not evaluated"
  return found ? `${verdict} (${found})` : verdict
}

function Row({
  icon,
  time,
  children,
  highlight,
}: {
  icon: React.ReactNode
  time: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <li className={cn("flex gap-3 px-3 py-2 text-sm", highlight && "bg-primary/5")}>
      <span className="tabular mt-0.5 shrink-0 text-xs text-muted-foreground">{time}</span>
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

/** The agent's part in an attempt: a refinement added, proposals it had to discard, or its stop. */
function RefinementRow({ output, at }: { output: AgentOutput; at: string }) {
  const discarded = output.discarded ?? 0
  const discardedText =
    discarded > 0
      ? ` · ${discarded} ${discarded === 1 ? "proposal" : "proposals"} discarded as outside the approved scope`
      : ""
  const icon = <Bot className="size-3.5" aria-hidden="true" />

  if (output.stopped) {
    return (
      <Row icon={icon} time={at}>
        <span className="font-medium text-warning">Adaptive agent stopped</span>
        <span className="text-text-secondary"> · {output.stopped}</span>
        <span className="text-muted-foreground"> · the run goes on with its planned tests</span>
      </Row>
    )
  }
  if (output.refined) {
    return (
      <Row icon={icon} time={at}>
        <span className="font-medium">Adaptive refinement</span>
        <span className="text-muted-foreground"> · attempt #{String(output.attempt_no)} added</span>
        {output.reason && <span className="text-text-secondary"> · reason “{output.reason}”</span>}
        <span className="text-muted-foreground">
          {" "}
          · <CircleCheck className="inline size-3.5 text-success" aria-hidden="true" /> within scope
          {discardedText}
        </span>
      </Row>
    )
  }
  return (
    <Row icon={icon} time={at}>
      <span className="font-medium">Adaptive agent</span>
      <span className="text-text-secondary"> · nothing could be added after this attempt{discardedText}</span>
    </Row>
  )
}

/** One live event, in the words of UC-5.6 step 3. */
function EventRow({ event }: { event: LiveEvent }) {
  const data = event.data
  const at = clock(event.at)

  if (event.kind === "attempt" || event.kind === "detection") {
    const results = (data.results ?? {}) as Record<string, Record<string, unknown>>
    const detection = event.kind === "detection" ? data : results.detection
    const failed = data.status === "failed"
    return (
      <Row icon={<Send className="size-3.5" aria-hidden="true" />} time={at}>
        <span className="font-medium">Attempt #{String(data.attempt_no)}</span>
        <span className="text-muted-foreground"> · {String(data.test_code)}</span>
        {typeof data.refinement_reason === "string" && data.refinement_reason && (
          <span className="text-muted-foreground"> · written by the adaptive agent</span>
        )}
        {failed ? (
          <span className="text-destructive"> · {String(data.error ?? "No reply")}</span>
        ) : (
          <span className="text-text-secondary"> · {verdictText(detection as Record<string, unknown>)}</span>
        )}
        {event.kind === "detection" && <span className="text-muted-foreground"> (the LLM judge answered)</span>}
      </Row>
    )
  }

  if (event.kind === "finding") {
    const isNew = data.new === true
    return (
      <Row icon={<Bug className="size-3.5" aria-hidden="true" />} time={at} highlight={isNew}>
        <span className="font-medium">
          Finding {String(data.code)} {isNew ? "recorded" : "seen again"}
        </span>{" "}
        <SeverityBadge severity={data.severity as Severity} />{" "}
        <span className="text-muted-foreground">{String(data.category)}</span>{" "}
        <span className="text-text-secondary">{String(data.title)}</span>
        <Button asChild variant="ghost" size="sm" className="ml-1 h-6 px-1.5">
          <Link href={`/findings/${String(data.code)}`}>Open</Link>
        </Button>
      </Row>
    )
  }

  if (event.kind === "finding_severity") {
    return (
      <Row icon={<Bug className="size-3.5" aria-hidden="true" />} time={at}>
        <span className="font-medium">Finding {String(data.code)} rated</span>{" "}
        <SeverityBadge severity={data.severity as Severity} />
        <span className="text-muted-foreground">
          {" "}
          · impact {String(data.impact)}, likelihood {String(data.likelihood)}
          {data.provisional ? " · provisional until the repetitions are complete" : ""}
        </span>
      </Row>
    )
  }

  if (event.kind === "warning") {
    return (
      <Row icon={<CircleAlert className="size-3.5 text-warning" aria-hidden="true" />} time={at}>
        <span className="text-warning">{String(data.message)}</span>
      </Row>
    )
  }

  if (event.kind === "plan") {
    return (
      <Row icon={<Info className="size-3.5" aria-hidden="true" />} time={at}>
        Plan ready: {String(data.planned)} of {String(data.tests)} tests, {String(data.attempts)} attempts
        {Number(data.skipped) > 0 ? ` (${String(data.skipped)} skipped)` : ""}
      </Row>
    )
  }

  const ended = event.kind === "ended"
  return (
    <Row
      icon={
        ended ? (
          <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
        ) : (
          <Info className="size-3.5" aria-hidden="true" />
        )
      }
      time={clock(event.at)}
    >
      {ended ? <span className="font-medium">Run ended. </span> : null}
      {String(data.status_message ?? data.status ?? "")}
    </Row>
  )
}

/** UC-5.6 step 3: the run's events, newest first, with the filters of Screen 36. */
export function RunEventsFeed({
  events,
  connected,
  reconnected,
  ended,
}: {
  events: LiveEvent[]
  connected: boolean
  reconnected: number | null
  ended: boolean
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const rows = events.flatMap((event) => {
    const output = agentOf(event)
    const own = {
      key: `${event.id}-${event.kind}`,
      kind: event.kind as RowKind,
      event,
      output: null as AgentOutput | null,
    }
    // Newest first: what the agent did comes after the attempt it followed.
    return output ? [{ ...own, key: `${own.key}-agent`, kind: "refinement" as RowKind, output }, own] : [own]
  })
  const shown = rows.filter((row) => IN_FILTER[filter].includes(row.kind))

  return (
    <section aria-labelledby="events-heading" className="rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <h2 id="events-heading" className="flex items-center gap-2 text-[15px] font-semibold">
          Live events
          {!ended && (
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span
                className={cn("size-2 rounded-full", connected ? "animate-pulse bg-success" : "bg-muted-foreground")}
                aria-hidden="true"
              />
              {connected ? "Live" : "Reconnecting…"}
            </span>
          )}
        </h2>
        <div role="group" aria-label="Filter the events" className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <Button
              key={option.id}
              variant={filter === option.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {reconnected !== null && (
        <p className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm" role="status">
          <CircleX className="size-4 text-muted-foreground" aria-hidden="true" />
          Live updates reconnected
          {reconnected > 0 ? ` — ${reconnected} missed ${reconnected === 1 ? "event" : "events"} loaded.` : "."}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {ended
            ? "The live events of this run are kept for a day after it ended."
            : "Nothing has happened yet. Attempts, findings and warnings appear here as they occur."}
        </p>
      ) : (
        <ul className="max-h-[32rem] divide-y overflow-y-auto" aria-live="polite" aria-relevant="additions">
          {shown.map((row) =>
            row.output ? (
              <RefinementRow key={row.key} output={row.output} at={clock(row.event.at)} />
            ) : (
              <EventRow key={row.key} event={row.event} />
            ),
          )}
        </ul>
      )}
    </section>
  )
}
