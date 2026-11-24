"use client"

import {
  Bug,
  CircleCheck,
  CircleHelp,
  Clock,
  FlaskConical,
  HardDrive,
  KeyRound,
  Loader2,
  RotateCcw,
  Rocket,
  TriangleAlert,
} from "lucide-react"

import { GLASS_BUTTON, GLASS_ROUND, GlassCard } from "@/components/sentra/glass-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type LabCard, memory } from "@/lib/lab"
import { TYPE_LABEL } from "@/lib/targets"
import { cn } from "@/lib/utils"

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })

const STEPS = ["Place the ownership token", "Read the canary tokens", "Test the connection"]

/** Readiness in words as well as in colour (WCAG 1.4.1), with a spinner while a deploy or a reset runs. */
function Readiness({ card }: { card: LabCard }) {
  const pill =
    "inline-flex h-7 items-center gap-1.5 rounded-full border border-[#e1e7fb] bg-white px-2.5 text-xs font-medium whitespace-nowrap dark:border-transparent dark:bg-white/10"
  if (!card.deployed) {
    return (
      <span className={pill}>
        <CircleHelp className="size-3.5 text-muted-foreground" aria-hidden="true" />
        Not deployed
      </span>
    )
  }
  if (card.state === "deploying" || card.state === "resetting") {
    return (
      <span className={pill}>
        <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
        {card.state_label}
      </span>
    )
  }
  const ready = card.state === "ready"
  return (
    <span className={cn(pill, !ready && "border-destructive text-destructive")}>
      {ready ? (
        <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <TriangleAlert className="size-3.5" aria-hidden="true" />
      )}
      {card.state_label}
    </span>
  )
}

function Stat({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-2 text-center">
      <div className={cn("tabular text-xl leading-7 font-semibold", warn && "text-warning")}>{children}</div>
      <div className="text-xs text-foreground/65">{label}</div>
    </div>
  )
}

/**
 * One lab target as a card. Before it is deployed: what it is and what it needs, and Deploy. After:
 * what it holds (its known vulnerabilities, its canary tokens, when it was reset) and what to do
 * with it (open it, reset it). While a worker deploys or resets it, the three things it is doing
 * light up one after the other.
 */
export function LabTargetCard({
  card,
  busy,
  canUse,
  flash,
  onDeploy,
  onReset,
  onVulnerabilities,
}: {
  card: LabCard
  busy: boolean
  canUse: boolean
  flash: boolean
  onDeploy: () => void
  onReset: () => void
  onVulnerabilities: () => void
}) {
  const working = card.state === "deploying" || card.state === "resetting"
  const noTokens = card.deployed && card.state === "ready" && card.canaries === 0
  const resetOff = busy || !canUse || card.state !== "ready" || !!card.active_run
  return (
    <GlassCard
      label={card.name}
      className={cn("transition-shadow duration-500", flash && "ring-2 ring-primary shadow-[0_0_0_6px_rgba(43,79,216,0.15)]")}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#c9d2fa] text-[#1f2f80] dark:bg-[#27406f] dark:text-[#d8e4ff]"
        >
          <FlaskConical className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-6 font-medium">{card.name}</h3>
          <p className="text-sm text-foreground/65">{TYPE_LABEL[card.type] ?? card.type}</p>
        </div>
        <Readiness card={card} />
      </div>

      <p className="mt-3 line-clamp-3 text-sm text-foreground/75">{card.about}</p>

      {!card.deployed && (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-foreground/70">
          <li className="inline-flex items-center gap-1.5 rounded-full border border-[#e1e7fb] bg-white px-2.5 py-1 dark:border-transparent dark:bg-white/10">
            <Clock className="size-3.5" aria-hidden="true" />
            About {card.minutes} minutes
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border border-[#e1e7fb] bg-white px-2.5 py-1 dark:border-transparent dark:bg-white/10">
            <HardDrive className="size-3.5" aria-hidden="true" />
            {memory(card.memory_mb)} memory
          </li>
        </ul>
      )}

      {card.deployed && !working && (
        <>
          <div className="mt-4 flex items-stretch divide-x divide-foreground/10">
            <button
              type="button"
              onClick={onVulnerabilities}
              disabled={!card.vulnerabilities}
              className="min-w-0 flex-1 rounded-lg px-2 text-center outline-none hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/10"
              aria-label={`Known vulnerabilities of ${card.name}: ${card.vulnerabilities}. Show them.`}
            >
              <span className="flex items-center justify-center gap-1.5 tabular text-xl leading-7 font-semibold">
                <Bug className="size-4 text-foreground/60" aria-hidden="true" />
                {card.vulnerabilities}
              </span>
              <span className="block text-xs text-link">Known vulnerabilities</span>
            </button>
            <Stat label="Canary tokens" warn={noTokens}>
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-4 text-foreground/60" aria-hidden="true" />
                {card.canaries}
              </span>
            </Stat>
            <Stat label={card.last_reset_at ? "Last reset" : "Reset"}>
              <span className="text-base">{card.last_reset_at ? WHEN.format(new Date(card.last_reset_at)) : "Never"}</span>
            </Stat>
          </div>
          {card.categories.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Categories of its known vulnerabilities">
              {card.categories.map((category) => (
                <li
                  key={category}
                  className="rounded-full border border-[#e1e7fb] bg-white px-2 py-0.5 font-mono text-xs dark:border-transparent dark:bg-white/10"
                >
                  {category}
                </li>
              ))}
            </ul>
          )}
          {noTokens && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              No canary token is planted, so tests that look for a leak can&apos;t succeed. Reset it to plant new ones.
            </p>
          )}
        </>
      )}

      {working && (
        <ol className="mt-4 space-y-1.5" aria-label={card.state === "deploying" ? "What Sentra is doing" : "What the reset is doing"}>
          {STEPS.map((step, index) => (
            <li
              key={step}
              className="lz-step flex items-center gap-2 text-sm"
              style={{ animation: `lz-step 3.6s ${index * 1.2}s infinite` }}
            >
              <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
              {step}
            </li>
          ))}
        </ol>
      )}

      {card.last_error && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{card.last_error}</AlertDescription>
        </Alert>
      )}
      {card.active_run && (
        <p className="mt-3 text-xs text-foreground/65">{card.active_run} is running against it, so it can&apos;t be reset now.</p>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4">
        {card.deployed ? (
          <>
            <a href={`/targets/${card.target_id}`} className={GLASS_BUTTON}>
              Open
              <span className="sr-only"> {card.name}</span>
            </a>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <button
                    type="button"
                    className={cn(GLASS_ROUND, "disabled:cursor-not-allowed disabled:opacity-50")}
                    onClick={onReset}
                    disabled={resetOff}
                    aria-label={`Reset ${card.name}`}
                  >
                    <RotateCcw className="size-5" aria-hidden="true" />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{card.active_run ? "A run is using it" : "Reset: original data, new canary tokens"}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <Button
            type="button"
            className="h-10 flex-1 gap-2 rounded-full hover:bg-primary-hover"
            onClick={onDeploy}
            disabled={busy || !canUse}
          >
            <Rocket aria-hidden="true" />
            {busy ? "Deploying…" : "Deploy"}
            <span className="sr-only"> {card.name}</span>
          </Button>
        )}
      </div>
    </GlassCard>
  )
}
