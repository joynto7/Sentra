"use client"

import { useId, useState } from "react"
import { ChevronDown, CircleHelp } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Specialist settings, revealed when asked for (progressive disclosure). The content stays in the page
 * while it is collapsed, so what was typed in it is kept, and the line under the title says what is
 * selected in it: a closed section never hides a value that matters. A section with an error is open.
 */
export function AdvancedSection({
  id,
  title,
  summary,
  open,
  onOpenChange,
  hasError,
  children,
  className,
}: {
  id: string
  title: string
  /** The selected values, in words: shown while the section is collapsed and on review */
  summary: string
  open: boolean
  onOpenChange: (open: boolean) => void
  hasError?: boolean
  children: React.ReactNode
  className?: string
}) {
  const shown = open || Boolean(hasError)
  return (
    <section className={cn("rounded-[10px] border", className)}>
      <h3 className="text-sm">
        <button
          type="button"
          onClick={() => onOpenChange(!shown)}
          aria-expanded={shown}
          aria-controls={id}
          className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3.5 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span>
            <span className="block font-semibold">{title}</span>
            <span className="block text-xs font-normal text-muted-foreground">{summary}</span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", shown && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id={id} hidden={!shown} className="space-y-5 border-t px-3.5 py-4">
        {children}
      </div>
    </section>
  )
}

/**
 * Help that follows the current step. The essential instruction is always in the page; the longer
 * explanation opens on request, with a button that a keyboard reaches. Nothing depends on hovering.
 */
export function HelpArea({
  title,
  children,
  more,
  className,
}: {
  title: string
  /** The instruction that is needed to finish the step: always visible */
  children: React.ReactNode
  /** The longer explanation, behind a button */
  more?: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const moreId = useId()
  return (
    <section aria-label={title} className={cn("space-y-2 rounded-[10px] border bg-muted/30 p-4 text-sm", className)}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </h3>
      <div className="space-y-1.5 text-text-secondary">{children}</div>
      {more && (
        <>
          <button
            type="button"
            onClick={() => setOpen((now) => !now)}
            aria-expanded={open}
            aria-controls={moreId}
            className="rounded text-[13px] font-medium text-link underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {open ? "Show less" : "Show more"}
          </button>
          <div id={moreId} hidden={!open} className="space-y-1.5 border-t pt-2 text-text-secondary">
            {more}
          </div>
        </>
      )}
    </section>
  )
}
