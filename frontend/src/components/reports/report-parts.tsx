import { Briefcase, FileCode2, Loader } from "lucide-react"

import { type Report, type ReportType, STATUS_LABEL, type Schedule } from "@/lib/reports"
import { cn } from "@/lib/utils"

const STATUS_STYLE: Record<string, string> = {
  ready: "border-success/40 text-success",
  generating: "border-primary/50 text-primary",
  empty: "border-border-strong text-muted-foreground",
  failed: "border-destructive/50 text-destructive",
}

/** The state of a report, in words and never in colour alone (NFR-4.3). */
export function StatusChip({ report, className }: { report: Report; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border bg-white/70 px-2 text-xs font-medium whitespace-nowrap dark:bg-white/5",
        STATUS_STYLE[report.status],
        className,
      )}
    >
      {report.status === "generating" && <Loader className="size-3.5 animate-spin" aria-hidden="true" />}
      {STATUS_LABEL[report.status]}
    </span>
  )
}

/** What a report or a schedule covers, in words. */
export function scopeText(report: Report | Schedule): string {
  if ("campaign_run" in report && report.campaign_run) return `Campaign run ${report.campaign_run}`
  if (report.target) return report.target
  return report.category ? `All targets · ${report.category}` : "All targets"
}

/** The tile before a report's type: a briefcase for the executive report, code for the technical one. */
export function TypeMark({ type, className }: { type: ReportType; className?: string }) {
  const Icon = type === "executive" ? Briefcase : FileCode2
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-xl bg-[#c9d2fa] text-[#1f2f80] dark:bg-[#27406f] dark:text-[#d8e4ff]",
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
