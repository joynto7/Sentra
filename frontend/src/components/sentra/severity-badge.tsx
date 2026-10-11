import { cn } from "@/lib/utils"

export type Severity = "critical" | "high" | "medium" | "low" | "informational"

const LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Informational",
}

const STYLE: Record<Severity, string> = {
  critical: "bg-[var(--severity-critical-bg)] text-[var(--severity-critical-text)]",
  high: "bg-[var(--severity-high-bg)] text-[var(--severity-high-text)]",
  medium: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-text)]",
  low: "bg-[var(--severity-low-bg)] text-[var(--severity-low-text)]",
  informational: "bg-muted text-muted-foreground",
}

/** Shape + colour + label, so severity never depends on colour alone (WCAG 2.2). */
function SeverityShape({ severity }: { severity: Severity }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true } as const
  switch (severity) {
    case "critical":
      return (
        <svg {...common}>
          <polygon points="3,0 7,0 10,3 10,7 7,10 3,10 0,7 0,3" fill="var(--severity-critical)" />
        </svg>
      )
    case "high":
      return (
        <svg {...common}>
          <polygon points="5,0 10,10 0,10" fill="var(--severity-high)" />
        </svg>
      )
    case "medium":
      return (
        <svg {...common}>
          <polygon points="5,0 10,5 5,10 0,5" fill="var(--severity-medium)" />
        </svg>
      )
    case "low":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="5" fill="var(--severity-low)" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4" fill="none" stroke="var(--severity-info)" strokeWidth="1.5" />
        </svg>
      )
  }
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLE[severity],
        className,
      )}
    >
      <SeverityShape severity={severity} />
      {LABEL[severity]}
    </span>
  )
}
