"use client"

import { useEffect, useRef, useState } from "react"
import { Info, Loader2 } from "lucide-react"

import {
  HEALTH_WORD,
  HealthDot,
  Location,
  ProviderAvatar,
  TASK_INFO,
  TASK_ORDER,
  healthOf,
} from "@/components/platform/llm-ui"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type Assignment, type Provider, type ProviderModel, duration } from "@/lib/llm-providers"
import { cn } from "@/lib/utils"

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

function TaskCard({
  row,
  options,
  providers,
  busy,
  index,
  onAssign,
}: {
  row: Assignment
  options: { model: ProviderModel; provider: Provider }[]
  providers: Provider[]
  busy: boolean
  index: number
  onAssign: (modelId: string) => void
}) {
  const info = TASK_INFO[row.task]
  const Icon = info?.icon
  const provider = providers.find((p) => p.name === row.provider)
  const health = healthOf(provider)
  const assigned = !!row.model_id

  // A card lights up for a moment when its model has just changed, so the change is seen.
  const [lit, setLit] = useState(false)
  const last = useRef(row.model_id)
  useEffect(() => {
    if (last.current === row.model_id) return
    last.current = row.model_id
    const on = requestAnimationFrame(() => setLit(true))
    const off = setTimeout(() => setLit(false), 1100)
    return () => {
      cancelAnimationFrame(on)
      clearTimeout(off)
    }
  }, [row.model_id])

  return (
    <section
      aria-label={row.function}
      className={cn(
        "llm-card ap-rise relative flex flex-col gap-4 rounded-2xl border bg-card p-5",
        assigned ? "border-border" : "border-dashed border-border-strong",
        lit && "llm-lit",
      )}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            assigned ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {Icon && <Icon className="size-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{row.function}</h3>
          {info && <p className="mt-1 text-sm text-muted-foreground">{info.summary}</p>}
        </div>
        {row.deployment && <Location deployment={row.deployment} />}
      </div>

      <div className="space-y-1.5">
        <Select value={row.model_id ?? ""} disabled={!options.length || busy} onValueChange={onAssign}>
          <SelectTrigger className="h-10 w-full" aria-label={`Model for ${row.function}`}>
            <SelectValue placeholder={options.length ? "Choose a model" : "No provider configured"} />
          </SelectTrigger>
          <SelectContent>
            {options.map(({ model, provider: owner }) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label} ({owner.name})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Changing the model
            </span>
          ) : assigned && provider ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <ProviderAvatar name={provider.name} kind={provider.kind} size="sm" />
                {provider.name}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <HealthDot health={health} />
                {HEALTH_WORD[health]}
                {health === "working" && provider.test_duration_ms !== null && (
                  <span className="tabular"> · {duration(provider.test_duration_ms)}</span>
                )}
              </span>
              {row.since && <span className="tabular">since {DAY.format(new Date(row.since))}</span>}
            </>
          ) : (
            <span>No model yet. Until one is chosen, Sentra does this without an LLM where it can.</span>
          )}
        </div>
      </div>

      {row.note && (
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {row.note}
        </p>
      )}
    </section>
  )
}

/**
 * Which model does which task of Sentra's own AI: one card per task, with a select over every model
 * that is configured. A change applies to the next request.
 */
export function TaskCards({
  assignments,
  providers,
  onAssign,
  busy,
}: {
  assignments: Assignment[]
  providers: Provider[]
  onAssign: (task: string, modelId: string) => void
  busy: string | null
}) {
  const options = providers.flatMap((provider) => provider.models.map((model) => ({ model, provider })))
  const rank = (task: string) => {
    const at = TASK_ORDER.indexOf(task)
    return at === -1 ? TASK_ORDER.length : at
  }
  const rows = [...assignments].sort((a, b) => rank(a.task) - rank(b.task))
  return (
    <section aria-labelledby="assignment-heading" className="space-y-3">
      <div>
        <h2 id="assignment-heading" className="text-base font-semibold">
          Model assignment
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Which model does which task of Sentra&apos;s own AI. A change applies to the next request.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row, index) => (
          <TaskCard
            key={row.task}
            row={row}
            options={options}
            providers={providers}
            busy={busy === row.task}
            index={index}
            onAssign={(modelId) => onAssign(row.task, modelId)}
          />
        ))}
      </div>
    </section>
  )
}
