import Link from "next/link"

import { GLASS_SURFACE } from "@/components/sentra/glass-card"
import { cn } from "@/lib/utils"

/**
 * The card of the library views (Test Library): a flat white card, one link as a whole, with a small
 * tile and the kind of thing it is on top, its name, a line about it, and a foot of two or three facts.
 * The card under the pointer, or the keyboard, turns the brand's blue (white text on it is 6.5:1).
 */
export function LibraryCard({
  href,
  icon,
  kind,
  title,
  subtitle,
  footer,
  label,
}: {
  href: string
  icon: React.ReactNode
  kind: string
  title: string
  subtitle?: string
  footer: React.ReactNode
  /** What a screen reader reads for the link, when the card's words are not enough */
  label?: string
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "group flex h-full min-w-0 flex-col rounded-2xl border p-4 text-foreground outline-none",
        GLASS_SURFACE,
        "shadow-[0_1px_2px_rgba(15,30,70,0.06)] motion-safe:transition-[background-color,color,box-shadow,transform] motion-safe:duration-200",
        "hover:border-transparent hover:bg-primary hover:bg-none hover:text-primary-foreground hover:shadow-[0_18px_36px_-18px_rgba(43,79,216,0.7)]",
        "focus-visible:border-transparent focus-visible:bg-primary focus-visible:bg-none focus-visible:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "motion-safe:hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/70 text-primary group-hover:bg-white/20 group-hover:text-white group-focus-visible:bg-white/20 group-focus-visible:text-white"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{kind}</span>
        <span
          aria-hidden="true"
          className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          Open
        </span>
      </div>
      <h3 className="mt-4 line-clamp-2 text-[15px] leading-5 font-semibold">{title}</h3>
      {subtitle && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground group-hover:text-white/85 group-focus-visible:text-white/85">
          {subtitle}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 text-sm text-muted-foreground group-hover:text-white/85 group-focus-visible:text-white/85">
        {footer}
      </div>
    </Link>
  )
}

/** A thin divider between two facts of a card's foot. */
export function Bar() {
  return <span aria-hidden="true" className="h-4 w-px bg-current opacity-25" />
}
