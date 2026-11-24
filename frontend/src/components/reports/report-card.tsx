import { CalendarRange, Download, RotateCcw } from "lucide-react"

import { StatusChip, TypeMark, scopeText } from "@/components/reports/report-parts"
import { GLASS_BUTTON, GLASS_ROUND, GlassCard } from "@/components/sentra/glass-card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Report, TYPE_LABEL, downloadUrl } from "@/lib/reports"
import { formatDate } from "@/lib/targets"

/**
 * A report as a card: what it is and covers on top (a click opens its details), its state, and the
 * two things a reader does with it: download it, or make it again with the same settings.
 */
export function ReportCard({
  report,
  canReuse,
  busy,
  onOpen,
  onReuse,
}: {
  report: Report
  canReuse: boolean
  busy: boolean
  onOpen: () => void
  onReuse: () => void
}) {
  const ready = report.status === "ready" && Boolean(report.checksum)
  const period = report.period_from && report.period_to ? `${formatDate(report.period_from)} – ${formatDate(report.period_to)}` : null
  return (
    <GlassCard label={`${report.code}: ${TYPE_LABEL[report.type]} report, ${scopeText(report)}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Details of ${report.code}`}
        className="-m-1 flex flex-1 flex-col rounded-xl p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-3">
          <TypeMark type={report.type} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-foreground/65">{TYPE_LABEL[report.type]} report</span>
            <span className="block font-mono text-[13px] font-medium">{report.code}</span>
          </span>
          <span className="rounded-full border border-[#e1e7fb] bg-white px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase dark:border-transparent dark:bg-white/10">
            {report.format}
          </span>
        </span>

        <span className="mt-4 block text-lg leading-6 font-medium">{scopeText(report)}</span>
        {period && (
          <span className="mt-1 flex items-center gap-1.5 text-sm text-foreground/65">
            <CalendarRange className="size-4 shrink-0" aria-hidden="true" />
            {period}
          </span>
        )}

        <span className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip report={report} />
        </span>
        {report.message && <span className="mt-1.5 block text-xs text-foreground/65">{report.message}</span>}
        <span className="mt-2 block text-xs text-foreground/65">
          {formatDate(report.created_at)} · {report.requested_by ?? "Sentra"}
        </span>
      </button>

      <div className="mt-4 flex items-center gap-2">
        {ready ? (
          <a href={downloadUrl(report.code)} download className={GLASS_BUTTON} aria-label={`Download ${report.code}`}>
            <Download className="mr-2 size-4" aria-hidden="true" />
            Download
          </a>
        ) : (
          <span className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-full border-2 border-dashed border-[#dbe3fb] text-sm text-foreground/60 dark:border-white/15">
            {report.status === "generating" ? "Being written…" : "No file"}
          </span>
        )}
        {canReuse && report.scope !== "campaign_run" && report.status !== "generating" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={GLASS_ROUND}
                disabled={busy}
                onClick={onReuse}
                aria-label={`${report.status === "failed" ? "Try again with" : "Use again"} the settings of ${report.code}`}
              >
                <RotateCcw className="size-5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{report.status === "failed" ? "Try again" : "Use these settings again"}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </GlassCard>
  )
}
