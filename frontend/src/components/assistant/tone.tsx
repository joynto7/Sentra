import { cn } from "cn"

import type { Badge as BadgeData, Tone } from "@/lib/assistant"

/** The tone colours of the assistant's badges and dots, from the design tokens (light and dark). */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  good: "bg-success/10 text-success ring-success/25",
  warn: "bg-warning/10 text-warning ring-warning/30",
  bad: "bg-destructive/10 text-destructive ring-destructive/25",
  info: "bg-accent text-accent-foreground ring-primary/20",
}

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  info: "bg-primary",
}

export function ToneBadge({ badge, className }: { badge: BadgeData; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_BADGE[badge.tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[badge.tone])} />
      {badge.label}
    </span>
  )
}
