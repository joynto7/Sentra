import Link from "next/link"

import { cn } from "@/lib/utils"

/**
 * One summary card of the dashboard: a number that opens the findings behind it, and what breaks it
 * down. Compact on purpose: the title and the number first, the breakdown in one or two lines.
 */
export function RiskSummaryCard({
  title,
  count,
  href,
  children,
  className,
}: {
  title: string
  count: number
  href: string
  children?: React.ReactNode
  className?: string
}) {
  const id = `card-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section className={cn("rounded-[10px] border bg-card px-4 py-3", className)} aria-labelledby={id}>
      <h2 id={id} className="text-[13px] font-medium text-muted-foreground">
        {title}
      </h2>
      <Link
        href={href}
        className="tabular -ml-1 inline-block rounded-[5px] px-1 text-[28px] leading-9 font-semibold tracking-tight hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`${title}: ${count}`}
      >
        {count}
      </Link>
      {children}
    </section>
  )
}
