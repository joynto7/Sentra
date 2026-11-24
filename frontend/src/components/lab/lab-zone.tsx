"use client"

import { useState } from "react"
import { ChevronDown, Database, FlaskConical, Shield, ShieldCheck, Building2, Network, WifiOff } from "lucide-react"

import { ShieldMotion } from "@/components/shield/shield-story"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { LabCard } from "@/lib/lab"
import { cn } from "@/lib/utils"

const FACTS = [
  {
    icon: Network,
    label: "Isolated network",
    note: "The lab targets sit on a network of their own; only Sentra's Target Connector reaches them.",
  },
  { icon: Database, label: "Synthetic data", note: "Every record, document and secret in the lab is made up." },
  { icon: WifiOff, label: "No internet", note: "A lab target can't call out: its tools are simulated." },
  { icon: Building2, label: "Yours only", note: "A deployed lab target belongs to this organization alone." },
] as const

function stateWord(card: LabCard): string {
  if (!card.deployed) return "Not deployed"
  return card.state_label
}

/**
 * The lab as a picture: Sentra on the left, the isolated zone on the right with one node for each lab
 * target. A node says its state and takes the reader to its card; the line between moves while
 * something is being deployed or reset, and under the pointer, and stands still otherwise. Under
 * it, the four facts of the isolation, and the full text a click away.
 */
export function LabZone({ cards, isolation, onPick }: { cards: LabCard[]; isolation: string; onPick: (key: string) => void }) {
  const [more, setMore] = useState(false)
  const working = cards.some((card) => card.state === "deploying" || card.state === "resetting")
  const anyReady = cards.some((card) => card.state === "ready")
  return (
    <section aria-labelledby="lab-zone" className="group mb-5 rounded-[14px] border bg-card p-4">
      <ShieldMotion />
      <style>{`@keyframes lz-step { 0%, 100% { opacity: .4 } 33% { opacity: 1 } } @media (prefers-reduced-motion: reduce) { .lz-step { animation: none !important; opacity: 1 !important } }`}</style>
      <h2 id="lab-zone" className="mb-3 text-[15px] font-semibold">
        The lab zone
      </h2>

      <div className="flex items-stretch gap-2">
        <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-1.5 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Shield className="size-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Sentra</span>
          <span className="text-[11px] text-muted-foreground">Target Connector</span>
        </div>

        <div className="flex min-w-6 flex-1 items-center" aria-hidden="true">
          <span
            className={cn("ss-card-line h-0.5 w-full rounded-full text-primary/60", "ss-live")}
            style={working ? { animation: "ss-flow .6s linear infinite" } : undefined}
          />
        </div>

        <div className="min-w-0 flex-[3] rounded-2xl border-2 border-dashed border-[#c9d4f7] bg-[linear-gradient(160deg,#eef2ff_0%,#ffffff_70%)] p-3 dark:border-white/20 dark:bg-[linear-gradient(160deg,#1c2547_0%,#151b30_80%)]">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <FlaskConical className="size-3.5" aria-hidden="true" />
            Isolated · synthetic data · no internet
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => {
              const ready = card.state === "ready"
              const busy = card.state === "deploying" || card.state === "resetting"
              return (
                <li key={card.key}>
                  <button
                    type="button"
                    onClick={() => onPick(card.key)}
                    aria-label={`${card.name}: ${stateWord(card)}. Go to its card.`}
                    className="flex w-full items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 text-left outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/10"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "relative grid size-8 shrink-0 place-items-center rounded-lg",
                        ready ? "bg-success/15 text-success" : busy ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {ready ? <ShieldCheck className="size-4" /> : <FlaskConical className="size-4" />}
                      {busy && <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-ping rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] leading-tight font-medium">{card.name.replace(/ \(lab\)$/, "")}</span>
                      <span className={cn("block text-xs", ready ? "text-success" : "text-muted-foreground")}>{stateWord(card)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {FACTS.map((fact) => (
          <li key={fact.label}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <fact.icon className="size-3.5" aria-hidden="true" />
                  {fact.label}
                  <span className="sr-only">: {fact.note}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{fact.note}</TooltipContent>
            </Tooltip>
          </li>
        ))}
        <li>
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((now) => !now)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            How the zone is isolated
            <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} aria-hidden="true" />
          </button>
        </li>
      </ul>
      {more && (
        <div className="mt-2 rounded-xl bg-muted/40 p-3 text-sm text-text-secondary">
          {isolation}
          {!anyReady && (
            <p className="mt-2 font-medium text-foreground">
              This describes how the lab is designed to run. No lab target is ready now, so none of it has been verified in this deployment.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
