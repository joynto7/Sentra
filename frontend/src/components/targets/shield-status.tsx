import { Clock, type LucideIcon, ShieldCheck, TriangleAlert, Unplug } from "lucide-react"

import type { ShieldState, TargetListItem } from "@/lib/targets"
import { cn } from "@/lib/utils"

const SHIELD_ICON: Record<ShieldState, LucideIcon> = {
  active: ShieldCheck,
  not_reporting: TriangleAlert,
  not_in_path: TriangleAlert,
  pending: Clock,
  not_connected: Unplug,
}

/** Screen 16's Sentra Shield column: icon and words, and a problem in the warning colour too. */
export function ShieldStatus({ shield }: { shield: TargetListItem["shield"] }) {
  const Icon = SHIELD_ICON[shield.status]
  const problem = shield.status === "not_reporting" || shield.status === "not_in_path"
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1.5 text-[13px]",
        problem ? "font-medium text-warning" : shield.status === "active" ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon
        className={cn("mt-0.5 size-3.5 shrink-0", shield.status === "active" && "text-success")}
        aria-hidden="true"
      />
      {shield.label}
    </span>
  )
}
