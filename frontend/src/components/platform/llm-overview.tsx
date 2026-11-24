"use client"

import { Boxes, Cpu, Network, ShieldAlert, type LucideIcon } from "lucide-react"

import { useCountUp } from "@/hooks/use-count-up"
import type { LLMConfiguration } from "@/lib/llm-providers"

function Stat({
  icon: Icon,
  value,
  of,
  label,
  note,
  index,
}: {
  icon: LucideIcon
  value: number
  of?: number
  label: string
  note?: string
  index: number
}) {
  const shown = useCountUp(value, 800)
  return (
    <div className="ap-rise rounded-2xl border border-border bg-card p-4" style={{ "--i": index } as React.CSSProperties}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {label}
      </div>
      <p className="tabular mt-3 text-3xl font-semibold leading-none">
        {shown}
        {of !== undefined && <span className="ml-1 text-lg font-medium text-muted-foreground">/ {of}</span>}
      </p>
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Four numbers that say how the AI of Sentra is wired at a glance: how many providers and models are
 *  there, how many tasks have a model, and how many of them send data outside the platform. */
export function LlmOverview({ data }: { data: LLMConfiguration }) {
  const models = data.providers.reduce((sum, provider) => sum + provider.models.length, 0)
  const assigned = data.assignments.filter((row) => row.model_id)
  const external = assigned.filter((row) => row.deployment === "external").length
  const local = assigned.filter((row) => row.deployment === "local").length
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="The AI of Sentra at a glance" role="group">
      <Stat icon={Network} value={data.providers.length} label="Providers" index={0} note="Where the models run" />
      <Stat icon={Boxes} value={models} label="Models" index={1} note="Ready to assign" />
      <Stat
        icon={Cpu}
        value={assigned.length}
        of={data.assignments.length}
        label="Tasks with a model"
        index={2}
        note={assigned.length === data.assignments.length ? "Every task is covered" : "The others run without one"}
      />
      <Stat
        icon={ShieldAlert}
        value={external}
        label="Tasks that leave the platform"
        index={3}
        note={`${local} ${local === 1 ? "task stays" : "tasks stay"} on the platform`}
      />
    </div>
  )
}
