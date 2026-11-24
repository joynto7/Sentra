"use client"

import Link from "next/link"
import { CircleCheck, CircleHelp, CircleX, GitPullRequest, Loader2, RotateCcw } from "lucide-react"

import { GLASS_BUTTON, GlassCard } from "@/components/sentra/glass-card"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Gate, type GateRun, VERDICT_LABEL } from "@/lib/gates"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

const ICON = { passed: CircleCheck, failed: CircleX, error: CircleHelp, running: Loader2 } as const
const TONE = {
  passed: "border-success/50 bg-success/10 text-success",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  error: "border-warning/50 bg-warning/10 text-warning",
  running: "border-primary/40 bg-primary/10 text-primary",
} as const

/** The last releases the gate checked, oldest to newest, each a dot with its verdict as a shape and, on hover, in words. */
function History({ runs, gate }: { runs: GateRun[]; gate: Gate }) {
  const shown = [...runs].slice(0, 7).reverse()
  if (shown.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#dbe3fb] px-3 py-2 text-sm text-foreground/65 dark:border-white/15">
        No release checked yet
      </p>
    )
  }
  const last = shown[shown.length - 1]
  const Icon = ICON[last.verdict]
  return (
    <div>
      <ul className="flex items-center gap-1.5" aria-label={`Last ${shown.length} releases checked by ${gate.name}`}>
        {shown.map((run) => {
          const DotIcon = ICON[run.verdict]
          return (
            <li key={run.number}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className={cn(
                      "grid size-7 place-items-center rounded-full border outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
                      TONE[run.verdict],
                    )}
                  >
                    <DotIcon className={cn("size-4", run.verdict === "running" && "animate-spin")} aria-hidden="true" />
                    <span className="sr-only">
                      {VERDICT_LABEL[run.verdict]}: {run.build_ref ?? `${gate.code} #${run.number}`}, {formatDate(run.started_at)}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {VERDICT_LABEL[run.verdict]} · {run.build_ref ?? `${gate.code} #${run.number}`} · {formatDate(run.started_at)}
                </TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Icon
            className={cn(
              "size-4",
              last.verdict === "failed" ? "text-destructive" : last.verdict === "passed" ? "text-success" : "text-foreground/60",
              last.verdict === "running" && "animate-spin",
            )}
            aria-hidden="true"
          />
          {VERDICT_LABEL[last.verdict]}
        </span>
        <span className="text-foreground/65">
          {last.build_ref ?? `${gate.code} #${last.number}`} · {formatDate(last.started_at)}
        </span>
      </p>
    </div>
  )
}

/**
 * A security gate as a card: what it is attached to, what fails a release, how the last releases
 * went, and the switch that pauses it. A paused gate says so in words as well as in the switch.
 */
export function GateCard({
  gate,
  canManage,
  busy,
  onToggle,
}: {
  gate: Gate
  canManage: boolean | undefined
  busy: boolean
  onToggle: () => void
}) {
  const paused = gate.status === "paused"
  return (
    <GlassCard label={`${gate.name}, ${paused ? "paused" : "active"}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#c9d2fa] text-[#1f2f80] dark:bg-[#27406f] dark:text-[#d8e4ff]"
        >
          <GitPullRequest className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/integrations/gates/${gate.code}`}
            className="line-clamp-2 min-h-6 rounded-md text-lg leading-6 font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {gate.name}
          </Link>
          <p className="text-sm text-foreground/65">
            {gate.target_name} · {gate.campaign_code} · {gate.code}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
        <span className={cn("text-sm font-medium", paused && "text-foreground/65")}>{paused ? "Paused" : "Active"}</span>
        {canManage ? (
          <Switch
            checked={!paused}
            disabled={busy}
            onCheckedChange={onToggle}
            aria-label={`${gate.name} is ${paused ? "paused" : "active"}`}
          />
        ) : (
          <span className="text-xs text-foreground/65">{paused ? "Not checking releases" : "Checking releases"}</span>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs text-foreground/60">A release fails on a new finding that is</p>
        <ul className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {gate.fail_on.map((severity) => (
            <li key={severity}>
              <SeverityBadge severity={severity} />
            </li>
          ))}
          {gate.fail_on_reopened && (
            <li className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[#dbe3fb] bg-white px-2 text-xs dark:border-white/15 dark:bg-white/10">
              <RotateCcw className="size-3" aria-hidden="true" />
              or a fixed one that returns
            </li>
          )}
          {gate.fail_on.length === 0 && !gate.fail_on_reopened && (
            <li className="text-sm text-foreground/65">Nothing: it never fails a release</li>
          )}
        </ul>
      </div>

      <div className="mt-4 border-t border-foreground/10 pt-3">
        <History runs={gate.runs} gate={gate} />
      </div>

      <div className="mt-auto pt-4">
        <Link href={`/integrations/gates/${gate.code}`} className={cn(GLASS_BUTTON, "w-full")}>
          Open the gate
        </Link>
      </div>
    </GlassCard>
  )
}
