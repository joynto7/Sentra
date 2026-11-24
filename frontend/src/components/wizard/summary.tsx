"use client"

import { Pencil, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Flash } from "@/components/wizard/parts"
import { cn } from "@/lib/utils"

/**
 * How sure a value is. `known` comes from the data as it is; an `estimate` is a calculation that says
 * so; `unknown` has no value yet and gives the reason; `stale` was true for earlier choices and
 * is shown dimmed, with the way to bring it up to date.
 */
export type ImpactKind = "known" | "estimate" | "unknown" | "stale"

export type ImpactItem = {
  label: string
  /** Absent for `unknown` */
  value?: string
  kind: ImpactKind
  /** Why it is unknown, or what the estimate is based on */
  note?: string
  /** What to say when the value is unknown; "Not known yet" when absent */
  unknownText?: string
  /** A way to correct it: open the step that decides this value */
  fix?: { label: string; onClick: () => void }
}

const KIND_WORDS: Record<ImpactKind, string | null> = { known: null, estimate: "Estimate", unknown: null, stale: "Out of date" }

/**
 * The live impact preview: what the choices come to, from data that is handed in. It calculates nothing
 * and invents nothing: each value says whether it is known, an estimate, not known yet or out of date.
 */
export function ImpactSummary({
  title = "Summary",
  items,
  warnings = [],
  updating = false,
  footnote,
  children,
  className,
}: {
  title?: string
  items: ImpactItem[]
  /** Consequences the person should read before going on */
  warnings?: string[]
  updating?: boolean
  footnote?: string
  /** More the caller knows about the same choices, such as what the organization has left of its month */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <aside aria-label={title} aria-busy={updating} className={cn("space-y-3 rounded-[10px] border bg-card p-5", className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <dl className="space-y-2.5 text-sm">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              {item.label}
              {KIND_WORDS[item.kind] && (
                <span className={cn("rounded-full border px-1.5 text-[11px]", item.kind === "stale" && "border-warning/60 text-warning")}>{KIND_WORDS[item.kind]}</span>
              )}
            </dt>
            <dd className={cn(item.kind === "stale" && "text-muted-foreground")}>
              {item.kind === "unknown" ? <span className="text-muted-foreground">{item.unknownText ?? "Not known yet"}</span> : <Flash value={item.value ?? ""} className="font-medium">{item.value}</Flash>}
              {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}
              {item.fix && (
                <button
                  type="button"
                  onClick={item.fix.onClick}
                  className="mt-0.5 block rounded text-xs font-medium text-link underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {item.fix.label}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <div className="space-y-2 rounded-[7px] border border-warning/50 bg-warning/10 p-3">
          {warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-[13px]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              {warning}
            </p>
          ))}
        </div>
      )}
      {children}
      {footnote && <p className="border-t pt-3 text-xs text-muted-foreground">{footnote}</p>}
    </aside>
  )
}

/** One step's choices on the review page, with the way back to that step. The other steps' values are untouched by going there. */
export function ReviewSection({
  title,
  onEdit,
  items,
  className,
}: {
  title: string
  onEdit: () => void
  items: { label: string; value: string }[]
  className?: string
}) {
  return (
    <section aria-label={title} className={cn("rounded-[10px] border p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </div>
      <dl className={cn("mt-2 grid gap-x-6 gap-y-2 text-sm", items.length >= 3 && "sm:grid-cols-2")}>
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * What the final button will really do, said before it is pressed. The label and the sentence come from
 * the same facts, so they can't disagree. A preview says that it is a sample and does nothing.
 */
export function OutcomeNote({ operation, effect, sample = false, className }: { operation: string; effect: string; sample?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-[10px] bg-muted/60 p-3.5 text-sm", className)}>
      <p className="font-medium">What happens when you press “{operation}”</p>
      <p className="mt-0.5 text-text-secondary">{effect}</p>
      {sample && <p className="mt-1 text-xs font-medium text-warning">Sample only: in this preview the button creates nothing.</p>}
    </div>
  )
}
