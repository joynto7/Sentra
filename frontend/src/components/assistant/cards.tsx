import Link from "next/link"
import { ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react"
import { cn } from "cn"

import { safeHref, type Card, type Cell } from "@/lib/assistant"
import { TONE_DOT, ToneBadge } from "@/components/assistant/tone"

/** The cards under an answer: what the assistant found, drawn like the pages draw it. */

function CellView({ cell }: { cell: Cell }) {
  if (cell.badge) return <ToneBadge badge={cell.badge} />
  return <span className={cn("block truncate", cell.strong && "font-medium text-foreground")}>{cell.text}</span>
}

function TableCard({ card }: { card: Extract<Card, { type: "table" }> }) {
  const shown = card.rows.length
  const more = card.total - shown
  const grid = { gridTemplateColumns: `minmax(0,1.7fr) ${"minmax(0,auto) ".repeat(card.columns.length - 1)}` }
  return (
    <section aria-label={card.title} className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <header className="flex items-baseline justify-between gap-2 border-b bg-muted/50 px-3.5 py-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{card.title}</h4>
        <span className="tabular text-xs text-muted-foreground">{card.total}</span>
      </header>
      {shown === 0 ? (
        <p className="px-3.5 py-4 text-sm text-muted-foreground">Nothing to show.</p>
      ) : (
        <ul className="divide-y">
          {card.rows.map((row, i) => {
            const href = safeHref(row.href)
            const inner = (
              <>
                <div className="grid items-center gap-x-3 text-sm text-text-secondary" style={grid}>
                  {row.cells.map((cell, j) => (
                    <CellView key={j} cell={cell} />
                  ))}
                </div>
                {href && (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
                  />
                )}
              </>
            )
            const cls = "group/row flex items-center gap-2 px-3.5 py-2.5 outline-none"
            return (
              <li key={i}>
                {href ? (
                  <Link href={href} className={cn(cls, "transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {(more > 0 || safeHref(card.more_href)) && (
        <footer className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3.5 py-2 text-xs">
          <span className="text-muted-foreground">{more > 0 ? `+${more} more not shown` : ""}</span>
          {safeHref(card.more_href) && (
            <Link href={card.more_href!} className="inline-flex items-center gap-1 font-medium text-link hover:underline">
              {card.more_label}
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </footer>
      )}
    </section>
  )
}

function RecordCard({ card }: { card: Extract<Card, { type: "record" }> }) {
  const href = safeHref(card.href)
  return (
    <section aria-label={card.title} className="rounded-xl border bg-card p-3.5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-semibold">{card.title}</h4>
          {card.subtitle && <p className="truncate text-sm text-muted-foreground">{card.subtitle}</p>}
        </div>
        {href && (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-link outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      {card.badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.badges.map((badge, i) => (
            <ToneBadge key={i} badge={badge} />
          ))}
        </div>
      )}
      {card.facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
          {card.facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-right font-medium text-text-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function MetricsCard({ card }: { card: Extract<Card, { type: "metrics" }> }) {
  const href = safeHref(card.href)
  return (
    <section aria-label={card.title} className="rounded-xl border bg-card p-3.5 shadow-xs">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{card.title}</h4>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
            Open <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {card.items.map((item) => (
          <div key={item.label} className="rounded-lg bg-muted/60 px-2.5 py-2">
            <dt className="flex items-center gap-1.5 text-[0.7rem] leading-tight text-muted-foreground">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[item.tone])} />
              {item.label}
            </dt>
            <dd className="tabular mt-1 text-xl font-semibold tracking-tight">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function LinkCard({ card }: { card: Extract<Card, { type: "link" }> }) {
  const href = safeHref(card.href)
  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{card.title}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{card.description}</p>
      </div>
      {href && <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
    </>
  )
  const cls = "group flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-xs"
  return href ? (
    <Link href={href} className={cn(cls, "outline-none transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function CardView({ card }: { card: Card }) {
  switch (card.type) {
    case "table":
      return <TableCard card={card} />
    case "record":
      return <RecordCard card={card} />
    case "metrics":
      return <MetricsCard card={card} />
    case "link":
      return <LinkCard card={card} />
    default:
      return null
  }
}
