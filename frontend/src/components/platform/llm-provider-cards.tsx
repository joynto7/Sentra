"use client"

import { CircleCheck, KeyRound, Plus, Trash2, TriangleAlert, Zap } from "lucide-react"

import {
  HEALTH_WORD,
  HealthDot,
  Location,
  ProviderAvatar,
  healthOf,
} from "@/components/platform/llm-ui"
import { TestOutcome } from "@/components/platform/provider-panel"
import { Button } from "@/components/ui/button"
import { type Provider, type TestResult, cost, duration } from "@/lib/llm-providers"
import { cn } from "@/lib/utils"

const TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/** The result of the last test, as a band of its own: what it was, how long it took, what it cost. */
function HealthBand({ provider, testing }: { provider: Provider; testing: boolean }) {
  const health = healthOf(provider)
  if (testing) {
    return (
      <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5" role="status">
        <p className="text-sm font-medium text-primary">Sending a test request…</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-primary/15">
          <div className="llm-sweep h-full w-1/3 rounded-full bg-primary" />
        </div>
      </div>
    )
  }
  if (health === "working") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        <span className="font-medium text-success">{HEALTH_WORD.working}</span>
        <span className="tabular text-muted-foreground">
          · {duration(provider.test_duration_ms)} · {cost(provider.test_cost_usd)}
          {provider.tested_at ? ` · ${TIME.format(new Date(provider.tested_at))}` : ""}
        </span>
      </div>
    )
  }
  if (health === "failed") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span>
          <span className="font-medium text-destructive">{HEALTH_WORD.failed}</span>
          <span className="text-muted-foreground">: {provider.test_reply}</span>
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-sm text-muted-foreground">
      <HealthDot health="untested" />
      {HEALTH_WORD.untested}
      {provider.has_api_key ? ": a stored key is not a working connection until a test request succeeds" : ""}
    </div>
  )
}

export function ProviderCard({
  provider,
  busy,
  testing,
  result,
  index,
  onTest,
  onAddModel,
  onRemove,
}: {
  provider: Provider
  busy: boolean
  testing: boolean
  result: TestResult | null
  index: number
  onTest: () => void
  onAddModel: () => void
  onRemove: () => void
}) {
  return (
    <section
      aria-label={provider.name}
      className="llm-card ap-rise flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="flex items-start gap-3">
        <ProviderAvatar name={provider.name} kind={provider.kind} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-tight">{provider.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={provider.base_url ?? undefined}>
            {provider.kind_label}
            {provider.base_url ? ` · ${provider.base_url}` : ""}
          </p>
        </div>
        <Location deployment={provider.deployment} />
      </div>

      <HealthBand provider={provider} testing={testing} />

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">Models</h4>
        <ul className="mt-2 flex flex-wrap gap-2">
          {provider.models.map((model) => (
            <li
              key={model.id}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-sm",
                model.tasks.length ? "border-primary/30 bg-primary/5" : "border-border bg-muted/40",
              )}
            >
              <span className="font-medium">{model.label}</span>
              <span className="block text-xs text-muted-foreground">
                {model.tasks.length ? `Serves ${model.tasks.join(", ")}` : "Not used by any task"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <KeyRound className="size-4 shrink-0" aria-hidden="true" />
        {provider.has_api_key ? (
          <span aria-label="API key stored, never shown">API key stored encrypted, never shown again</span>
        ) : (
          "No API key needed"
        )}
      </p>

      {result && <TestOutcome result={result} />}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
        <Button size="sm" className="transition-transform active:scale-[0.97] motion-reduce:transition-none" onClick={onTest} disabled={busy}>
          <Zap aria-hidden="true" />
          Test request
        </Button>
        <Button variant="outline" size="sm" onClick={onAddModel} disabled={busy}>
          <Plus aria-hidden="true" />
          Add model
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={onRemove} disabled={busy}>
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      </div>
    </section>
  )
}

/** The way into "Add provider" from the grid itself, where the next card would be. */
export function AddProviderTile({ index, onAdd }: { index: number; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="llm-card ap-rise group flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong bg-transparent p-5 text-center outline-none hover:border-primary/60 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110 motion-reduce:transition-none">
        <Plus className="size-5" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold">Add a provider</span>
      <span className="max-w-56 text-xs text-muted-foreground">
        Anthropic, OpenAI, a model on this platform, or any server that speaks the OpenAI API.
      </span>
    </button>
  )
}
